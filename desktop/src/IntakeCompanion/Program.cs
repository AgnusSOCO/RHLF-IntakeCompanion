using Rhlf.IntakeCompanion.Audio;
using Rhlf.IntakeCompanion.Ui;

namespace Rhlf.IntakeCompanion;

// IntakeCompanion — Windows tray app. Safe to double-click: settings persist to
// %APPDATA%\RHLF\IntakeCompanion\config.json and a setup dialog asks for the
// extension/token on first run.
//
//   IntakeCompanion [--server wss://host] [--extension <extId>] [--token <token>]
//                   [--process-name RingCentral] [--loopback-mode auto|process|endpoint]
//
// Captures RingCentral playback (channel 0) + agent mic (channel 1) only while
// the backend reports an active call. Tray menu = pause/resume/exit.
//
// --loopback-mode:
//   process  - capture only RingCentral's rendered audio (Windows build 20348+)
//   endpoint - capture all audio on the default output device (any Win10+);
//              WARNING: other apps' audio is captured too
//   auto     - process if supported, else endpoint with a warning (default)

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        string? GetArg(string name)
        {
            for (int i = 0; i < args.Length - 1; i++)
                if (args[i].Equals(name, StringComparison.OrdinalIgnoreCase))
                    return args[i + 1];
            return null;
        }
        bool HasArg(string name) =>
            args.Any(a => a.Equals(name, StringComparison.OrdinalIgnoreCase));

        ApplicationConfiguration.Initialize();

        // Single instance: two companions fighting over one extension flap the
        // backend socket. Second launch just reports and exits.
        using var mutex = new Mutex(true, @"Global\RHLF.IntakeCompanion.SingleInstance", out bool createdNew);
        if (!createdNew)
        {
            MessageBox.Show(
                "Intake Assistant is already running — check the system tray by the clock.",
                "RHLF Intake Assistant", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }

        if (HasArg("--diag"))
        {
            MessageBox.Show(DeviceHelper.DescribeDevices(), "IntakeCompanion - audio devices",
                MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }

        var cfg = CompanionConfig.Load();
        cfg.Server = GetArg("--server") ?? cfg.Server;
        cfg.Extension = GetArg("--extension") ?? cfg.Extension;
        cfg.Token = GetArg("--token") ?? cfg.Token;
        cfg.ProcessName = GetArg("--process-name") ?? cfg.ProcessName;
        cfg.LoopbackMode = GetArg("--loopback-mode") ?? cfg.LoopbackMode;

        if (cfg.Extension is null || cfg.Token is null)
        {
            using var setup = new SetupForm(cfg);
            if (setup.ShowDialog() != DialogResult.OK) return 1;
        }
        cfg.Save(); // persists CLI overrides too, so the next double-click just works

        using var controller = new CompanionController(
            cfg.Server, cfg.Extension!, cfg.Token!, cfg.ProcessName, cfg.LoopbackMode);
        Application.Run(new MainForm(controller, controller.UiUrl));
        return 0;
    }
}
