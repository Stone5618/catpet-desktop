# 启动脚本：清掉 ELECTRON_RUN_AS_NODE 再拉起 Electron
# （某些终端环境会设置该变量，导致 electron.exe 退化成普通 Node，报 ipcMain undefined）
$env:ELECTRON_RUN_AS_NODE = $null
$root = $PSScriptRoot
$exe = Join-Path $root 'node_modules\electron\dist\electron.exe'

if (-not (Test-Path $exe)) {
  Write-Host '未找到 Electron，先执行: npm install' -ForegroundColor Yellow
  exit 1
}

Start-Process -FilePath $exe -ArgumentList $root
Write-Host '猫猫已启动，去右下角找它。' -ForegroundColor Green
