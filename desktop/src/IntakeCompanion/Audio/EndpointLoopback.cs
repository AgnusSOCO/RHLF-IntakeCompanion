using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace Rhlf.IntakeCompanion.Audio;

/// <summary>
/// Fallback for Windows builds older than 20348 (no process-loopback support).
/// Captures ALL audio rendered on the default output endpoint - not just
/// RingCentral. Emits s16le 16 kHz mono PCM via <see cref="OnChunk"/>.
/// </summary>
internal sealed class EndpointLoopback : IDisposable
{
    public event Action<byte[]>? OnChunk;

    private static readonly WaveFormat OutFormat = new(16000, 16, 1);

    private WasapiLoopbackCapture? _capture;
    private BufferedWaveProvider? _buffer;
    private MediaFoundationResampler? _resampler;
    private Thread? _pump;
    private CancellationTokenSource? _cts;

    public void Start()
    {
        Stop();
        _cts = new CancellationTokenSource();

        var device = DeviceHelper.PickDevice(DataFlow.Render, Role.Multimedia);
        Console.WriteLine($"[loopback] render device: {device.FriendlyName}");
        _capture = new WasapiLoopbackCapture(device);
        _buffer = new BufferedWaveProvider(_capture.WaveFormat)
        {
            DiscardOnBufferOverflow = true,
            BufferDuration = TimeSpan.FromSeconds(2),
            ReadFully = false, // return only real samples; otherwise the resampler
                               // stream never ends and we emit silence at CPU speed
        };
        _resampler = new MediaFoundationResampler(_buffer, OutFormat) { ResamplerQuality = 60 };

        _capture.DataAvailable += (_, e) =>
        {
            if (e.BytesRecorded > 0) _buffer.AddSamples(e.Buffer, 0, e.BytesRecorded);
        };

        _pump = new Thread(PumpLoop) { IsBackground = true, Name = "EndpointLoopback" };
        _pump.Start();
        _capture.StartRecording();
    }

    private void PumpLoop()
    {
        var outBuf = new byte[OutFormat.AverageBytesPerSecond / 10];
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
                Console.Error.WriteLine($"[loopback] resample error: {ex.Message}");
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
