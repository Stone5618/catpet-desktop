// 烘焙管线可行性测试：用 CDP 虚拟时间逐步推进，每步抓一帧
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const OUT = 'E:/temp/bake-test';
const STEP_MS = 1000 / 60;

app.commandLine.appendSwitch('allow-file-access-from-files');

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: 320,
    height: 380,
    x: 100,
    y: 100,
    show: true,
    transparent: true,
    frame: false,
    hasShadow: false,
    webPreferences: { backgroundThrottling: false },
  });

  await win.loadFile('E:/Agent/猫猫桌宠-electron/renderer/index.html');
  await new Promise((r) => setTimeout(r, 5000));

  const draws = await win.webContents.executeJavaScript('window.__l2dDraws || 0');
  console.log('model draws before pause:', draws);

  await win.webContents.executeJavaScript('window.__setFrameCap && window.__setFrameCap(60)');

  const dbg = win.webContents.debugger;
  try {
    dbg.attach('1.3');
  } catch (e) {
    console.log('debugger attach failed:', e.message);
  }

  await dbg.sendCommand('Emulation.setVirtualTimePolicy', { policy: 'pause' });

  for (let i = 0; i < 6; i++) {
    const expired = new Promise((resolve) => {
      const handler = (_e, method) => {
        if (method === 'Emulation.virtualTimeBudgetExpired') {
          dbg.removeListener('message', handler);
          resolve();
        }
      };
      dbg.on('message', handler);
    });
    await dbg.sendCommand('Emulation.setVirtualTimePolicy', {
      policy: 'advance',
      budget: STEP_MS,
    });
    await Promise.race([expired, new Promise((r) => setTimeout(r, 3000))]);
    const image = await win.webContents.capturePage();
    const file = path.join(OUT, `${String(i).padStart(3, '0')}.png`);
    fs.writeFileSync(file, image.toPNG());
    const size = fs.statSync(file).size;
    // 比较相邻帧是否不同
    console.log(`frame ${i}: ${size} bytes`);
  }

  const drawsAfter = await win.webContents.executeJavaScript('window.__l2dDraws || 0');
  console.log('model draws after 6 steps:', drawsAfter);
  app.quit();
});
