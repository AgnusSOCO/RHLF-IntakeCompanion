using System.Runtime.InteropServices;

namespace Rhlf.IntakeCompanion.Audio;

/// <summary>
/// Captures audio rendered by a specific process tree (e.g. RingCentral.exe)
/// using Windows process-loopback capture (ActivateAudioInterfaceAsync with
/// VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK). Requires Windows build 20348+.
///
/// Emits s16le 16 kHz mono PCM chunks via <see cref="OnChunk"/>.
/// </summary>
internal sealed class ProcessLoopback : IDisposable
{
    public event Action<byte[]>? OnChunk;

    private const int SampleRate = 16000;
    private const int Channels = 1;
    private const int BitsPerSample = 16;

    private IAudioClient? _client;
    private IAudioCaptureClient? _capture;
    private Thread? _thread;
    private CancellationTokenSource? _cts;
    private ManualResetEvent? _sampleReady;

    public void Start(int processId)
    {
        Stop();

        _cts = new CancellationTokenSource();
        _sampleReady = new ManualResetEvent(false);
        _client = ActivateForProcess(processId);

        var format = new WaveFormatEx
        {
            wFormatTag = 1, // PCM
            nChannels = Channels,
            nSamplesPerSec = SampleRate,
            wBitsPerSample = BitsPerSample,
            nBlockAlign = (ushort)(Channels * BitsPerSample / 8),
            cbSize = 0,
        };
        format.nAvgBytesPerSec = (uint)(SampleRate * format.nBlockAlign);

        IntPtr fmtPtr = Marshal.AllocHGlobal(Marshal.SizeOf(format));
        Marshal.StructureToPtr(format, fmtPtr, false);
        try
        {
            const uint EventCallback = 0x00040000;      // AUDCLNT_STREAMFLAGS_EVENTCALLBACK
            const uint AutoConvertPcm = 0x80000000;     // AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
            _client.Initialize(
                shareMode: 0, // AUDCLNT_SHAREMODE_SHARED
                streamFlags: EventCallback | AutoConvertPcm,
                bufferDuration: 2_000_000, // 200 ms (100ns units)
                periodicity: 0,
                format: fmtPtr,
                audioSessionGuid: IntPtr.Zero);
        }
        finally
        {
            Marshal.FreeHGlobal(fmtPtr);
        }

        var serviceId = typeof(IAudioCaptureClient).GUID;
        _capture = (IAudioCaptureClient)_client.GetService(serviceId);
        _client.SetEventHandle(_sampleReady.SafeWaitHandle.DangerousGetHandle());
        _client.Start();

        _thread = new Thread(CaptureLoop) { IsBackground = true, Name = "ProcessLoopback" };
        _thread.Start();
    }

