// 实时抓帧吞吐测试：连续 capturePage，记录时间戳与内容哈希
const { app, BrowserWindow } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const OUT = 'E:/temp/bake-rt';
app.commandLine.appendSwitch('allow-file-access-from-files');

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: 320, height: 380, x: 100, y: 100,
    show: true, transparent: true, frame: false, hasShadow: false,
    webPreferences: { backgroundThrottling: false },
  });
  await win.loadFile('E:/Agent/猫猫桌宠-electron/renderer/index.html');
  await new Promise((r) => setTimeout(r, 5000));
  await win.webContents.executeJavaScript('window.__setFrameCap && window.__setFrameCap(60)');

  const total = 90;
  const rows = [];
  const t0 = Date.now();
  for (let i = 0; i < total; i++) {
    const t = Date.now();
    const img = await win.webContents.capturePage();
    const png = img.toPNG();
    const hash = crypto.createHash('md5').update(png).digest('hex').slice(0, 8);
    rows.push({ i, t: t - t0, ms: Date.now() - t, hash, size: png.length });
    if (i < 5) fs.writeFileSync(path.join(OUT, `${String(i).padStart(3, '0')}.png`), png);
  }
  const elapsed = Date.now() - t0;
  const unique = new Set(rows.map((r) => r.hash)).size;
  const avgMs = rows.reduce((s, r) => s + r.ms, 0) / rows.length;
  console.log('RESULT ' + JSON.stringify({
    frames: total,
    elapsedMs: elapsed,
    fps: +(total / (elapsed / 1000)).toFixed(1),
    avgCaptureMs: +avgMs.toFixed(1),
    uniqueFrames: unique,
  }));
  console.log('SAMPLE ' + JSON.stringify(rows.slice(0, 8)));
  app.quit();
});
