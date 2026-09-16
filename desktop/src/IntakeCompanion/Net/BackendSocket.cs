using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace Rhlf.IntakeCompanion.Net;

/// <summary>
/// WebSocket client to the intake-assistant backend (/audio endpoint).
/// Sends: JSON hello/control + binary audio frames (byte[0]=channel, rest=PCM).
/// Receives: callStart / callEnd / pause control messages.
/// </summary>
internal sealed class BackendSocket : IDisposable
{
    public event Action<JsonElement>? OnControl;
    public event Action? OnDisconnected;

    private readonly Uri _uri;
    private ClientWebSocket? _ws;
    private CancellationTokenSource? _cts;

    public BackendSocket(Uri uri) => _uri = uri;

    public bool IsConnected => _ws?.State == WebSocketState.Open;

    public async Task ConnectAsync(CancellationToken ct)
    {
        var old = _ws;
        _ws = new ClientWebSocket();
        try { old?.Dispose(); } catch { }
        await _ws.ConnectAsync(_uri, ct);
        _cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        _ = Task.Run(ReceiveLoop);
    }

    public Task SendJsonAsync(object msg)
    {
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(msg));
        return SendAsync(bytes, WebSocketMessageType.Text);
    }

    /// <param name="channel">0 = caller (RingCentral playback), 1 = agent (mic)</param>
    public Task SendAudioAsync(byte channel, byte[] pcm)
    {
        var frame = new byte[pcm.Length + 1];
        frame[0] = channel;
        Buffer.BlockCopy(pcm, 0, frame, 1, pcm.Length);
        return SendAsync(frame, WebSocketMessageType.Binary);
    }

    private async Task SendAsync(byte[] data, WebSocketMessageType type)
    {
        var ws = _ws;
        if (ws?.State != WebSocketState.Open) return;
        try
        {
            await ws.SendAsync(data, type, true, _cts?.Token ?? default);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[net] send failed: {ex.Message}");
        }
    }

    private async Task ReceiveLoop()
    {
        var ws = _ws!;
        var buf = new byte[8192];
        try
        {
            while (ws.State == WebSocketState.Open)
            {
                var result = await ws.ReceiveAsync(buf, _cts!.Token);
                if (result.MessageType == WebSocketMessageType.Close) break;
                if (result.MessageType != WebSocketMessageType.Text) continue;

                using var doc = JsonDocument.Parse(new ReadOnlyMemory<byte>(buf, 0, result.Count));
                OnControl?.Invoke(doc.RootElement.Clone());
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[net] receive error: {ex.Message}");
        }
        OnDisconnected?.Invoke();
    }

    public async Task CloseAsync()
    {
        _cts?.Cancel();
        if (_ws?.State == WebSocketState.Open)
        {
            try { await _ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "bye", default); }
            catch { }
        }
    }

    public void Dispose()
    {
        _cts?.Cancel();
        _ws?.Dispose();
    }
}
