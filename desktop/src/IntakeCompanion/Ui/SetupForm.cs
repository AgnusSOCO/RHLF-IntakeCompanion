namespace Rhlf.IntakeCompanion.Ui;

/// <summary>
/// First-run setup dialog shown when extension/token are missing.
/// Values persist via <see cref="CompanionConfig"/>.
/// </summary>
internal sealed class SetupForm : Form
{
    private readonly TextBox _server;
    private readonly TextBox _extension;
    private readonly TextBox _token;
    private readonly TextBox _name;
    private readonly CompanionConfig _config;

    public SetupForm(CompanionConfig config)
    {
        _config = config;
        Text = "RHLF Intake Assistant - Setup";
        Width = 460; Height = 280;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 2,
            Padding = new Padding(16),
        };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 90));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        Controls.Add(layout);

        _server = AddRow(layout, "Server", config.Server, 0);
        _extension = AddRow(layout, "Extension", config.Extension ?? "", 1);
        _token = AddRow(layout, "Pairing code", config.Token ?? "", 2);
        _name = AddRow(layout, "Your name", config.Name ?? "", 3);

        var start = new Button { Text = "Save && Start", Dock = DockStyle.Fill, Height = 30 };
        start.Click += (_, _) =>
        {
            if (string.IsNullOrWhiteSpace(_extension.Text) || string.IsNullOrWhiteSpace(_token.Text))
            {
                MessageBox.Show(
                    "Extension and pairing code are required.\n\n" +
                    "Get a pairing code from your supervisor dashboard\n" +
                    "(Live calls → Pair agent), or enter an agent token.",
                    "Setup", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            _config.Server = _server.Text.Trim();
            _config.Extension = _extension.Text.Trim();
            _config.Token = _token.Text.Trim();
            _config.Name = string.IsNullOrWhiteSpace(_name.Text) ? null : _name.Text.Trim();
            DialogResult = DialogResult.OK;
            Close();
        };
        layout.Controls.Add(start, 0, 4);
        layout.SetColumnSpan(start, 2);
        AcceptButton = start;
    }

    private static TextBox AddRow(TableLayoutPanel layout, string label, string value, int row)
    {
        layout.Controls.Add(new Label
        {
            Text = label,
            Dock = DockStyle.Fill,
            TextAlign = System.Drawing.ContentAlignment.MiddleLeft,
        }, 0, row);
        var box = new TextBox { Text = value, Dock = DockStyle.Fill };
        layout.Controls.Add(box, 1, row);
        return box;
    }
}
