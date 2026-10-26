// 端到端测试：启动真实 Electron，通过 DevTools 协议操作并断言
// 运行：node test/e2e/run.mjs
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const ARTIFACTS = path.join(__dirname, '..', 'artifacts');
let PORT = 0;

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

fs.mkdirSync(ARTIFACTS, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'catpet-e2e-'));

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ' — ' + detail : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

async function waitForTarget(match, timeout = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const targets = await fetchTargets();
      const found = targets.find(match);
      if (found) return found;
    } catch (err) { /* 端口还没起来 */ }
    await sleep(200);
  }
  throw new Error('等待调试目标超时');
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    return new Cdp(ws);
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method} 超时`));
        }
      }, 25000);
    });
  }

  async eval(expression, retries = 2) {
    try {
      const result = await this.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) {
        throw new Error('页面报错: ' + JSON.stringify(result.exceptionDetails));
      }
      return result.result.value;
    } catch (err) {
      // 机器高负载时偶发几秒延迟，重试一次再判失败
      if (retries > 0 && /超时/.test(err.message)) {
        await sleep(800);
        return this.eval(expression, retries - 1);
      }
      throw err;
    }
  }

  async click(x, y, clickCount = 1) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount });
  }

  async shot(file) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
  }
}

// CDP 截图拿不到 WebGL 层，统一改走窗口自身的 capturePage
async function saveShot(page, file, bridge = 'pet') {
  try {
    const base64 = await page.eval(`window.${bridge}.shot()`);
    if (!base64) throw new Error('空图');
    fs.writeFileSync(file, Buffer.from(base64, 'base64'));
    return true;
  } catch (err) {
    record(`截图 ${path.basename(file)}`, false, err.message);
    return false;
  }
}

// 等 Live2D 真正开始绘制（本地资源没有 resource timing，改用绘制计数）
async function waitModelReady(page, timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const draws = await page.eval('window.__l2dDraws || 0');
      if (draws >= 20) return true;
    } catch (err) { /* 页面还没就绪 */ }
    await sleep(250);
  }
  return false;
}

// 轮询等待页面里某个条件成立（比固定 sleep 稳）
async function waitFor(page, expression, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      if (await page.eval(expression)) return true;
    } catch (err) { /* 页面还没就绪 */ }
    await sleep(200);
  }
  return false;
}

async function launch(extraEnv = {}) {
  PORT = await freePort();
  const env = { ...process.env, CATPET_USERDATA: userData, ...extraEnv };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(ELECTRON, [`--remote-debugging-port=${PORT}`, '.'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  child.stdout.on('data', (d) => logs.push(d.toString()));
  child.stderr.on('data', (d) => logs.push(d.toString()));
  return { child, logs };
}

async function waitExit(child, timeout = 8000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeout);
    child.once('exit', () => { clearTimeout(timer); resolve(true); });
  });
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await waitExit(child, 3000);
}

async function main() {
  // 先清掉上一次的结果，避免误读旧数据
  try { fs.unlinkSync(path.join(ARTIFACTS, 'e2e-result.json')); } catch (err) { /* 本来就没有 */ }
  const bootAt = Date.now();
  let app = await launch();
  let pet;
  try {
    const target = await waitForTarget((t) => t.type === 'page' && t.url.includes('index.html'));
    pet = await Cdp.connect(target.webSocketDebuggerUrl);

    // 等页面与 Live2D 真正就绪
    let ready = false;
    for (let i = 0; i < 60; i++) {
      ready = await pet.eval('!!(window.HITMASK && document.querySelector("canvas") && window.pet)');
      if (ready) break;
      await sleep(300);
    }
    const bootMs = Date.now() - bootAt;
    record('冷启动到窗口可交互 < 4s', bootMs < 4000, `${bootMs}ms`);
    record('桌面窗口加载完成（Live2D + 遮罩就绪）', Boolean(ready));
    if (!ready) throw new Error('页面未就绪');

    // 等模型贴图真正下载完，否则截图是一张白板
    const modelReady = await waitModelReady(pet);
    record('Live2D 模型与贴图加载完成', modelReady);
    const remoteResources = (fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8')
      .match(/https?:\/\/[^\s"')]+/g) || []);
    const vendorOk = fs.existsSync(path.join(ROOT, 'renderer', 'vendor', 'live2d', 'hijiki.model.json'));
    record('页面无外网依赖（断网可用）', remoteResources.length === 0 && vendorOk,
      remoteResources.join(', ') || 'vendor 就绪');
    await sleep(600);

    const bg = await pet.eval('getComputedStyle(document.body).backgroundColor');
    record('窗口背景透明', bg === 'rgba(0, 0, 0, 0)', bg);

    const info = await pet.eval('window.pet.debug()');
    record('初始存档为空且窗口尺寸正确',
      info.affinity === 0 && info.bounds.width === 320 && info.bounds.height === 380,
      JSON.stringify({ affinity: info.affinity, bounds: info.bounds }));

    await saveShot(pet, path.join(ARTIFACTS, '01-initial.png'));

    // 找一个猫身上的点（遮罩里最靠上的实心格 = 头顶）
    const head = await pet.eval(`(() => {
      const pts = window.hitmask.solidPoints(window.HITMASK).sort((a, b) => a.y - b.y);
      const p = pts[0];
      return { x: Math.round(p.x * innerWidth), y: Math.round(p.y * innerHeight) };
    })()`);
    record('遮罩头顶坐标可解析', Number.isFinite(head.x) && Number.isFinite(head.y), JSON.stringify(head));

    // F4 点击互动
    await pet.click(head.x, head.y);
    await sleep(700);
    const bubble = await pet.eval('document.getElementById("bubble").textContent');
    const afterPet = await pet.eval('window.pet.debug()');
    record('点击后有气泡台词', typeof bubble === 'string' && bubble.length > 0, bubble);
    record('点击后亲密度 +1', afterPet.affinity === 1, `affinity=${afterPet.affinity}`);
    await saveShot(pet, path.join(ARTIFACTS, '02-petted.png'));

    // F5 连点惩罚（每次间隔 400ms，避开双击判定）
    for (let i = 0; i < 5; i++) {
      await pet.click(head.x, head.y);
      await sleep(400);
    }
    const annoyed = await pet.eval('window.pet.debug()');
    record('连戳后进入炸毛状态', annoyed.mode === 'annoyed', `mode=${annoyed.mode}`);
    const angryText = await pet.eval('document.getElementById("bubble").textContent');
    record('炸毛时台词变凶', typeof angryText === 'string' && angryText.length > 0, angryText);
    await saveShot(pet, path.join(ARTIFACTS, '03-annoyed.png'));

    // F7 面板：双击打开（高负载下双击可能被拆成两次单击，允许重试一次）
    let panelTarget = null;
    for (let attempt = 0; attempt < 3 && !panelTarget; attempt++) {
      await pet.click(head.x, head.y, 1);
      await sleep(90);
      await pet.click(head.x, head.y, 2);
      try {
        panelTarget = await waitForTarget((t) => t.type === 'page' && t.url.includes('panel.html'), 4000);
      } catch (err) {
        panelTarget = null;
      }
    }
    if (!panelTarget) throw new Error('双击没能打开面板');
    const panel = await Cdp.connect(panelTarget.webSocketDebuggerUrl);
    const panelReady = await waitFor(panel, '!!document.getElementById("levelTitle")');
    if (!panelReady) {
      const diag = await panel.eval(
        'JSON.stringify({ href: location.href, ready: document.readyState, html: document.body ? document.body.innerHTML.slice(0, 120) : null })',
      ).catch((e) => 'eval failed: ' + e.message);
      throw new Error('面板未就绪: ' + diag);
    }
    const levelTitle = await panel.eval('document.getElementById("levelTitle").textContent');
    record('双击打开面板且显示等级', typeof levelTitle === 'string' && levelTitle.length > 0, levelTitle);
    await saveShot(panel, path.join(ARTIFACTS, '04-panel.png'), 'panel');

    // F6 喂食（走面板按钮）
    const beforeFeed = await pet.eval('window.pet.debug()');
    await panel.eval('document.querySelector("[data-action=feed]").click()');
    await sleep(700);
    const afterFeed = await pet.eval('window.pet.debug()');
    record('面板喂食后心情上升', afterFeed.mood > beforeFeed.mood,
      `${beforeFeed.mood} -> ${afterFeed.mood}`);

    // F11 设置项联动：开机自启 / 自动穿透
    // 先把可能残留的自启状态关掉，保证用例可重复执行
    const autoBefore = await pet.eval('window.pet.debug()');
    if (autoBefore.openAtLogin) {
      await panel.eval('document.querySelector("[data-action=toggle-autostart]").click()');
      await sleep(500);
    }
    await panel.eval('document.querySelector("[data-action=toggle-autostart]").click()');
    await sleep(500);
    const autoOn = await pet.eval('window.pet.debug()');
    record('开机自启开关可打开（写入系统）', autoOn.openAtLogin === true, `openAtLogin=${autoOn.openAtLogin}`);
    await panel.eval('document.querySelector("[data-action=toggle-autostart]").click()');
    await sleep(500);
    const autoOff = await pet.eval('window.pet.debug()');
    record('开机自启开关可关闭', autoOff.openAtLogin === false, `openAtLogin=${autoOff.openAtLogin}`);

    await panel.eval('document.querySelector("[data-action=toggle-passthrough]").click()');
    await sleep(400);
    const ptOff = await pet.eval('window.pet.debug()');
    record('自动穿透开关可关闭', ptOff.autoPassthrough === false && ptOff.locked === true,
      JSON.stringify({ autoPassthrough: ptOff.autoPassthrough, locked: ptOff.locked }));
    await panel.eval('document.querySelector("[data-action=toggle-passthrough]").click()');
    await sleep(400);
    const ptOn = await pet.eval('window.pet.debug()');
    record('自动穿透可重新打开', ptOn.autoPassthrough === true && ptOn.locked === false);

    // F10 存档落盘
    await sleep(600);
    const stateFile = await pet.eval('window.pet.debug().then(d => d.stateFile)');
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    record('状态已写入 state.json', saved.affinity >= 1 && saved.mood > 0,
      JSON.stringify({ affinity: saved.affinity, mood: saved.mood }));

    // F12 托盘/菜单存在性（主进程侧）
    const trayOk = await pet.eval('window.pet.debug().then(d => typeof d.bounds === "object")');
    record('主进程调试接口可达', trayOk === true);

    // 退出
    await panel.eval('document.querySelector("[data-action=quit]").click()');
    const exited = await waitExit(app.child, 8000);
    record('点击退出后进程正常结束', exited, `exitCode=${app.child.exitCode}`);

    // 重启验证持久化
    app = await launch();
    const target2 = await waitForTarget((t) => t.type === 'page' && t.url.includes('index.html'));
    const pet2 = await Cdp.connect(target2.webSocketDebuggerUrl);
    let ready2 = false;
    for (let i = 0; i < 60; i++) {
      ready2 = await pet2.eval('!!(window.pet)');
      if (ready2) break;
      await sleep(300);
    }
    const restored = await pet2.eval('window.pet.debug()');
    record('重启后恢复亲密度与心情', restored.affinity >= 1 && restored.mood === afterFeed.mood,
      `affinity=${restored.affinity}, mood=${restored.mood}`);
    await waitModelReady(pet2);
    await sleep(700);
    await saveShot(pet2, path.join(ARTIFACTS, '05-restored.png'));

    await pet2.eval('window.close()');
    const exited2 = await waitExit(app.child, 8000);
    record('关闭窗口后进程退出', exited2);
    app.child = null;

    // F7 睡觉与唤醒（用 2.5 秒阈值替代 90 秒，便于验证）
    // 用独立存档目录，避免上一次测试留下的"生气中"状态干扰
    const sleepUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'catpet-sleep-'));
    app = await launch({ CATPET_SLEEP_MS: '2500', CATPET_USERDATA: sleepUserData });
    const target3 = await waitForTarget((t) => t.type === 'page' && t.url.includes('index.html'));
    const pet3 = await Cdp.connect(target3.webSocketDebuggerUrl);
    for (let i = 0; i < 40; i++) {
      if (await pet3.eval('!!window.pet')) break;
      await sleep(300);
    }
    await sleep(600);
    let sleepingMode = 'idle';
    for (let i = 0; i < 40; i++) {
      sleepingMode = (await pet3.eval('window.pet.debug()')).mode;
      if (sleepingMode === 'sleeping') break;
      await sleep(250);
    }
    const zzzVisible = await pet3.eval('getComputedStyle(document.getElementById("zzz")).display');
    record('空闲后进入睡觉状态', sleepingMode === 'sleeping', `mode=${sleepingMode}`);
    record('睡觉时 Zzz 图标可见', zzzVisible !== 'none', zzzVisible);
    await saveShot(pet3, path.join(ARTIFACTS, '06-sleeping.png'));

    const wakePoint = await pet3.eval(`(() => {
      const pts = window.hitmask.solidPoints(window.HITMASK).sort((a, b) => a.y - b.y);
      const p = pts[0];
      return { x: Math.round(p.x * innerWidth), y: Math.round(p.y * innerHeight) };
    })()`);
    await pet3.click(wakePoint.x, wakePoint.y);
    await sleep(700);
    const woke = await pet3.eval('window.pet.debug()');
    record('点击能唤醒', woke.mode !== 'sleeping', `mode=${woke.mode}`);

    await pet3.eval('window.close()');
    await waitExit(app.child, 8000);
    app.child = null;
  } catch (err) {
    record('测试流程异常', false, err.message);
    console.error(err);
  } finally {
    if (app.child) await stop(app.child);
  }

  const failed = results.filter((r) => !r.ok);
  const report = {
    createdAt: new Date().toISOString(),
    userData,
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    results,
  };
  fs.writeFileSync(path.join(ARTIFACTS, 'e2e-result.json'), JSON.stringify(report, null, 2));
  console.log(`\nE2E: ${report.passed}/${report.total} 通过`);
  process.exit(failed.length ? 1 : 0);
}

main();
