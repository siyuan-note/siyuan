param([string]$WindowHandle, [string]$Points)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SettingsHitTest {
    [StructLayout(LayoutKind.Sequential)]
    public struct Point { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll")]
    public static extern bool GetClientRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")]
    public static extern bool ClientToScreen(IntPtr window, ref Point point);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam,
        IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
    public static long HitTest(long handle, double x, double y) {
        var window = new IntPtr(handle);
        Rect rect;
        if (!GetClientRect(window, out rect)) throw new Exception("GetClientRect failed");
        var point = new Point { X = (int)Math.Round(x * (rect.Right - rect.Left)),
            Y = (int)Math.Round(y * (rect.Bottom - rect.Top)) };
        if (!ClientToScreen(window, ref point)) throw new Exception("ClientToScreen failed");
        var position = new IntPtr((point.Y << 16) | (point.X & 0xffff));
        UIntPtr result;
        if (SendMessageTimeout(window, 0x84, IntPtr.Zero, position, 2, 3000, out result) == IntPtr.Zero)
            throw new Exception("WM_NCHITTEST failed");
        return (long)result.ToUInt64();
    }
}
'@

$results = @()
foreach ($point in ($Points | ConvertFrom-Json)) {
    $results += [SettingsHitTest]::HitTest([long]$WindowHandle, [double]$point.x, [double]$point.y)
}
ConvertTo-Json -InputObject $results -Compress
