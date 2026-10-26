'use strict';

const { app, BrowserWindow, ipcMain, Menu, Tray, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const mood = require('./lib/mood');
const physics = require('./lib/physics');
const lines = require('./lib/lines');
const store = require('./lib/store');
const hitmask = require('./lib/hitmask');
const HITMASK = require('./renderer/hitmask.json');

const SIZE = { width: 320, height: 380 };
const SLEEP_AFTER_MS = 90 * 1000;
const SLEEP_AFTER_MS_NIGHT = 30 * 1000;
const CHATTER_MIN_MS = 3 * 60 * 1000;
const CHATTER_MAX_MS = 7 * 60 * 1000;

if (process.env.CATPET_USERDATA) {
  app.setPath('userData', process.env.CATPET_USERDATA);
}

// 模型/贴图都在本地，需要允许 file:// 页面读取同目录资源
app.commandLine.appendSwitch('allow-file-access-from-files');

let win = null;
let panelWin = null;
let tray = null;

let state = null;
let mode = 'idle'; // idle | sleeping | annoyed
let pinned = true;
let autoPassthrough = true;
let locked = false; // 手动锁定为不穿透
let openAtLogin = false;

let body = null;
let physicsTimer = null;
let dragTimer = null;
let dragSamples = [];
let hopTimer = null;
let hoverTimer = null;
let overCatState = null;
let behaviorTimer = null;
let saveTimer = null;
let chatterAt = 0;
let lastInteraction = Date.now();
let lastLine = '';
let debug = { ready: false, shotMode: false };

function stateFile() {
  return path.join(app.getPath('userData'), 'state.json');
}

function saveStateSoon() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      store.save(stateFile(), { ...state, lastSeen: Date.now(), window: currentWindowPosition() });
    } catch (err) {
      console.error('[state] 保存失败: ' + err.message);
    }
  }, 250);
}

function currentWindowPosition() {
  if (!win) return null;
  const b = win.getBounds();
  return { x: b.x, y: b.y };
}

function workAreaFor(x, y) {
  const point = { x: x + SIZE.width / 2, y: y + SIZE.height / 2 };
  return screen.getDisplayNearestPoint(point).workArea;
}

function clampToWorkArea(x, y) {
  const area = workAreaFor(x, y);
  return {
    x: Math.round(Math.min(Math.max(x, area.x), area.x + area.width - SIZE.width)),
    y: Math.round(Math.min(Math.max(y, area.y), area.y + area.height - SIZE.height)),
  };
}

function snapshot() {
  return {
    mode,
    mood: state.mood,
    affinity: state.affinity,
    level: mood.levelOf(state.affinity),
    today: state.today,
    annoyed: mode === 'annoyed',
    sleeping: mode === 'sleeping',
  };
}

function broadcast(channel, payload) {
  for (const target of [win, panelWin]) {
    if (target && !target.isDestroyed()) {
      target.webContents.send(channel, payload);
    }
  }
}

function pushState() {
  broadcast('pet:state', snapshot());
}

function say(text) {
  lastLine = text;
  broadcast('pet:say', { text });
}

function pickAndSay(ctx) {
  const text = lines.pickLine({ ...ctx, last: lastLine, hour: new Date().getHours() });
  if (text) say(text);
}

function refreshMode() {
  const now = Date.now();
  if (mood.isAnnoyed(state, now)) {
    if (mode !== 'annoyed') {
      mode = 'annoyed';
      pushState();
      refreshMenus();
    }
  } else if (mode === 'annoyed') {
    mode = 'idle';
    pushState();
    refreshMenus();
  }
}

function markInteraction() {
  lastInteraction = Date.now();
}

function applyResult(result, now) {
  state = mood.refreshDay(result.state, now);
  saveStateSoon();

  if (result.event === 'annoyed') {
    mode = 'annoyed';
    say(lines.pickLine({ kind: 'annoyed', hour: new Date().getHours() }));
  } else if (result.event === 'grumpy') {
    say(lines.pickLine({ kind: 'grumpy', hour: new Date().getHours() }));
  } else if (result.event === 'full') {
    say(lines.pickLine({ kind: 'full', hour: new Date().getHours() }));
  } else if (result.event === 'fed') {
    say(lines.pickLine({ kind: 'fed', hour: new Date().getHours() }));
  } else {
    pickAndSay({ kind: 'pet', mood: state.mood, affinity: state.affinity });
  }

  pushState();
  refreshMenus();
}

