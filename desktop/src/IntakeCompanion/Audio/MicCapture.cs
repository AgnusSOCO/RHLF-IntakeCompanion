using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace Rhlf.IntakeCompanion.Audio;

/// <summary>
/// Captures the agent's headset microphone (default communications device)
/// and resamples to s16le 16 kHz mono via MediaFoundationResampler.
/// Emits PCM chunks via <see cref="OnChunk"/>.
/// </summary>
internal sealed class MicCapture : IDisposable
{
    public event Action<byte[]>? OnChunk;

    private static readonly WaveFormat OutFormat = new(16000, 16, 1);

    private WasapiCapture? _capture;
    private BufferedWaveProvider? _buffer;
    private MediaFoundationResampler? _resampler;
    private Thread? _pump;
    private CancellationTokenSource? _cts;

    public void Start()
    {
        Stop();
        _cts = new CancellationTokenSource();

        var device = DeviceHelper.PickDevice(DataFlow.Capture, Role.Communications);
        Console.WriteLine($"[mic] capture device: {device.FriendlyName}");
        _capture = new WasapiCapture(device);
        _buffer = new BufferedWaveProvider(_capture.WaveFormat)
        {
            DiscardOnBufferOverflow = true,
            BufferDuration = TimeSpan.FromSeconds(2),
            ReadFully = false,
        };
        _resampler = new MediaFoundationResampler(_buffer, OutFormat) { ResamplerQuality = 60 };

        _capture.DataAvailable += (_, e) =>
        {
            if (e.BytesRecorded > 0) _buffer.AddSamples(e.Buffer, 0, e.BytesRecorded);
        };
        _capture.RecordingStopped += (_, e) =>
        {
            if (e.Exception is not null)
                Console.Error.WriteLine($"[mic] recording stopped: {e.Exception.Message}");
        };

        _pump = new Thread(PumpLoop) { IsBackground = true, Name = "MicResampler" };
        _pump.Start();
        _capture.StartRecording();
    }

    private void PumpLoop()
    {
        var outBuf = new byte[OutFormat.AverageBytesPerSecond / 10]; // ~100ms
        var ct = _cts!.Token;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                int read = _resampler!.Read(outBuf, 0, outBuf.Length);
                if (read > 0)
                {
                    var chunk = new byte[read];
                    Buffer.BlockCopy(outBuf, 0, chunk, 0, read);
                    OnChunk?.Invoke(chunk);
                }
                else
                {
                    Thread.Sleep(10);
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[mic] resample error: {ex.Message}");
                return;
            }
        }
    }

    public void Stop()
    {
        try { _capture?.StopRecording(); } catch { }
        _cts?.Cancel();
        _pump?.Join(2000);
        _pump = null;
        _cts = null;
        _capture?.Dispose();
        _resampler?.Dispose();
        _capture = null;
        _resampler = null;
        _buffer = null;
    }

    public void Dispose() => Stop();
}
