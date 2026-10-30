# 真实点击菜单项的端到端测试：右键弹出菜单后用真实鼠标移动+点击选中菜单项。
# 与 menu.ps1 的 PostMessage 注入互补——那条路径测不出 TPM_RETURNCMD 吞 WM_COMMAND 的 bug。
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'bin\CatPet-debug.exe'
$statePath = Join-Path $env:APPDATA 'CatPet\state.json'

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public struct RCR { public int L,T,R,B; }
public struct PPR { public int X,Y; }
public static class RC {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RCR r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(PPR p);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  public static IntPtr PetWin(uint pid) {
    IntPtr f=IntPtr.Zero;
    EnumWindows((h,l)=>{ uint p; GetWindowThreadProcessId(h,out p);
      if(p==pid&&IsWindowVisible(h)){ RCR r; GetWindowRect(h,out r); int w=r.R-r.L; if(w>150&&w<800){f=h;return false;} }
      return true;},IntPtr.Zero);
    return f;
  }
  public static IntPtr MenuWin() {
    // #32768 是系统弹出菜单窗口类
    return FindWindowRaw("#32768");
  }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  public static IntPtr FindWindowRaw(string cls){ return FindWindow(cls, null); }
  public static IntPtr MenuItemAt(int x, int y) {
    PPR p; p.X=x; p.Y=y; return WindowFromPoint(p);
  }
}
"@

function Record([string]$name, [bool]$ok, [string]$detail = '') {
    Write-Host ("{0} {1} {2}" -f $(if ($ok) { 'OK  ' } else { 'FAIL' }), $name, $(if ($detail) { '— ' + $detail }))
    if (-not $ok) { $script:failed = $script:failed + 1 }
}
$script:failed = 0

function Get-State { if (Test-Path $statePath) { Get-Content $statePath -Raw | ConvertFrom-Json } else { $null } }

function LeftClick([int]$x, [int]$y) {
    [void][RC]::SetCursorPos($x, $y); Start-Sleep -Milliseconds 150
    [RC]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 50
    [RC]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 300
}
function RightClick([int]$x, [int]$y) {
    [void][RC]::SetCursorPos($x, $y); Start-Sleep -Milliseconds 150
    [RC]::mouse_event(0x0008,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 50
    [RC]::mouse_event(0x0010,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 600
}

# 在弹出菜单上找到指定文字的条目并真实点击。
# 弹出菜单条目不是子窗口 HWND、IAccessible 跨程序集在 pwsh7 下引用成本高，
# 而本菜单布局是固定的（8 项 + 2 条分隔线，首项"摸摸头"、末项"退出"），
# 因此用确定性几何：行高 = 菜单高 / 10。
Add-Type @"
using System;
using System.Runtime.InteropServices;
public struct MIR { public int L,T,R,B; }
public static class MenuGeom {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out MIR r);
  // 行序（含分隔线共 10 行）：0摸 1喂 2分隔 3面板 4藏显 5置顶 6静音 7分隔 8换猫 9退出
  public static bool ItemCenter(IntPtr menu, int row, out int cx, out int cy) {
    cx = 0; cy = 0;
    MIR r;
    if (!GetWindowRect(menu, out r)) return false;
    int h = r.B - r.T;
    if (h < 60) return false;
    double rowH = h / 10.0;
    cx = (r.L + r.R) / 2;
    cy = (int)(r.T + rowH * (row + 0.5));
    return true;
  }
}
"@

Get-Process CatPet* -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Remove-Item $statePath -ErrorAction SilentlyContinue
$proc = Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds 4

try {
    $h = [RC]::PetWin([uint32]$proc.Id)
    if ($h -eq [IntPtr]::Zero) { throw "找不到猫窗口" }
    $r = New-Object RCR; [void][RC]::GetWindowRect($h, [ref]$r)
    $cx = [int](($r.L + $r.R) / 2); $cy = [int](($r.T + $r.B) / 2)

    # ---- 测试 1：真实右键弹菜单，真实点击「摸摸头」 → 亲密度 +1 ----
    $a0 = (Get-State).Affinity
    RightClick $cx ($r.T + 200)
    $menu = [RC]::MenuWin()
    Record '真实右键弹出菜单' ($menu -ne [IntPtr]::Zero)
    if ($menu -ne [IntPtr]::Zero) {
        $ix = 0; $iy = 0
        $found = [MenuGeom]::ItemCenter($menu, 0, [ref]$ix, [ref]$iy)
        Record '菜单几何定位（首项=摸摸头）' $found
        if ($found) {
            LeftClick $ix $iy
            Start-Sleep -Milliseconds 900
            $a1 = (Get-State).Affinity
            # 延迟结算 360ms 已过；若 P0 bug 存在这里 a1 == a0
            Record '真实点击摸摸头 → 亲密度+1（P0 修复验证）' ($a1 -eq $a0 + 1) ("$a0 -> $a1")
        }
    }

    # ---- 测试 2：真实点击「退出」 → 进程结束 ----
    $mr = New-Object RCR; [void][RC]::GetWindowRect($h, [ref]$mr)
    RightClick $cx ($mr.T + 200)
    $menu2 = [RC]::MenuWin()
    if ($menu2 -ne [IntPtr]::Zero) {
        $ex2 = 0; $ey2 = 0
        if ([MenuGeom]::ItemCenter($menu2, 9, [ref]$ex2, [ref]$ey2)) {
            LeftClick $ex2 $ey2
            Start-Sleep -Seconds 2
            Record '真实点击退出 → 进程结束' ($proc.HasExited)
        } else {
            Record '找到退出条目' $false
            # 用 ESC 关掉菜单避免悬挂
            [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
        }
    } else {
        Record '第二次弹出菜单' $false
    }
}
catch {
    Record '测试异常' $false $_.Exception.Message
}
finally {
    Get-Process CatPet* -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

Write-Host ""
if ($script:failed -gt 0) { Write-Host "真实点击菜单测试: FAIL ($script:failed)"; exit 1 }
else { Write-Host "真实点击菜单测试: ALL PASS"; exit 0 }