function pet() {
  if (!win) return;
  const now = Date.now();
  markInteraction();
  wakeUp();

  const result = mood.applyPetting(state, now);
  applyResult(result, now);

  if (result.event !== 'grumpy' && result.event !== 'annoyed') {
    broadcast('pet:fx', { heart: true, purr: true });
    hop();
  } else {
    broadcast('pet:fx', { shake: true });
  }
  return snapshot();
}

function feed() {
  const now = Date.now();
  markInteraction();
  wakeUp();
  const result = mood.applyFeed(state, now);
  applyResult(result, now);
  if (result.event === 'fed') {
    broadcast('pet:fx', { fish: true, purr: true });
    hop();
  }
  return snapshot();
}

function wakeUp() {
  if (mode === 'sleeping') {
    mode = 'idle';
    say(lines.pickLine({ kind: 'wake', hour: new Date().getHours() }));
    pushState();
    refreshMenus();
  }
}

function hop() {
  if (!win || locked) return;
  if (hopTimer) { clearInterval(hopTimer); hopTimer = null; }
  const base = win.getBounds();
  const duration = 340;
  const amp = 9;
  const started = Date.now();
  hopTimer = setInterval(() => {
    if (!win) { clearHop(); return; }
    const t = Math.min(1, (Date.now() - started) / duration);
    win.setPosition(base.x, base.y + Math.round(-Math.sin(Math.PI * t) * amp));
    if (t >= 1) { clearHop(); win.setPosition(base.x, base.y); }
  }, 16);
}

function clearHop() {
  if (hopTimer) { clearInterval(hopTimer); hopTimer = null; }
}

function stopPhysics() {
  if (physicsTimer) { clearInterval(physicsTimer); physicsTimer = null; }
}

function startPhysics(vx, vy) {
  if (!win) return;
  clearHop();
  const b = win.getBounds();
  body = physics.createBody(b.x, b.y);
  body.vx = vx;
  body.vy = vy;
  let last = Date.now();
  stopPhysics();
  physicsTimer = setInterval(() => {
    if (!win || !body) { stopPhysics(); return; }
    const now = Date.now();
    const dt = (now - last) / 1000;
    last = now;
    const area = workAreaFor(body.x, body.y);
    const bounds = {
      left: area.x,
      top: area.y,
      right: area.x + area.width - SIZE.width,
      bottom: area.y + area.height - SIZE.height,
    };
    const result = physics.step(body, dt, bounds);
    body = result.body;
    win.setPosition(Math.round(body.x), Math.round(body.y));
    if (result.settled) {
      stopPhysics();
      saveStateSoon();
    }
  }, 16);
}

function tick() {
  const now = Date.now();
  if (process.env.CATPET_DEBUG) {
    const line = `[tick] ${new Date().toISOString()} mode=${mode} idle=${now - lastInteraction}ms\n`;
    console.log(line.trim());
    try { fs.appendFileSync(path.join(app.getPath('userData'), 'tick.log'), line); } catch (err) { /* ignore */ }
  }
  refreshMode();

  if (mode === 'idle') {
    const hour = new Date(now).getHours();
    const isNight = hour >= 23 || hour < 6;
    const defaultThreshold = isNight ? SLEEP_AFTER_MS_NIGHT : SLEEP_AFTER_MS;
    const override = Number(process.env.CATPET_SLEEP_MS || 0);
    const threshold = override > 0 ? override : defaultThreshold;
    if (now - lastInteraction > threshold) {
      mode = 'sleeping';
      pushState();
      refreshMenus();
    }
  }

  if (mode === 'idle') {
    const idleMs = now - lastInteraction;
    const decayed = mood.idleDecay(state, idleMs);
    if (decayed !== state) {
      state = decayed;
      saveStateSoon();
      pushState();
    }
  }

  if (mode === 'idle' && now >= chatterAt) {
    chatterAt = now + CHATTER_MIN_MS + Math.random() * (CHATTER_MAX_MS - CHATTER_MIN_MS);
    if (Math.random() < 0.7) {
      pickAndSay({ kind: 'idle', mood: state.mood, affinity: state.affinity });
    }
  }
}

function setPassthrough(ignore) {
  if (!win) return;
  win.setIgnoreMouseEvents(ignore, { forward: true });
}

// 以「光标位置 + 遮罩」判断是否让鼠标穿透。
// 不依赖转发事件，即使窗口已经穿透也能靠轮询把控制权收回来。
function hoverTick() {
  if (!win || win.isDestroyed() || !win.isVisible()) return;

  if (!autoPassthrough || locked) {
    if (overCatState !== true) {
      overCatState = true;
      setPassthrough(false);
    }
    return;
  }

  if (dragTimer || physicsTimer || hopTimer) return;

  const bounds = win.getBounds();
  const point = screen.getCursorScreenPoint();
  const inside = point.x >= bounds.x && point.y >= bounds.y
    && point.x < bounds.x + bounds.width && point.y < bounds.y + bounds.height;
  const nx = (point.x - bounds.x) / bounds.width;
  const ny = (point.y - bounds.y) / bounds.height;
  const overCat = inside && hitmask.hitTest(HITMASK, nx, ny);

  if (overCat !== overCatState) {
    overCatState = overCat;
    setPassthrough(!overCat);
  }
}

