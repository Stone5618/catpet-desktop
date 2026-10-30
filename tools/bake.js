// 烘焙工具：把 Live2D 模型的待机动画抓成 60fps 循环素材（CPF1 容器）
//
// 用法：
//   electron tools/bake.js --skin=hijiki --seconds=10 --fps=60
//
// 产出：
//   assets/skins/<skin>/frames.cpf   关键帧 + 差分，Deflate 压缩
//   assets/skins/<skin>/meta.json    尺寸、裁剪、帧率、帧数、循环时长
//   assets/skins/<skin>/preview-*.png
//
// 设计取舍：
//   1) 实时抓帧实测约 63fps，按 60fps 均匀时间轴重采样
//   2) 循环点限定在 2.0–3.5 秒，兼顾"够长不重复"和"体积可控"
//   3) 首尾差异过大时补 10 帧交叉淡入，保证循环不跳
//   4) 帧间用脏矩形差分，屏幕上一只猫的呼吸变化只占少量像素

const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const OUT_ROOT = path.join(ROOT, 'assets', 'skins');

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
}

const SKIN = arg('skin', 'hijiki');
const SECONDS = Number(arg('seconds', '10'));
const TARGET_FPS = Number(arg('fps', '60'));
const LOOP_MIN = Number(arg('loopmin', '2000'));
const LOOP_MAX = Number(arg('loopmax', '3500'));
// masterScale：母带分辨率倍率。1=1x 母带（100%/75% 用）；1.5=高分母带（150% 档 1:1 播放，125% 由其缩小）
const MASTER_SCALE = Math.max(0.5, Math.min(3, Number(arg('scale', '1'))));
const WIDTH = 320;
const HEIGHT = 380;
// 正确标定（display 等比放大 + model.scale=1）：
//   display = 320*s x 380*s，猫 = 217*s x 292*s（1x 母带 217x292 的 s 倍，形状不变）
//   s=1.5 → 猫 324x439 = 精确 1.5x，且四边不贴画布（窗口=display+200 余量）
const RENDER_SCALE = MASTER_SCALE;
const CAP_W = Math.round(WIDTH * RENDER_SCALE) + 200;
const CAP_H = Math.round(HEIGHT * RENDER_SCALE) + 200;

app.commandLine.appendSwitch('allow-file-access-from-files');

function thumbnail(png) {
  return nativeImage.createFromBuffer(png).resize({ width: 32, height: 38, quality: 'good' }).toBitmap();
}

function distance(a, b) {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 4) {
    sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  }
  return sum;
}

