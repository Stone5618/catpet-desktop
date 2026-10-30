# 编译原生工程
#   .\build.ps1              -> 控制台版（开发用，能看到 --selftest 输出）
#   .\build.ps1 -Gui         -> 窗口版（发布用，无控制台）
# 也支持环境变量覆盖：CATPET_GUI=1 时强制窗口版
param([switch]$Gui)

$ErrorActionPreference = 'Stop'
# 用 $MyInvocation 取脚本路径：$PSScriptRoot 在中文路径 + 某些宿主下会返回乱码
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($env:CATPET_GUI -eq '1') { $Gui = $true }

# 优先用 VS 自带的 Roslyn（支持现代 C#），退回系统 csc
$roots = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio'),
    (Join-Path ${env:ProgramFiles}   'Microsoft Visual Studio')
) | Where-Object { Test-Path $_ }
$candidates = foreach ($r in $roots) {
    Get-ChildItem $r -Recurse -Filter csc.exe -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match 'MSBuild\\Current\\Bin\\Roslyn\\csc\.exe$' }
}
$roslyn = $candidates | Select-Object -First 1
$csc = if ($roslyn) { $roslyn.FullName } else { Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw "找不到 csc.exe" }

$fw = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$refs = @('mscorlib.dll', 'System.dll', 'System.Core.dll', 'System.Drawing.dll',
          'System.Windows.Forms.dll', 'System.Web.Extensions.dll') |
        ForEach-Object { '/reference:' + (Join-Path $fw $_) }

$outDir = Join-Path $root 'bin'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$target = if ($Gui) { 'winexe' } else { 'exe' }
$out = Join-Path $outDir $(if ($Gui) { 'CatPet.exe' } else { 'CatPet-debug.exe' })

$sources = Get-ChildItem (Join-Path $root 'src') -Recurse -Filter *.cs | ForEach-Object { $_.FullName }
$cscArgs = @('/nologo', '/nostdlib+', '/langversion:7.3', ('/target:' + $target), ('/out:' + $out), '/optimize+', ('/win32icon:' + (Join-Path $root 'assets\cat.ico'))) + $refs + $sources

& $csc @cscArgs
if ($LASTEXITCODE -ne 0) { throw "编译失败 ($LASTEXITCODE)" }

Copy-Item (Join-Path $root 'assets') $outDir -Recurse -Force
$size = [math]::Round((Get-Item $out).Length / 1KB, 1)
Write-Host "编译完成: $out ($size KB)" -ForegroundColor Green