function startHoverWatch() {
  if (hoverTimer) clearInterval(hoverTimer);
  hoverTick();
  // 30ms：比人的反应快得多，保证"移到猫身上再点"不会点空
  hoverTimer = setInterval(hoverTick, 30);
}

function applyPassthrough() {
  const ignore = autoPassthrough && !locked;
  setPassthrough(ignore);
}

function setPinned(value) {
  pinned = value;
  if (win) win.setAlwaysOnTop(pinned, 'screen-saver');
  refreshMenus();
}

function setAutoPassthrough(value) {
  autoPassthrough = value;
  locked = !value;
  overCatState = null;
  hoverTick();
  refreshMenus();
}

function setLocked(value) {
  locked = value;
  overCatState = null;
  hoverTick();
  refreshMenus();
}

function setOpenAtLogin(value) {
  openAtLogin = value;
  try {
    app.setLoginItemSettings({ openAtLogin: value, path: process.execPath });
    // 读回系统真实状态，避免界面显示"开了"其实没写进注册表
    openAtLogin = app.getLoginItemSettings().openAtLogin;
  } catch (err) {
    console.warn('[autostart] 设置失败: ' + err.message);
  }
  refreshMenus();
}

function buildMenu() {
  return [
    { label: '摸摸头', click: () => pet() },
    { label: '喂小鱼干', click: () => feed() },
    { type: 'separator' },
    { label: '显示面板', click: () => openPanel() },
    { label: '置顶', type: 'checkbox', checked: pinned, click: (item) => setPinned(item.checked) },
    {
      label: '自动穿透（按形状）',
      type: 'checkbox',
      checked: autoPassthrough,
      click: (item) => setAutoPassthrough(item.checked),
    },
    {
      label: '锁定（整块窗口都可点）',
      type: 'checkbox',
      checked: locked,
      click: (item) => setLocked(item.checked),
    },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: openAtLogin,
      click: (item) => setOpenAtLogin(item.checked),
    },
    { label: '退出', click: () => app.quit() },
  ];
}

function refreshMenus() {
  const menu = Menu.buildFromTemplate(buildMenu());
  if (tray) tray.setContextMenu(menu);
}

function openPanel() {
  if (panelWin && !panelWin.isDestroyed()) {
    panelWin.show();
    panelWin.focus();
    panelWin.webContents.send('pet:state', snapshot());
    return;
  }
  const base = win ? win.getBounds() : { x: 100, y: 100 };
  const area = workAreaFor(base.x, base.y);
  const width = 288;
  const height = 336;
  let x = base.x - width - 12;
  if (x < area.x) x = base.x + base.width + 12;
  x = Math.min(Math.max(x, area.x), area.x + area.width - width);
  const y = Math.min(Math.max(base.y, area.y), area.y + area.height - height);

  panelWin = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'panel-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  panelWin.setAlwaysOnTop(true, 'screen-saver');
  panelWin.loadFile(path.join(__dirname, 'renderer', 'panel.html'));
  panelWin.once('ready-to-show', () => {
    panelWin.show();
    panelWin.webContents.send('pet:state', snapshot());
  });
  panelWin.on('closed', () => { panelWin = null; });
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray.png');
  if (!fs.existsSync(iconPath)) {
    console.warn('[tray] 缺少图标: ' + iconPath);
    return;
  }
  tray = new Tray(iconPath);
  tray.setToolTip('猫猫桌宠');
  refreshMenus();
  tray.on('click', () => {
    if (!win) return;
    if (win.isVisible()) win.hide();
    else win.show();
  });
}

