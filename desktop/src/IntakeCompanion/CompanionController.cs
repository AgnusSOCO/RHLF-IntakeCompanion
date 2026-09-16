using System.Diagnostics;
using Rhlf.IntakeCompanion.Audio;
using Rhlf.IntakeCompanion.Net;

namespace Rhlf.IntakeCompanion;

/// <summary>
/// Owns the backend socket, audio capture sources, and call state.
/// UI-thread agnostic: raises <see cref="Log"/> / <see cref="StateChanged"/>
/// on whatever thread they occur; callers must marshal to the UI thread.
/// </summary>
internal sealed class CompanionController : IDisposable
{
    public event Action<string>? Log;
    public event Action? StateChanged;

    public bool OnCall => _sessionId is not null;
    public bool Capturing => _capturing;
    public bool Paused => _paused;
    public bool Connected => _socket.IsConnected;
    public string ExtensionId { get; }
    public string UiUrl { get; }

    private readonly BackendSocket _socket;
    private readonly ProcessLoopback _processLoopback = new();
    private readonly EndpointLoopback _endpointLoopback = new();
    private readonly MicCapture _mic = new();
    private readonly string _processName;
    private string _loopbackMode;

    private volatile bool _capturing;
    private volatile bool _paused;
    private volatile string? _sessionId;

    public CompanionController(string server, string extensionId, string token,
        string processName, string loopbackMode)
    {
        ExtensionId = extensionId;
        _processName = processName;

        int osBuild = Environment.OSVersion.Version.Build;
        bool processLoopbackSupported = osBuild >= 20348;
        _loopbackMode = loopbackMode == "auto"
            ? (processLoopbackSupported ? "process" : "endpoint")
            : loopbackMode;
        if (_loopbackMode == "endpoint")
            EmitLog($"[warn] build {osBuild}: whole-endpoint loopback - non-RingCentral audio will be captured too");

        var ws = new Uri($"{server.TrimEnd('/')}/audio?extensionId={extensionId}&token={token}");
        _socket = new BackendSocket(ws);

        // derive the agent UI url: ws->http, wss->https
        var ub = new UriBuilder(ws) { Scheme = ws.Scheme == "wss" ? "https" : "http", Path = "/ui/", Query = $"extensionId={extensionId}&token={token}" };
        UiUrl = ub.Uri.ToString();

        _processLoopback.OnChunk += pcm => { if (_capturing && !_paused) _ = _socket.SendAudioAsync(0, pcm); };
        _endpointLoopback.OnChunk += pcm => { if (_capturing && !_paused) _ = _socket.SendAudioAsync(0, pcm); };
        _mic.OnChunk += pcm => { if (_capturing && !_paused) _ = _socket.SendAudioAsync(1, pcm); };

        _socket.OnControl += msg =>
        {
            var type = msg.GetProperty("type").GetString();
            switch (type)
            {
                case "callStart":
                    _sessionId = msg.GetProperty("sessionId").GetString();
                    EmitLog($"[call] started {_sessionId}");
                    StateChanged?.Invoke();
                    StartCapture();
                    break;
                case "callEnd":
                    EmitLog($"[call] ended {msg.GetProperty("sessionId").GetString()}");
                    StopCapture();
                    break;
                case "pause":
                    SetPaused(msg.GetProperty("paused").GetBoolean());
                    break;
            }
        };

        _socket.OnDisconnected += () =>
        {
            StopCapture();
            EmitLog("[net] disconnected from backend - reconnecting in 5s");
            StateChanged?.Invoke();
            ScheduleReconnect();
        };
    }

    private volatile bool _disposed;
    private int _reconnecting;

    public async Task StartAsync(CancellationToken ct = default)
    {
        while (!_disposed && !_socket.IsConnected)
        {
            try
            {
                EmitLog("[net] connecting to backend");
                await _socket.ConnectAsync(ct);
                await _socket.SendJsonAsync(new { type = "hello", extensionId = ExtensionId });
                EmitLog($"[net] connected as extension {ExtensionId}; watching '{_processName}'");
                StateChanged?.Invoke();
                return;
            }
            catch (Exception ex)
            {
                EmitLog($"[net] connect failed: {ex.Message} - retrying in 5s");
                StateChanged?.Invoke();
                try { await Task.Delay(5000, ct); } catch { return; }
            }
        }
    }

    private void ScheduleReconnect()
    {
        if (Interlocked.Exchange(ref _reconnecting, 1) != 0) return;
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(5000);
                await StartAsync();
            }
            finally { _reconnecting = 0; }
        });
    }

    public void TogglePause() => SetPaused(!_paused);

    public async Task ShutdownAsync()
    {
        StopCapture();
        await _socket.CloseAsync();
    }

    private void StartCapture()
    {
        if (_capturing) return;
        if (_loopbackMode == "endpoint") { StartEndpointCapture(); return; }

        int? pid = FindTargetProcess();
        if (pid is null)
        {
            EmitLog($"[audio] '{_processName}' process not found - retrying in background");
            _ = Task.Run(async () =>
            {
                while (_sessionId is not null && !_capturing)
                {
                    await Task.Delay(1000);
                    pid = FindTargetProcess();
                    if (pid is not null) break;
                }
                if (pid is not null && _sessionId is not null) StartCapture();
            });
            return;
        }

        try
        {
            _processLoopback.Start(pid.Value);
            TryStartMic();
            _capturing = true;
            EmitLog($"[audio] capturing (process loopback, {_processName} pid={pid})");
            _ = _socket.SendJsonAsync(new { type = "state", capturing = true, mode = "process" });
        }
        catch (Exception ex)
        {
            EmitLog($"[audio] process loopback failed: {ex.Message}");
            _ = _socket.SendJsonAsync(new { type = "state", capturing = false, error = ex.Message });
        }
        StateChanged?.Invoke();
    }

    private void StartEndpointCapture()
    {
        try
        {
            _endpointLoopback.Start();
            TryStartMic();
            _capturing = true;
            EmitLog("[audio] capturing (endpoint loopback + mic)");
            _ = _socket.SendJsonAsync(new { type = "state", capturing = true, mode = "endpoint" });
        }
        catch (Exception ex)
        {
            EmitLog($"[audio] endpoint capture failed: {ex.Message}");
            _ = _socket.SendJsonAsync(new { type = "state", capturing = false, error = ex.Message });
        }
        StateChanged?.Invoke();
    }

    private void TryStartMic()
    {
        try { _mic.Start(); }
        catch (Exception ex) { EmitLog($"[audio] mic capture unavailable: {ex.Message}"); }
    }

    private void StopCapture()
    {
        if (_sessionId is null && !_capturing) return;
        _capturing = false;
        _paused = false;
        _sessionId = null;
        _processLoopback.Stop();
        _endpointLoopback.Stop();
        _mic.Stop();
        _ = _socket.SendJsonAsync(new { type = "state", capturing = false });
        StateChanged?.Invoke();
    }

    private void SetPaused(bool value)
    {
        _paused = value;
        EmitLog(value ? "[audio] capture paused" : "[audio] capture resumed");
        _ = _socket.SendJsonAsync(new { type = "state", paused = value });
        StateChanged?.Invoke();
    }

    private int? FindTargetProcess()
    {
        var procs = Process.GetProcessesByName(_processName);
        return procs.Length > 0 ? procs[0].Id : null;
    }

    private void EmitLog(string line) => Log?.Invoke(line);

    public void Dispose()
    {
        _disposed = true;
        _processLoopback.Dispose();
        _endpointLoopback.Dispose();
        _mic.Dispose();
        _socket.Dispose();
    }
}
