# 真实鼠标/窗口级冒烟测试：验证穿透、点击、拖拽、抛掷、单实例
# 运行：powershell -NoProfile -ExecutionPolicy Bypass -File test/os/smoke.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$exe = Join-Path $root 'node_modules\electron\dist\electron.exe'
$artifacts = Join-Path $root 'test\artifacts'
New-Item -ItemType Directory -Force -Path $artifacts | Out-Null

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public struct RECT { public int Left, Top, Right, Bottom; }
public struct POINT { public int X, Y; }
public static class Win32 {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
}
"@

$results = New-Object System.Collections.ArrayList
function Record([string]$name, [bool]$ok, [string]$detail = '') {
  [void]$results.Add([pscustomobject]@{ name = $name; ok = $ok; detail = $detail })
  $mark = if ($ok) { 'OK  ' } else { 'FAIL' }
  Write-Host "$mark $name $(if ($detail) { '— ' + $detail })"
}

function Get-Rect([IntPtr]$h) {
  $r = New-Object RECT
  [void][Win32]::GetWindowRect($h, [ref]$r)
  return $r
}

function Click-At([int]$x, [int]$y) {
  [void][Win32]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 500
  [Win32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [Win32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
}

$userData = Join-Path $env:TEMP ("catpet-os-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $userData | Out-Null
$env:ELECTRON_RUN_AS_NODE = $null
$env:CATPET_USERDATA = $userData

$proc = Start-Process -FilePath $exe -ArgumentList '.' -WorkingDirectory $root -PassThru

$hwnd = [IntPtr]::Zero
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 400
  $p = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
  if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) { $hwnd = $p.MainWindowHandle; break }
}

if ($hwnd -eq [IntPtr]::Zero) {
  Record '窗口创建' $false '拿不到窗口句柄'
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  exit 1
}
Record '窗口创建' $true ("hwnd=0x{0:X}" -f [int64]$hwnd)

Start-Sleep -Milliseconds 2500
$rect = Get-Rect $hwnd
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
Record '窗口尺寸 320x380（无 DPI 缩放偏差）' ($width -eq 320 -and $height -eq 380) "$width x $height"

$screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
Record '窗口位于工作区内' ($rect.Right -le $screen.Right -and $rect.Bottom -le $screen.Bottom) `
  ("rect=($($rect.Left),$($rect.Top))-($($rect.Right),$($rect.Bottom)) work=($($screen.Width)x$($screen.Height))")

# 从遮罩里取一个位于猫身中部的实心格，作为"猫身上"的坐标
$mask = Get-Content (Join-Path $root 'renderer\hitmask.json') -Raw | ConvertFrom-Json
$solid = @()
for ($r = 0; $r -lt $mask.rows; $r++) {
  for ($c = 0; $c -lt $mask.cols; $c++) {
    if ($mask.cells[$r][$c]) { $solid += [pscustomobject]@{ r = $r; c = $c } }
  }
}
$mid = $solid[[int]($solid.Count / 2)]
$offsetX = [int](($mid.c + 0.5) / $mask.cols * $width)
$offsetY = [int](($mid.r + 0.5) / $mask.rows * $height)
Record '遮罩中心格可解析' ($solid.Count -gt 50) "cell=($($mid.c),$($mid.r)) offset=($offsetX,$offsetY)"

$headX = $rect.Left + $offsetX
$headY = $rect.Top + $offsetY
$cornerX = $rect.Left + 6
$cornerY = $rect.Top + 6

$point = New-Object POINT
$point.X = $headX; $point.Y = $headY
[void][Win32]::SetCursorPos($headX, $headY)
Start-Sleep -Milliseconds 300
$overCat = [Win32]::GetAncestor([Win32]::WindowFromPoint($point), 2)
Record '猫身上命中自身窗口' ($overCat -eq $hwnd) ("root=0x{0:X}" -f [int64]$overCat)

$point.X = $cornerX; $point.Y = $cornerY
[void][Win32]::SetCursorPos($cornerX, $cornerY)
Start-Sleep -Milliseconds 300
$overCorner = [Win32]::GetAncestor([Win32]::WindowFromPoint($point), 2)
Record '透明角落穿透到下层窗口' ($overCorner -ne $hwnd) ("root=0x{0:X}" -f [int64]$overCorner)

# 点击猫 -> 亲密度 +1
Click-At $headX $headY
Start-Sleep -Milliseconds 1200
$stateFile = Join-Path $userData 'state.json'
$affinity = -1
if (Test-Path $stateFile) { $affinity = (Get-Content $stateFile -Raw | ConvertFrom-Json).affinity }
Record '真实点击生效（亲密度 +1）' ($affinity -eq 1) "affinity=$affinity"

# 拖拽：按住猫头向左拖 150px
[void][Win32]::SetCursorPos($headX, $headY)
Start-Sleep -Milliseconds 80
[Win32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
for ($i = 1; $i -le 10; $i++) {
  [void][Win32]::SetCursorPos($headX - 15 * $i, $headY)
  Start-Sleep -Milliseconds 30
}
[Win32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 700

$moved = Get-Rect $hwnd
$dx = $moved.Left - $rect.Left
Record '拖拽移动窗口' ([Math]::Abs($dx + 150) -le 25) "dx=$dx"

# 抛掷：快速向右甩 300px 后松手，应落到屏幕底部并停住
$head2X = $moved.Left + $offsetX
$head2Y = $moved.Top + $offsetY
[void][Win32]::SetCursorPos($head2X, $head2Y)
Start-Sleep -Milliseconds 80
[Win32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
for ($i = 1; $i -le 6; $i++) {
  [void][Win32]::SetCursorPos($head2X + 50 * $i, $head2Y)
  Start-Sleep -Milliseconds 12
}
[Win32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 3200

$landed = Get-Rect $hwnd
Start-Sleep -Milliseconds 600
$landed2 = Get-Rect $hwnd
$bottomGap = $screen.Bottom - $landed.Bottom
Record '抛掷后落到屏幕底部' ([Math]::Abs($bottomGap) -le 4) "bottomGap=$bottomGap"
Record '落地后静止不动' ($landed.Top -eq $landed2.Top -and $landed.Left -eq $landed2.Left) `
  ("($($landed.Left),$($landed.Top)) -> ($($landed2.Left),$($landed2.Top))")
Record '落地后仍在屏幕内' ($landed.Left -ge $screen.Left -and $landed.Right -le $screen.Right) `
  ("left=$($landed.Left) right=$($landed.Right)")

# 单实例：再启动一个，应该自己退出
$second = Start-Process -FilePath $exe -ArgumentList '.' -WorkingDirectory $root -PassThru
Start-Sleep -Seconds 4
$secondAlive = -not $second.HasExited
Record '重复启动自动退出（单实例）' (-not $secondAlive) "secondExited=$($second.HasExited)"
if ($secondAlive) { Stop-Process -Id $second.Id -Force -ErrorAction SilentlyContinue }

# 桌面截图留证
$bmp = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($screen.Left, $screen.Top, 0, 0, $bmp.Size)
$bmp.Save((Join-Path $artifacts 'os-desktop.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()

Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Get-Process -Name electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | Stop-Process -Force -ErrorAction SilentlyContinue

$failed = @($results | Where-Object { -not $_.ok })
$report = [pscustomobject]@{
  createdAt = (Get-Date).ToString('o')
  total = $results.Count
  passed = $results.Count - $failed.Count
  failed = $failed.Count
  results = $results
}
$report | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $artifacts 'os-result.json') -Encoding UTF8
Write-Host "`nOS 冒烟: $($report.passed)/$($report.total) 通过"
if ($failed.Count -gt 0) { exit 1 }

