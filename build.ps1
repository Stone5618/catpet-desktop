# 编译原生工程
#   .\build.ps1              -> 控制台版（开发用，能看到 --selftest 输出）
#   .\build.ps1 -Gui         -> 窗口版（发布用，无控制台）
param([switch]$Gui)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# 优先用 VS 自带的 Roslyn（支持现代 C#），退回系统 csc
$roslyn = Get-ChildItem "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\*\MSBuild\Current\Bin\Roslyn\csc.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
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

$size = [math]::Round((Get-Item $out).Length / 1KB, 1)
Write-Host "编译完成: $out ($size KB)" -ForegroundColor Green
