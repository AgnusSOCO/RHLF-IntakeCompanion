using System.Text.Json;

namespace Rhlf.IntakeCompanion;

/// <summary>
/// Per-user companion settings persisted to
/// %APPDATA%\RHLF\IntakeCompanion\config.json so the exe can be double-clicked.
/// Command-line args override saved values.
/// </summary>
internal sealed class CompanionConfig
{
    public string Server { get; set; } = DefaultServer;
    public string? Extension { get; set; }
    public string? Token { get; set; }
    public string ProcessName { get; set; } = "RingCentral";
    public string LoopbackMode { get; set; } = "auto";

    public const string DefaultServer = "wss://rhlf-intake-assistant-production.up.railway.app";

    private static string ConfigDir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "RHLF", "IntakeCompanion");
    private static string FilePath => Path.Combine(ConfigDir, "config.json");

    public static CompanionConfig Load()
    {
        try
        {
            if (File.Exists(FilePath))
            {
                var cfg = JsonSerializer.Deserialize<CompanionConfig>(File.ReadAllText(FilePath));
                if (cfg is not null) return cfg;
            }
        }
        catch { /* fall through to defaults */ }
        return new CompanionConfig();
    }

    public void Save()
    {
        Directory.CreateDirectory(ConfigDir);
        File.WriteAllText(FilePath, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
    }
}
