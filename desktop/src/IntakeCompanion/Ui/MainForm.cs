using Microsoft.Web.WebView2.WinForms;

namespace Rhlf.IntakeCompanion.Ui;

/// <summary>
/// Tray app + transcript window. The transcript/guidance surface is the
/// backend-hosted agent UI loaded in WebView2; if the WebView2 runtime is
/// absent we fall back to a status/log panel.
/// </summary>
internal sealed class MainForm : Form
{
    private readonly CompanionController _controller;
    private readonly string _uiUrl;

    private readonly NotifyIcon _tray;
    private readonly ToolStripMenuItem _pauseItem;
    private readonly ToolStripMenuItem _statusItem;
    private readonly Label _statusLabel;
    private readonly TextBox _logBox;
    private WebView2? _web;
    private Icon _appIcon;
    private bool _reallyClose;

    public MainForm(CompanionController controller, string uiUrl)
    {
        _controller = controller;
        _uiUrl = uiUrl;

        Text = "RHLF Intake Assistant";
        Width = 420; Height = 680;
        StartPosition = FormStartPosition.CenterScreen;
        ShowIcon = true;

        var iconStream = typeof(MainForm).Assembly
            .GetManifestResourceStream("Rhlf.IntakeCompanion.app.ico");
        _appIcon = iconStream is not null ? new Icon(iconStream) : SystemIcons.Application;
        Icon = _appIcon;

        _statusLabel = new Label
        {
            Dock = DockStyle.Top,
            Height = 28,
            TextAlign = System.Drawing.ContentAlignment.MiddleLeft,
            Padding = new Padding(8, 0, 0, 0),
        };
        _logBox = new TextBox
        {
            Dock = DockStyle.Fill,
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
            Visible = false,
        };
        Controls.Add(_logBox);
        Controls.Add(_statusLabel);

        _statusItem = new ToolStripMenuItem("Status: connecting") { Enabled = false };
        _pauseItem = new ToolStripMenuItem("Pause capture", null, (_, _) => _controller.TogglePause());
        var menu = new ContextMenuStrip();
        menu.Items.Add(_statusItem);
        menu.Items.Add(new ToolStripMenuItem("Open assistant", null, (_, _) => ShowWindow()));
        menu.Items.Add(_pauseItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("Exit", null, (_, _) => ReallyClose()));

        _tray = new NotifyIcon
        {
            Icon = _appIcon,
            Text = "RHLF Intake Assistant",
            Visible = true,
            ContextMenuStrip = menu,
        };
        _tray.DoubleClick += (_, _) => ShowWindow();

        _controller.Log += line => BeginInvoke(() => AppendLog(line));
        _controller.StateChanged += () => BeginInvoke(RefreshStatus);
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        RefreshStatus();
        await InitWebViewAsync();
        _ = _controller.StartAsync();
    }

    private async Task InitWebViewAsync()
    {
        try
        {
            if (string.IsNullOrEmpty(Microsoft.Web.WebView2.Core.CoreWebView2Environment
                    .GetAvailableBrowserVersionString()))
                throw new InvalidOperationException("WebView2 runtime not installed");

            _web = new WebView2 { Dock = DockStyle.Fill };
            Controls.Add(_web);
            Controls.SetChildIndex(_web, 0); // above log, below status label
            await _web.EnsureCoreWebView2Async();
            _web.CoreWebView2.Navigate(_uiUrl);
            AppendLog($"[ui] loaded {_uiUrl}");
        }
        catch (Exception ex)
        {
            _web?.Dispose();
            _web = null;
            _logBox.Visible = true;
            AppendLog($"[ui] WebView2 unavailable ({ex.Message}); showing status view. " +
                      "Install the WebView2 runtime for the transcript view.");
        }
    }

    private void RefreshStatus()
    {
        var status = !_controller.Connected ? "disconnected"
            : _controller.OnCall ? (_controller.Paused ? "on call - paused" : "on call")
            : "idle - waiting for call";
        _statusLabel.Text = $"Ext {_controller.ExtensionId}: {status}";
        _statusItem.Text = $"Status: {status}";
        _pauseItem.Text = _controller.Paused ? "Resume capture" : "Pause capture";
        _tray.Text = $"RHLF Intake Assistant - {status}";

        if (_controller.OnCall && _controller.Capturing)
            _tray.BalloonTipText = "Call in progress - assistant is listening.";
        else if (_controller.OnCall)
            _tray.BalloonTipText = "Call in progress - audio capture unavailable (see window).";
    }

    private void AppendLog(string line)
    {
        _logBox.AppendText(line + Environment.NewLine);
        if (!_logBox.Visible && _web is null) _logBox.Visible = true;
    }

    private void ShowWindow()
    {
        Show();
        WindowState = FormWindowState.Normal;
        Activate();
    }

    private void ReallyClose()
    {
        _reallyClose = true;
        _tray.Visible = false;
        _ = _controller.ShutdownAsync();
        Close();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!_reallyClose && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true; // hide to tray instead of quitting
            Hide();
        }
        base.OnFormClosing(e);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _tray.Dispose();
            _web?.Dispose();
        }
        base.Dispose(disposing);
    }
}