function createWindow() {
  const saved = state.window || null;
  const area = screen.getPrimaryDisplay().workArea;
  const fallback = {
    x: area.x + area.width - SIZE.width - 24,
    y: area.y + area.height - SIZE.height - 8,
  };
  const pos = clampToWorkArea(saved ? saved.x : fallback.x, saved ? saved.y : fallback.y);

  win = new BrowserWindow({
    width: SIZE.width,
    height: SIZE.height,
    x: pos.x,
    y: pos.y,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    roundedCorners: false,
    skipTaskbar: true,
    alwaysOnTop: pinned,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(pinned, 'screen-saver');
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.once('ready-to-show', () => {
    win.showInactive();
    applyPassthrough();
    startHoverWatch();
    debug.ready = true;
    if (process.env.CATPET_SHOT) captureAndQuit();
    if (process.env.CATPET_PERF) runPerf();
  });

  win.on('moved', () => {
    if (!physicsTimer && !hopTimer) saveStateSoon();
  });

  win.webContents.on('console-message', (event) => {
    const message = (event && event.message) || '';
    if (process.env.CATPET_DEBUG || /\[renderer\]/.test(message)) {
      console.log('[renderer] ' + message);
    }
  });

  // 渲染进程崩溃/卡死时自动恢复，避免桌面上留一只"死猫"
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer] 进程退出: ' + (details && details.reason));
    setTimeout(() => {
      if (win && !win.isDestroyed()) win.reload();
    }, 800);
  });

  win.webContents.on('unresponsive', () => {
    console.warn('[renderer] 无响应，2 秒后尝试重载');
    setTimeout(() => {
      if (win && !win.isDestroyed()) win.webContents.reload();
    }, 2000);
  });

  win.webContents.on('responsive', () => {
    console.log('[renderer] 恢复响应');
  });

  win.on('closed', () => { win = null; });
}

async function captureAndQuit() {
  const delay = Number(process.env.CATPET_SHOT_DELAY || 6000);
  setTimeout(async () => {
    try {
      const image = await win.webContents.capturePage();
      fs.writeFileSync(process.env.CATPET_SHOT, image.toPNG());
      console.log('[shot] saved ' + process.env.CATPET_SHOT);
    } catch (err) {
      console.error('[shot] failed: ' + err.message);
    }
    app.quit();
  }, delay);
}

// 采样 20 秒的 CPU / 内存 / 帧率，用于性能验收
function runPerf() {
  const out = process.env.CATPET_PERF;
  const samples = [];
  let fpsSamples = [];
  const started = Date.now();
  const timer = setInterval(() => {
    const metrics = app.getAppMetrics();
    const totalCpu = metrics.reduce((sum, m) => sum + m.cpu.percentCPUUsage, 0);
    const totalMem = metrics.reduce((sum, m) => sum + (m.memory.workingSetSize || 0), 0) / 1024;
    samples.push({
      t: Date.now() - started,
      cpu: totalCpu,
      memMB: totalMem,
      processes: metrics.map((m) => ({
        type: m.type,
        cpu: Number(m.cpu.percentCPUUsage.toFixed(2)),
        memMB: Number(((m.memory.workingSetSize || 0) / 1024).toFixed(1)),
      })),
    });
  }, 1000);

  const fpsTimer = setInterval(async () => {
    if (!win) return;
    try {
      const fps = await win.webContents.executeJavaScript('window.__fps || 0');
      fpsSamples.push(fps);
    } catch (err) { /* ignore */ }
  }, 1000);

  setTimeout(async () => {
    clearInterval(timer);
    clearInterval(fpsTimer);
    const cpuAvg = samples.length ? samples.reduce((s, x) => s + x.cpu, 0) / samples.length : 0;
    const memMax = samples.length ? Math.max(...samples.map((x) => x.memMB)) : 0;
    const fpsAvg = fpsSamples.length ? fpsSamples.reduce((s, x) => s + x, 0) / fpsSamples.length : 0;
    const result = {
      durationMs: Date.now() - started,
      samples,
      fpsSamples,
      cpuAvgPercent: Number(cpuAvg.toFixed(2)),
      memMaxMB: Number(memMax.toFixed(1)),
      fpsAvg: Number(fpsAvg.toFixed(1)),
      fpsMin: fpsSamples.length ? Math.min(...fpsSamples) : 0,
      gpu: app.getGPUFeatureStatus(),
    };
    fs.writeFileSync(out, JSON.stringify(result, null, 2));
    console.log('[perf] ' + JSON.stringify(result));
    app.quit();
  }, 20000);
}

ipcMain.on('pet:drag-start', (_event, payload) => {
  if (!win) return;
  markInteraction();
  wakeUp();
  clearHop();
  stopPhysics();
  const point = screen.getCursorScreenPoint();
  const bounds = win.getBounds();
  // 偏移由渲染进程在 pointerdown 时给出，主进程处理再慢也不会让窗口跳
  const valid = payload && Number.isFinite(payload.offsetX) && Number.isFinite(payload.offsetY);
  const offset = valid
    ? { x: payload.offsetX, y: payload.offsetY }
    : { x: point.x - bounds.x, y: point.y - bounds.y };
  dragSamples = [];
  if (dragTimer) clearInterval(dragTimer);
  dragTimer = setInterval(() => {
    if (!win) return;
    const p = screen.getCursorScreenPoint();
    const x = p.x - offset.x;
    const y = p.y - offset.y;
    win.setPosition(x, y);
    dragSamples.push({ t: Date.now(), x, y });
    if (dragSamples.length > 8) dragSamples.shift();
  }, 16);
});

