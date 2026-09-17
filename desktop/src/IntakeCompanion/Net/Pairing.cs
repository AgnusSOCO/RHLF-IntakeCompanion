using System.Net.Http.Json;
using System.Text.Json;

namespace Rhlf.IntakeCompanion.Net;

/// <summary>
/// One-time pairing-code exchange: the dashboard mints a 6-digit code per
/// extension; the companion trades it for a durable per-extension token.
/// </summary>
internal static class Pairing
{
    /// <summary>A 6-digit code, as opposed to a raw agent token.</summary>
    public static bool LooksLikeCode(string secret) =>
        secret.Length == 6 && secret.All(char.IsDigit);

    /// <returns>(token, name) on success, null on invalid/expired code or network error.</returns>
    public static async Task<(string Token, string? Name)?> ExchangeAsync(
        string server, string extensionId, string code)
    {
        try
        {
            var ub = new UriBuilder(server.TrimEnd('/'));
            ub.Scheme = ub.Scheme.StartsWith("wss") ? "https" : "http";
            ub.Path = "/api/pair/exchange";
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
            var res = await client.PostAsJsonAsync(ub.Uri, new { extensionId, code });
            if (!res.IsSuccessStatusCode) return null;
            var doc = await res.Content.ReadFromJsonAsync<JsonElement>();
            var token = doc.GetProperty("token").GetString();
            var name = doc.TryGetProperty("name", out var n) && n.ValueKind == JsonValueKind.String
                ? n.GetString() : null;
            return token is null ? null : (token, name);
        }
        catch
        {
            return null;
        }
    }
}
