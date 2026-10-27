# 睡眠行为测试：系统空闲达到阈值后入睡，点击唤醒
# 规则：白天 3 分钟、夜间 1 分钟（由 GetLastInputInfo 的系统空闲时间驱动）
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'bin\CatPet.exe'
$stats = Join-Path $env:APPDATA 'CatPet\stats.json'

Add-Type @"
using System;
using System.Runtime.InteropServices;
public struct RCS { public int L,T,R,B; }
public static class WS {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RCS r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, UIntPtr e);
  public static IntPtr Pet(uint pid) { IntPtr f=IntPtr.Zero; EnumWindows((h,l)=>{ uint p; GetWindowThreadProcessId(h,out p); if(p==pid&&IsWindowVisible(h)){ RCS r; GetWindowRect(h,out r); int w=r.R-r.L; if(w>150&&w<800){f=h;return false;} } return true;},IntPtr.Zero); return f; }
}
"@

$ok = $false
Get-Process CatPet -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$env:CATPET_STATS = '1'
Remove-Item $stats -ErrorAction SilentlyContinue
$proc = Start-Process -FilePath $exe -PassThru
try {
    Start-Sleep -Seconds 5
    # 先点一下确保是清醒状态，再验证"空闲 -> 入睡"的完整过程
    $h0 = [WS]::Pet([uint32]$proc.Id)
    $r0 = New-Object RCS; [void][WS]::GetWindowRect($h0, [ref]$r0)
    [void][WS]::SetCursorPos(($r0.L + 140), ($r0.T + 220)); Start-Sleep -Milliseconds 200
    [WS]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 40; [WS]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)
    Start-Sleep -Seconds 2
    $mode0 = (Get-Content $stats -Raw | ConvertFrom-Json).mode
    "点击唤醒后: $mode0"

    # 保持不动，等系统空闲达到阈值（夜间 60s，最多等 210s 兼容白天 180s 规则）
    $mode = $mode0
    $waited = 0
    while ($waited -lt 210) {
        Start-Sleep -Seconds 5
        $waited += 5
        $mode = (Get-Content $stats -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json).mode
        if ($mode -eq 'Sleeping') { break }
    }
    "等待 ${waited}s 后: $mode"
    $slept = ($mode -eq 'Sleeping')

    # 点击唤醒
    $h = [WS]::Pet([uint32]$proc.Id)
    $r = New-Object RCS; [void][WS]::GetWindowRect($h, [ref]$r)
    [void][WS]::SetCursorPos(($r.L + 140), ($r.T + 220)); Start-Sleep -Milliseconds 200
    [WS]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 40; [WS]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)
    Start-Sleep -Seconds 2
    $mode2 = (Get-Content $stats -Raw | ConvertFrom-Json).mode
    "点击后: $mode2"
    $woke = ($mode2 -ne 'Sleeping')

    "OK   空闲后入睡: $slept"
    "OK   点击唤醒: $woke"
    if (-not ($slept -and $woke)) { exit 1 }
}
finally {
    Get-Process CatPet -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Remove-Item Env:CATPET_STATS -ErrorAction SilentlyContinue
}