ipcMain.on('pet:drag-end', () => {
  if (dragTimer) { clearInterval(dragTimer); dragTimer = null; }
  if (!win) return;

  const recent = dragSamples.filter((s) => Date.now() - s.t < 120);
  let vx = 0;
  if (recent.length >= 2) {
    const first = recent[0];
    const last = recent[recent.length - 1];
    const dt = Math.max(0.016, (last.t - first.t) / 1000);
    vx = (last.x - first.x) / dt;
  }
  dragSamples = [];

  const speed = Math.abs(vx);
  // 阈值 900px/s：普通拖动不会误触发抛掷，只有明显"甩"出去才飞
  if (speed > 900) {
    startPhysics(Math.max(-2600, Math.min(2600, vx)), -speed * 0.22);
  } else {
    const b = win.getBounds();
    const clamped = clampToWorkArea(b.x, b.y);
    if (clamped.x !== b.x || clamped.y !== b.y) win.setPosition(clamped.x, clamped.y);
    saveStateSoon();
  }
});

ipcMain.on('pet:click', () => pet());
ipcMain.on('pet:feed', () => feed());
ipcMain.on('pet:panel', () => openPanel());
ipcMain.on('pet:menu', () => {
  if (win) Menu.buildFromTemplate(buildMenu()).popup({ window: win });
});

ipcMain.handle('debug:shot', async (event) => {
  const target = BrowserWindow.fromWebContents(event.sender);
  if (!target || target.isDestroyed()) return null;
  // 窗口刚显示/正在动画时合成器可能还没就绪，重试几次
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const image = await target.webContents.capturePage();
      const png = image.toPNG();
      if (png && png.length > 0) return png.toString('base64');
    } catch (err) {
      /* UnknownVizError 等，重试 */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
});

ipcMain.handle('debug:query', () => ({
  ...snapshot(),
  bounds: win ? win.getBounds() : null,
  pinned,
  autoPassthrough,
  locked,
  openAtLogin,
  lastLine,
  stateFile: stateFile(),
}));

ipcMain.handle('panel:state', () => ({
  ...snapshot(),
  openAtLogin,
  autoPassthrough,
  pinned,
}));

ipcMain.on('panel:action', (_event, action) => {
  switch (action && action.type) {
    case 'pet': pet(); break;
    case 'feed': feed(); break;
    case 'hide': if (win) win.hide(); break;
    case 'toggle-autostart': setOpenAtLogin(!openAtLogin); break;
    case 'toggle-passthrough': setAutoPassthrough(!autoPassthrough); break;
    case 'close-panel': if (panelWin) panelWin.close(); break;
    case 'quit': app.quit(); break;
    default: break;
  }
  broadcast('pet:state', snapshot());
  if (panelWin && !panelWin.isDestroyed()) {
    panelWin.webContents.send('panel:info', { openAtLogin, autoPassthrough, pinned });
  }
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (!win.isVisible()) win.show();
      win.focus();
      hop();
    }
  });

  app.whenReady().then(() => {
    const loaded = store.load(stateFile(), () => mood.createState(Date.now()));
    state = mood.settle(mood.normalize(loaded.data, mood.createState(Date.now())), Date.now());
    if (loaded.recovered) console.warn('[state] 存档损坏，已回退默认值');

    try {
      openAtLogin = app.getLoginItemSettings().openAtLogin;
    } catch (err) {
      openAtLogin = false;
    }

    createWindow();
    createTray();

    chatterAt = Date.now() + CHATTER_MIN_MS + Math.random() * (CHATTER_MAX_MS - CHATTER_MIN_MS);
    behaviorTimer = setInterval(tick, 1000);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('will-quit', () => {
    clearHop();
    stopPhysics();
    if (hoverTimer) clearInterval(hoverTimer);
    if (dragTimer) clearInterval(dragTimer);
    if (behaviorTimer) clearInterval(behaviorTimer);
    if (state) {
      try {
        store.save(stateFile(), { ...state, lastSeen: Date.now(), window: currentWindowPosition() });
      } catch (err) { /* ignore */ }
    }
    if (tray) { tray.destroy(); tray = null; }
  });

  app.on('window-all-closed', () => app.quit());
}
