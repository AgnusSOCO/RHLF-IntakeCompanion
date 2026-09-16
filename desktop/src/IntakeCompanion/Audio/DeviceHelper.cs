using NAudio.CoreAudioApi;

namespace Rhlf.IntakeCompanion.Audio;

internal static class DeviceHelper
{
    /// <summary>Default endpoint if usable, else first Active endpoint of that flow.</summary>
    public static MMDevice PickDevice(DataFlow flow, Role role)
    {
        using var en = new MMDeviceEnumerator();
        try
        {
            var def = en.GetDefaultAudioEndpoint(flow, role);
            if (def.State == DeviceState.Active) return def;
            def.Dispose();
        }
        catch { /* no default */ }

        var first = en.EnumerateAudioEndPoints(flow, DeviceState.Active).FirstOrDefault();
        if (first is null)
            throw new InvalidOperationException($"No active {flow} audio endpoint found");
        return first;
    }

    public static string DescribeDevices()
    {
        var sb = new System.Text.StringBuilder();
        using var en = new MMDeviceEnumerator();
        foreach (var flow in new[] { DataFlow.Render, DataFlow.Capture })
        {
            sb.AppendLine($"-- {flow} endpoints --");
            foreach (var d in en.EnumerateAudioEndPoints(flow, DeviceState.All))
            {
                sb.AppendLine($"  [{d.State}] {d.FriendlyName}");
                d.Dispose();
            }
        }
        try
        {
            var defR = en.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
            sb.AppendLine($"default render: {defR.FriendlyName} [{defR.State}]");
            defR.Dispose();
        }
        catch (Exception e) { sb.AppendLine($"default render: none ({e.Message})"); }
        try
        {
            var defC = en.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Communications);
            sb.AppendLine($"default capture: {defC.FriendlyName} [{defC.State}]");
            defC.Dispose();
        }
        catch (Exception e) { sb.AppendLine($"default capture: none ({e.Message})"); }
        return sb.ToString();
    }
}
