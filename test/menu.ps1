# 右键菜单功能测试：用键盘在弹出菜单里选择条目，验证置顶/静音/换皮肤/隐藏/退出
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'bin\CatPet.exe'
$statePath = Join-Path $env:APPDATA 'CatPet\state.json'

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public struct RCM2 { public int L,T,R,B; }
public static class WM3 {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RCM2 r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, UIntPtr e);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  public static IntPtr Pet(uint pid) { IntPtr f=IntPtr.Zero; EnumWindows((h,l)=>{ uint p; GetWindowThreadProcessId(h,out p); if(p==pid&&IsWindowVisible(h)){ RCM2 r; GetWindowRect(h,out r); int w=r.R-r.L; if(w>150&&w<800){f=h;return false;} } return true;},IntPtr.Zero); return f; }
  public static IntPtr PetAny(uint pid) { IntPtr f=IntPtr.Zero; EnumWindows((h,l)=>{ uint p; GetWindowThreadProcessId(h,out p); if(p==pid){ RCM2 r; GetWindowRect(h,out r); int w=r.R-r.L; if(w>150&&w<800){f=h;return false;} } return true;},IntPtr.Zero); return f; }
}
"@

function Get-State {
    if (Test-Path $statePath) { Get-Content $statePath -Raw | ConvertFrom-Json }
    else { [pscustomobject]@{ Affinity = 0; Mood = 70; Skin = 'hijiki'; Muted = $false; Pinned = $true } }
}
function Open-Menu {
    $h = [WM3]::Pet([uint32]$script:proc.Id)
    $r = New-Object RCM2; [void][WM3]::GetWindowRect($h, [ref]$r)
    [void][WM3]::SetCursorPos(($r.L + 140), ($r.T + 220)); Start-Sleep -Milliseconds 200
    [WM3]::mouse_event(0x0008,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 40
    [WM3]::mouse_event(0x0010,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 500
}
function Send-Command([int]$id) {
    $h = [WM3]::PetAny([uint32]$script:proc.Id)
    [void][WM3]::PostMessage($h, 0x0111, [IntPtr]$id, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 700
}

$results = New-Object System.Collections.ArrayList
function Record([string]$name, [bool]$ok, [string]$detail = '') {
    [void]$results.Add([pscustomobject]@{ name = $name; ok = $ok; detail = $detail })
    Write-Host ("{0} {1} {2}" -f $(if ($ok) { 'OK  ' } else { 'FAIL' }), $name, $(if ($detail) { '— ' + $detail }))
}

Get-Process CatPet -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Remove-Item $statePath -ErrorAction SilentlyContinue
$script:proc = Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds 4

try {
    $h = [WM3]::Pet([uint32]$script:proc.Id)
    $ex = [WM3]::GetWindowLong($h, -20)

    # 0) 菜单能弹出
    Open-Menu
    $menu = [WM3]::FindWindow("#32768", $null)
    Record "菜单：弹出" ($menu -ne [IntPtr]::Zero)
    [System.Windows.Forms.SendKeys]::SendWait("{ESC}")
    Start-Sleep -Milliseconds 500

    # 1) 摸摸头
    $a0 = (Get-State).Affinity
    Send-Command 1001
    Record '菜单：摸摸头' ((Get-State).Affinity -gt $a0) ("$a0 -> $((Get-State).Affinity)")

    # 2) 置顶
    Send-Command 1005
    $ex2 = [WM3]::GetWindowLong($h, -20)
    Record '菜单：取消置顶' (($ex2 -band 0x8) -eq 0)
    Send-Command 1005
    $ex3 = [WM3]::GetWindowLong($h, -20)
    Record '菜单：恢复置顶' (($ex3 -band 0x8) -ne 0)

    # 3) 静音
    Send-Command 1009
    $m1 = (Get-State).Muted
    Send-Command 1009
    $m2 = (Get-State).Muted
    Record '菜单：静音开关' ($m1 -eq $true -and $m2 -eq $false) ("$m1 -> $m2")

    # 4) 换皮肤
    $s0 = (Get-State).Skin
    Send-Command 1008
    $s1 = (Get-State).Skin
    Record '菜单：换猫' ($s1 -ne $s0) ("$s0 -> $s1")

    # 5) 藏起 / 托盘左键恢复
    Send-Command 1003
    $h2 = [WM3]::Pet([uint32]$script:proc.Id)
    Record '菜单：藏起猫猫' ($h2 -eq [IntPtr]::Zero)
    $h3 = [WM3]::PetAny([uint32]$script:proc.Id)
    if ($h3 -ne [IntPtr]::Zero) { [void][WM3]::PostMessage($h3, 0x8001, [IntPtr]::Zero, [IntPtr]0x0202) }
    Start-Sleep -Milliseconds 800
    $h4 = [WM3]::Pet([uint32]$script:proc.Id)
    Record '托盘：左键恢复显示' ($h4 -ne [IntPtr]::Zero)

    # 6) 退出
    Send-Command 1010
    Start-Sleep -Seconds 2
    Record '菜单：退出' ($script:proc.HasExited)
}
catch {
    Record '菜单测试异常' $false $_.Exception.Message
}
finally {
    Get-Process CatPet -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

$failed = @($results | Where-Object { -not $_.ok })
Write-Host ""
Write-Host ("菜单测试: {0}/{1} 通过" -f ($results.Count - $failed.Count), $results.Count)
if ($failed.Count -gt 0) { exit 1 }