function blend(a, b, t) {
  const out = Buffer.alloc(a.length);
  for (let p = 0; p < a.length; p += 4) {
    out[p] = Math.round(a[p] * (1 - t) + b[p] * t);
    out[p + 1] = Math.round(a[p + 1] * (1 - t) + b[p + 1] * t);
    out[p + 2] = Math.round(a[p + 2] * (1 - t) + b[p + 2] * t);
    out[p + 3] = Math.round(a[p + 3] * (1 - t) + b[p + 3] * t);
  }
  return out;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: CAP_W, height: CAP_H, x: 80, y: 80,
    show: true, transparent: true, frame: false, hasShadow: false, skipTaskbar: true,
    webPreferences: { backgroundThrottling: false },
  });
  // 用 zoomFactor 提高渲染像素密度：CSS 布局不变，canvas/WebGL backing 随 DPR 放大，
  // Live2D 纹理直接从 2048 原图采样 → 高分母带，不经任何插值

  await win.loadFile(path.join(__dirname, 'bake-page.html'), { search: `skin=${SKIN}&s=${RENDER_SCALE}` });
  await new Promise((r) => setTimeout(r, 5000));

  const hasCanvas = await win.webContents.executeJavaScript('!!document.querySelector("canvas")').catch(() => false);
  if (!hasCanvas) {
    console.error('BAKE_FAIL 没有 canvas');
    app.quit();
    return;
  }

  const captured = [];
  const t0 = Date.now();
  while (Date.now() - t0 < SECONDS * 1000) {
    const at = Date.now() - t0;
    const image = await win.webContents.capturePage();
    const png = image.toPNG();
    if (png && png.length > 0) captured.push({ at, png });
  }
  if (captured.length < 60) {
    console.error('BAKE_FAIL 抓帧过少');
    app.quit();
    return;
  }
  const sizes = captured.map((c) => c.png.length).sort((a, b) => a - b);
  const medianBytes = sizes[Math.floor(sizes.length / 2)];
  console.log(`BAKE_CAPTURED ${captured.length} 帧 medianBytes=${medianBytes}`);
  if (medianBytes < 3000) {
    console.error('BAKE_FAIL 画面是空白');
    app.quit();
    return;
  }

  const sigs = captured.map((c) => thumbnail(c.png));

  // 相邻帧变化量，用于判断接缝是否显眼
  const adjacent = [];
  for (let i = 1; i < captured.length; i++) adjacent.push(distance(sigs[i - 1], sigs[i]));
  adjacent.sort((a, b) => a - b);
  const medianAdjacent = adjacent[Math.floor(adjacent.length / 2)] || 1;

  // 循环点：在整段捕获里找"最相似的一对帧"作为起点/终点，
  // 只从第 0 帧往后找终点会受动画漂移影响，永远拼不上。
  let startIndex = 0;
  let bestIndex = -1;
  let bestScore = Number.MAX_SAFE_INTEGER;
  for (let i = 0; i < captured.length - 2; i++) {
    for (let j = i + 1; j < captured.length; j++) {
      const dur = captured[j].at - captured[i].at;
      if (dur < LOOP_MIN) continue;
      if (dur > LOOP_MAX) break;
      const score = distance(sigs[i], sigs[j]) / (dur / 1000);
      if (score < bestScore) {
        bestScore = score;
        startIndex = i;
        bestIndex = j;
      }
    }
  }
  if (bestIndex < 0) { startIndex = 0; bestIndex = captured.length - 1; }
  const loopMs = captured[bestIndex].at - captured[startIndex].at;
  console.log(`BAKE_LOOP start=${startIndex} end=${bestIndex} loopMs=${loopMs} score=${bestScore.toFixed(1)} medianAdjacent=${medianAdjacent}`);

  // 重采样到 60fps
  const step = 1000 / TARGET_FPS;
  const frameCount = Math.max(2, Math.round(loopMs / step));
  const picked = [];
  let cursor = startIndex;
  for (let f = 0; f < frameCount; f++) {
    const target = captured[startIndex].at + f * step;
    while (cursor + 1 < bestIndex && Math.abs(captured[cursor + 1].at - target) <= Math.abs(captured[cursor].at - target)) {
      cursor += 1;
    }
    picked.push(captured[cursor].png);
  }

  // 内容包围盒（逐像素、alpha>0，避免漏掉抗锯齿边缘把猫裁掉一圈）
  let minX = CAP_W, minY = CAP_H, maxX = -1, maxY = -1;
  for (const png of picked) {
    const bmp = nativeImage.createFromBuffer(png).toBitmap();
    for (let y = 0; y < CAP_H; y++) {
      for (let x = 0; x < CAP_W; x++) {
        if (bmp[(y * CAP_W + x) * 4 + 3] > 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
  }
  if (maxX < 0) {
    console.error('BAKE_FAIL 全透明');
    app.quit();
    return;
  }
  const PAD = 12;
  const crop = {
    x: Math.max(0, minX - PAD),
    y: Math.max(0, minY - PAD),
    width: Math.min(CAP_W, maxX + PAD + 1) - Math.max(0, minX - PAD),
    height: Math.min(CAP_H, maxY + PAD + 1) - Math.max(0, minY - PAD),
  };
  console.log('BAKE_CROP ' + JSON.stringify(crop));

  const buffers = picked.map((png) => nativeImage.createFromBuffer(png).crop(crop).toBitmap());
  const cw = crop.width;
  const ch = crop.height;

  // 接缝检测 + 交叉淡入
  const firstFrame = buffers[0];
  const lastFrame = buffers[buffers.length - 1];
  let diffPixels = 0;
  for (let p = 0; p < firstFrame.length; p += 4) {
    if (Math.abs(firstFrame[p] - lastFrame[p]) > 6
      || Math.abs(firstFrame[p + 1] - lastFrame[p + 1]) > 6
      || Math.abs(firstFrame[p + 2] - lastFrame[p + 2]) > 6
      || Math.abs(firstFrame[p + 3] - lastFrame[p + 3]) > 6) diffPixels += 1;
  }
  const seamFrac = diffPixels / (cw * ch);
  let blendCount = 0;
  if (seamFrac > 0.002) {
    // 交叉淡入只能短：时间一长，两个姿态叠在一起就成了"双影"
    blendCount = 4;
    for (let k = 1; k <= blendCount; k++) {
      buffers.push(blend(lastFrame, firstFrame, k / (blendCount + 1)));
    }
  }
  console.log(`BAKE_SEAM diffPixels=${diffPixels} frac=${seamFrac.toFixed(4)} blend=${blendCount}`);

  // CPF1 编码：关键帧 + 脏矩形差分
  const chunks = [];
  let prev = null;
  let keyBytes = 0;
  let deltaBytes = 0;
  for (const cur of buffers) {
    if (!prev) {
      const raw = zlib.deflateSync(cur, { level: 9 });
      chunks.push({ type: 0, data: raw });
      keyBytes += raw.length;
    } else {
      let dx0 = cw, dy0 = ch, dx1 = -1, dy1 = -1;
      for (let y = 0; y < ch; y++) {
        const row = y * cw * 4;
        for (let x = 0; x < cw; x++) {
          const p = row + x * 4;
          if (Math.abs(cur[p] - prev[p]) > 2 || Math.abs(cur[p + 1] - prev[p + 1]) > 2
            || Math.abs(cur[p + 2] - prev[p + 2]) > 2 || Math.abs(cur[p + 3] - prev[p + 3]) > 2) {
            if (x < dx0) dx0 = x;
            if (x > dx1) dx1 = x;
            if (y < dy0) dy0 = y;
            if (y > dy1) dy1 = y;
          }
        }
      }
      if (dx1 < 0) {
        chunks.push({ type: 2, data: Buffer.alloc(0) });
      } else {
        const rw = dx1 - dx0 + 1;
        const rh = dy1 - dy0 + 1;
        const header = Buffer.alloc(8);
        header.writeUInt16LE(dx0, 0);
        header.writeUInt16LE(dy0, 2);
        header.writeUInt16LE(rw, 4);
        header.writeUInt16LE(rh, 6);
        const rect = Buffer.alloc(rw * rh * 4);
        for (let y = 0; y < rh; y++) {
          const srcStart = ((dy0 + y) * cw + dx0) * 4;
          cur.copy(rect, y * rw * 4, srcStart, srcStart + rw * 4);
        }
        const raw = zlib.deflateSync(Buffer.concat([header, rect]), { level: 9 });
        chunks.push({ type: 1, data: raw });
        deltaBytes += raw.length;
      }
    }
    prev = cur;
  }

  const head = Buffer.alloc(16);
  head.write('CPF1', 0, 'ascii');
  head.writeUInt16LE(cw, 4);
  head.writeUInt16LE(ch, 6);
  head.writeUInt16LE(TARGET_FPS, 8);
  head.writeUInt16LE(0, 10);
  head.writeUInt32LE(buffers.length, 12);
  const parts = [head];
  for (const c of chunks) {
    const h = Buffer.alloc(5);
    h.writeUInt8(c.type, 0);
    h.writeUInt32LE(c.data.length, 1);
    parts.push(h, c.data);
  }
  const outDir = path.join(OUT_ROOT, SKIN);
  if (MASTER_SCALE === 1) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outDir, { recursive: true });
  const cpf = Buffer.concat(parts);
  const suffix = MASTER_SCALE === 1 ? '' : '-' + String(Math.round(MASTER_SCALE * 100));
  fs.writeFileSync(path.join(outDir, `frames${suffix}.cpf`), cpf);

  for (const idx of [0, Math.floor(buffers.length / 2)]) {
    const img = nativeImage.createFromBuffer(picked[Math.min(idx, picked.length - 1)]).crop(crop);
    fs.writeFileSync(path.join(outDir, `preview${suffix}-${String(idx).padStart(4, '0')}.png`), img.toPNG());
  }

  const meta = {
    skin: SKIN,
    width: WIDTH,
    height: HEIGHT,
    masterScale: MASTER_SCALE,
    crop,
    fps: TARGET_FPS,
    frames: buffers.length,
    loopMs: Math.round(loopMs) + Math.round((blendCount * 1000) / TARGET_FPS),
    capturedFrames: captured.length,
    capturedFps: +(captured.length / (captured[captured.length - 1].at / 1000)).toFixed(1),
    format: 'CPF1',
    blendFrames: blendCount,
    keyframeBytes: keyBytes,
    deltaBytes,
    generatedAt: new Date().toISOString(),
  };
  // 1x 母带的 meta 是运行时必需文件（meta.json）；高分母带另存 meta-150.json 供参考
  fs.writeFileSync(path.join(outDir, `meta${suffix}.json`), JSON.stringify(meta, null, 2));
  if (MASTER_SCALE !== 1 && !fs.existsSync(path.join(outDir, 'meta.json'))) {
    console.error('BAKE_WARN 高分母带烘焙前必须存在 1x meta.json（运行时读取），当前缺失');
  }
  console.log('BAKE_DONE ' + JSON.stringify({ ...meta, totalMB: +(cpf.length / 1024 / 1024).toFixed(2) }));
  app.quit();
});