    private void CaptureLoop()
    {
        var wait = _sampleReady!;
        var ct = _cts!.Token;
        int blockAlign = Channels * BitsPerSample / 8;

        while (!ct.IsCancellationRequested)
        {
            if (!wait.WaitOne(200)) continue;
            try
            {
                uint packet = _capture!.GetNextPacketSize();
                while (packet > 0)
                {
                    _capture.GetBuffer(out IntPtr data, out uint frames, out uint flags, out _, out _);
                    int bytes = (int)(frames * blockAlign);
                    if (bytes > 0)
                    {
                        var buf = new byte[bytes];
                        Marshal.Copy(data, buf, 0, bytes);
                        OnChunk?.Invoke(buf);
                    }
                    _capture.ReleaseBuffer(frames);
                    packet = _capture.GetNextPacketSize();
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[loopback] capture error: {ex.Message}");
                return;
            }
        }
        try { _client!.Stop(); } catch { }
    }

    public void Stop()
    {
        _cts?.Cancel();
        _thread?.Join(2000);
        _thread = null;
        _cts = null;
        if (_capture is not null) Marshal.ReleaseComObject(_capture);
        if (_client is not null) Marshal.ReleaseComObject(_client);
        _capture = null;
        _client = null;
        _sampleReady?.Dispose();
        _sampleReady = null;
    }

    public void Dispose() => Stop();

    private static IAudioClient ActivateForProcess(int processId)
    {
        var activationParams = new AudioClientActivationParams
        {
            ActivationType = 1, // AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK
            TargetProcessId = (uint)processId,
            ProcessLoopbackMode = 0, // include target process tree
        };

        IntPtr paramsPtr = Marshal.AllocHGlobal(Marshal.SizeOf(activationParams));
        Marshal.StructureToPtr(activationParams, paramsPtr, false);

        IntPtr propPtr = IntPtr.Zero;
        try
        {
            var prop = new PropVariant
            {
                vt = 65, // VT_BLOB
                blobSize = (uint)Marshal.SizeOf(activationParams),
                blobData = paramsPtr,
            };
            propPtr = Marshal.AllocHGlobal(Marshal.SizeOf(prop));
            Marshal.StructureToPtr(prop, propPtr, false);

            var handler = new ActivationCompletion();
            NativeMethods.ActivateAudioInterfaceAsync(
                "VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK",
                typeof(IAudioClient).GUID,
                propPtr,
                handler,
                out _);

            return handler.Result.Task.GetAwaiter().GetResult();
        }
        finally
        {
            if (propPtr != IntPtr.Zero) Marshal.FreeHGlobal(propPtr);
            Marshal.FreeHGlobal(paramsPtr);
        }
    }

    // ---- interop ----------------------------------------------------------

    [ComVisible(true)]
    private sealed class ActivationCompletion : IActivateAudioInterfaceCompletionHandler
    {
        public readonly TaskCompletionSource<IAudioClient> Result = new();
        public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation op)
        {
            try
            {
                op.GetActivateResult(out int hr, out object? activated);
                Marshal.ThrowExceptionForHR(hr);
                Result.SetResult((IAudioClient)activated!);
            }
            catch (Exception ex)
            {
                Result.SetException(ex);
            }
        }
    }

    private static class NativeMethods
    {
        [DllImport("Mmdevapi.dll", ExactSpelling = true)]
        internal static extern int ActivateAudioInterfaceAsync(
            [MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath,
            [MarshalAs(UnmanagedType.LPStruct)] Guid riid,
            IntPtr activationParams,
            [MarshalAs(UnmanagedType.Interface)] IActivateAudioInterfaceCompletionHandler completionHandler,
            [MarshalAs(UnmanagedType.Interface)] out IActivateAudioInterfaceAsyncOperation activationOperation);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PropVariant
    {
        public ushort vt;
        public ushort r1, r2, r3;
        public uint blobSize;
        public uint pad;
        public IntPtr blobData;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct AudioClientActivationParams
    {
        public int ActivationType;
        public uint TargetProcessId;
        public int ProcessLoopbackMode;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WaveFormatEx
    {
        public ushort wFormatTag;
        public ushort nChannels;
        public uint nSamplesPerSec;
        public uint nAvgBytesPerSec;
        public ushort nBlockAlign;
        public ushort wBitsPerSample;
        public ushort cbSize;
    }

    [ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown), ComVisible(true)]
    private interface IActivateAudioInterfaceCompletionHandler
    {
        void ActivateCompleted(IActivateAudioInterfaceAsyncOperation activateOperation);
    }

    [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IActivateAudioInterfaceAsyncOperation
    {
        void GetActivateResult(out int activateResult,
            [MarshalAs(UnmanagedType.IUnknown)] out object? activatedInterface);
    }

    [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioClient
    {
        void Initialize(int shareMode, uint streamFlags, long bufferDuration,
            long periodicity, IntPtr format, IntPtr audioSessionGuid);
        uint GetBufferSize();
        long GetStreamLatency();
        uint GetCurrentPadding();
        void IsFormatSupported(int shareMode, IntPtr format, IntPtr closestMatch);
        IntPtr GetMixFormat();
        [return: MarshalAs(UnmanagedType.IUnknown)]
        object GetService([MarshalAs(UnmanagedType.LPStruct)] Guid riid);
        void Start();
        void Stop();
        void Reset();
        void SetEventHandle(IntPtr eventHandle);
    }

    [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioCaptureClient
    {
        void GetBuffer(out IntPtr data, out uint numFramesToRead, out uint flags,
            out ulong devicePosition, out ulong qpcPosition);
        void ReleaseBuffer(uint numFramesRead);
        uint GetNextPacketSize();
    }
}
