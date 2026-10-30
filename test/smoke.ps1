# 猫猫桌宠 v2 冒烟测试：真实鼠标/窗口 + UI Automation
# 用法： pwsh test/smoke.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'bin\CatPet.exe'
$statePath = Join-Path $env:APPDATA 'CatPet\state.json'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$results = New-Object System.Collections.ArrayList
function Record([string]$name, [bool]$ok, [string]$detail = '') {
    [void]$results.Add([pscustomobject]@{ name = $name; ok = $ok; detail = $detail })
    Write-Host ("{0} {1} {2}" -f $(if ($ok) { 'OK  ' } else { 'FAIL' }), $name, $(if ($detail) { '— ' + $detail }))
}

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public struct RCM { public int L,T,R,B; }
public struct PPM { public int X,Y; }
public static class NW {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RCM r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(PPM p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  public static IntPtr FindByWidth(uint pid, int width) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h,l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p == pid && IsWindowVisible(h)) { RCM r; GetWindowRect(h, out r); if ((r.R-r.L) == width) { found = h; return false; } }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static IntPtr FindAny(uint pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h,l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p == pid && IsWindowVisible(h)) { RCM r; GetWindowRect(h, out r); int w = r.R-r.L; if (w > 150 && w < 800) { found = h; return false; } }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static IntPtr FindByTitle(uint pid, string title) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h,l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      var sb = new StringBuilder(128); GetWindowText(h, sb, 128);
      if (p == pid && sb.ToString() == title) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@

function Click([int]$x, [int]$y) {
    [void][NW]::SetCursorPos($x, $y); Start-Sleep -Milliseconds 120
    [NW]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 40
    [NW]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 150
}
function Drag([int]$x, [int]$y, [int]$dx) {
    [void][NW]::SetCursorPos($x, $y); Start-Sleep -Milliseconds 120
    [NW]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 80
    foreach ($i in 1..5) { [void][NW]::SetCursorPos($x + [int]($dx * $i / 5), $y); Start-Sleep -Milliseconds 30 }
    [NW]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 500
}
function Get-State { if (Test-Path $statePath) { Get-Content $statePath -Raw | ConvertFrom-Json } else { $null } }

function Find-ByName($rootEl, [string]$name) {
    $cond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::NameProperty, $name)
    return $rootEl.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
}

function Find-Control($rootEl, [string]$name, $type) {
    $c1 = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::NameProperty, $name)
    $c2 = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty, $type)
    $and = New-Object System.Windows.Automation.AndCondition($c1, $c2)
    return $rootEl.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $and)
}

function Click-Element($el) {
    $rect = $el.Current.BoundingRectangle
    if ($rect.Width -le 0) { return }
    Click ([int]($rect.X + $rect.Width / 2)) ([int]($rect.Y + $rect.Height / 2))
}
function Invoke-Element($el) {
    $p = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $p.Invoke()
}
function Toggle-Element($el) {
    $p = $el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
    $p.Toggle()
}

Get-Process CatPet -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Remove-Item $statePath -ErrorAction SilentlyContinue
$proc = Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds 4

