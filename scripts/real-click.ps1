param([int]$X, [int]$Y)
# Real OS-level mouse click at physical screen coordinates (goes through Windows hit-testing, unlike test-tool clicks).
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Mouse {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
"@
[Mouse]::SetProcessDPIAware() | Out-Null
[Mouse]::SetCursorPos($X, $Y) | Out-Null
Start-Sleep -Milliseconds 150
[Mouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero) # left down
Start-Sleep -Milliseconds 60
[Mouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero) # left up