try {
    $pet = [NW]::FindAny([uint32]$proc.Id)
    $rr0 = New-Object RCM; if ($pet -ne [IntPtr]::Zero) { [void][NW]::GetWindowRect($pet, [ref]$rr0) }
    Record '主窗口创建' ($pet -ne [IntPtr]::Zero) ("$($rr0.R-$rr0.L)x$($rr0.B-$rr0.T)")
    if ($pet -eq [IntPtr]::Zero) { throw '主窗口未找到' }

    $r = New-Object RCM; [void][NW]::GetWindowRect($pet, [ref]$r)
    $ex = [NW]::GetWindowLong($pet, -20)
    Record '分层窗口（WS_EX_LAYERED）' (($ex -band 0x80000) -ne 0)
    Record '始终置顶（WS_EX_TOPMOST）' (($ex -band 0x8) -ne 0)
    Record '不进 Alt-Tab（WS_EX_TOOLWINDOW）' (($ex -band 0x80) -ne 0)

    $cat = New-Object PPM; $cat.X = $r.L + 140; $cat.Y = $r.T + 220
    $corner = New-Object PPM; $corner.X = $r.L + 6; $corner.Y = $r.T + 6
    Record '猫身命中自身窗口' ([NW]::GetAncestor([NW]::WindowFromPoint($cat), 2) -eq $pet)
    Record '透明区域穿透' ([NW]::GetAncestor([NW]::WindowFromPoint($corner), 2) -ne $pet)

    $s0 = Get-State
    Click $cat.X $cat.Y
    Start-Sleep -Milliseconds 600
    $s1 = Get-State
    Record '点击增加亲密度' ($s1.Affinity -gt $s0.Affinity) ("$($s0.Affinity) -> $($s1.Affinity)")
    Record '点击计入今日被摸' ($s1.TodayPetted -ge 1)

    $r2 = New-Object RCM; [void][NW]::GetWindowRect($pet, [ref]$r2)
    Drag ($r2.L + 140) ($r2.T + 220) -120
    $r3 = New-Object RCM; [void][NW]::GetWindowRect($pet, [ref]$r3)
    Record '拖拽位移约 -120px' ([Math]::Abs(($r3.L - $r2.L) + 120) -le 12) ("$($r3.L - $r2.L)px")
    $s2 = Get-State
    Record '拖拽后坐标落盘' ($s2.WindowX -eq $r3.L)

    # 右键菜单：应弹出系统菜单窗口（class #32768）
    $mr = New-Object RCM; [void][NW]::GetWindowRect($pet, [ref]$mr)
    [void][NW]::SetCursorPos(($mr.L + 140), ($mr.T + 220)); Start-Sleep -Milliseconds 200
    [NW]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 40
    [NW]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 600
    $menu = [NW]::FindWindow('#32768', $null)
    Record '右键菜单弹出' ($menu -ne [IntPtr]::Zero)
    [System.Windows.Forms.SendKeys]::SendWait("{ESC}")
    Start-Sleep -Milliseconds 500

    # 抛掷物理：快速拖动后松手，窗口应继续滑行
    $t0 = New-Object RCM; [void][NW]::GetWindowRect($pet, [ref]$t0)
    [void][NW]::SetCursorPos(($t0.L + 140), ($t0.T + 220)); Start-Sleep -Milliseconds 200
    [NW]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 40
    foreach ($i in 1..3) { [void][NW]::SetCursorPos(($t0.L + 140 - 50 * $i), ($t0.T + 220)); Start-Sleep -Milliseconds 25 }
    [NW]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 120
    $t1 = New-Object RCM; [void][NW]::GetWindowRect($pet, [ref]$t1)
    Start-Sleep -Milliseconds 350
    $t2 = New-Object RCM; [void][NW]::GetWindowRect($pet, [ref]$t2)
    Record '抛掷后继续滑行' ([Math]::Abs($t2.L - $t1.L) -ge 4) ("$($t1.L) -> $($t2.L)")

    # 等窗口停止滑动后再双击
    $prevX = -99999
    foreach ($i in 1..20) {
        Start-Sleep -Milliseconds 150
        $tmp = New-Object RCM; [void][NW]::GetWindowRect($pet, [ref]$tmp)
        if ($tmp.L -eq $prevX) { break }
        $prevX = $tmp.L
    }

    # 双击打开面板（两次点击间隔需 < 350ms）
    $r3 = New-Object RCM; [void][NW]::GetWindowRect($pet, [ref]$r3)
    $cat.X = $r3.L + 140; $cat.Y = $r3.T + 220
    [void][NW]::SetCursorPos($cat.X, $cat.Y); Start-Sleep -Milliseconds 200
    [NW]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 25
    [NW]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 60
    [NW]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 25
    [NW]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 900
    $panel = [NW]::FindByTitle([uint32]$proc.Id, '猫猫档案')
    Record '双击打开面板' ($panel -ne [IntPtr]::Zero)

    if ($panel -ne [IntPtr]::Zero) {
        $rootEl = [System.Windows.Automation.AutomationElement]::FromHandle($panel)

        # 静音（用 UIA 给出的精确矩形点击，避免坐标硬编码）
        $mute = Find-ByName $rootEl '静音'
        if ($mute) { Click-Element $mute; Start-Sleep -Milliseconds 400 }
        Record '静音开关生效' ((Get-State).Muted -eq $true)
        if ($mute) { Click-Element $mute; Start-Sleep -Milliseconds 300 }

        # 喂食（心情已满时会合理拒绝，两种结果都算通过）
        $feedBtn = Find-ByName $rootEl '喂小鱼干'
        $beforeFed = (Get-State).TodayFed
        if ($feedBtn) { Click-Element $feedBtn; Start-Sleep -Milliseconds 700 }
        $stFed = Get-State
        Record '面板喂食' (($stFed.TodayFed -gt $beforeFed) -or ($stFed.Mood -ge 92)) ("TodayFed $beforeFed -> $($stFed.TodayFed), Mood=$($stFed.Mood)")

        # 开机自启（双向验证：注册表状态应随开关翻转，与初始状态无关）
        $auto = Find-ByName $rootEl '开机自启'
        $regBefore = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue).CatPet
        if ($auto) { Click-Element $auto; Start-Sleep -Milliseconds 900 }
        $run = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue).CatPet
        $flipped1 = ($null -eq $regBefore) -ne ($null -eq $run)
        Record '开机自启翻转1' $flipped1 ("before=" + $(if ($regBefore) { 'SET' } else { 'NULL' }) + " after=" + $(if ($run) { 'SET' } else { 'NULL' }))
        if ($auto) { Click-Element $auto; Start-Sleep -Milliseconds 900 }
        $run2 = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue).CatPet
        $flipped2 = ($null -eq $run) -ne ($null -eq $run2)
        Record '开机自启翻转2' $flipped2 ("after2=" + $(if ($run2) { 'SET' } else { 'NULL' }))

        # 缩放 150%：点焦点到下拉框，用键盘选到最大档
        $combo = Find-ByName $rootEl '100%'
        if (-not $combo) { $combo = Find-ByName $rootEl '75%' }
        if ($combo) {
            Click-Element $combo
            Start-Sleep -Milliseconds 400
            [System.Windows.Forms.SendKeys]::SendWait("{DOWN}{DOWN}{ENTER}")
            Start-Sleep -Milliseconds 1200
        }
        $st = Get-State
        $big = [NW]::FindByWidth([uint32]$proc.Id, 362)
        Record '缩放至 150%' (([Math]::Abs($st.Scale - 1.5) -lt 0.01) -or ($big -ne [IntPtr]::Zero)) ("scale=" + $st.Scale)

        # 切换皮肤
        $beforeSkin = (Get-State).Skin
        $skinBtn = Find-ByName $rootEl '切换皮肤'
        if ($skinBtn) { Click-Element $skinBtn; Start-Sleep -Milliseconds 1200 }
        if ((Get-State).Skin -eq $beforeSkin -and $skinBtn) {
            Click-Element $skinBtn
            Start-Sleep -Milliseconds 1200
        }
        $afterSkin = (Get-State).Skin
        Record '切换皮肤' ($afterSkin -ne $beforeSkin) ("$beforeSkin -> $afterSkin")

        # 退出
        $quitBtn = Find-ByName $rootEl '退出'
        if ($quitBtn) { Click-Element $quitBtn }
        Start-Sleep -Seconds 2
        Record '面板退出按钮结束进程' ($proc.HasExited)
    }
}
catch {
    Record '测试流程异常' $false $_.Exception.Message
}
finally {
    Get-Process CatPet -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

$failed = @($results | Where-Object { -not $_.ok })
Write-Host ""
Write-Host ("冒烟测试: {0}/{1} 通过" -f ($results.Count - $failed.Count), $results.Count)
New-Item -ItemType Directory -Force -Path (Join-Path $root 'test') | Out-Null
$results | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $root 'test\smoke-result.json') -Encoding utf8BOM
if ($failed.Count -gt 0) { exit 1 }
