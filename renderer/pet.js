'use strict';

// 交互层：命中检测、拖拽、点击、双击、特效、帧率上报
(() => {
  const bubble = document.getElementById('bubble');
  const hearts = document.getElementById('hearts');
  const mask = window.HITMASK || null;

  let pressing = false;
  let moved = false;
  let downAt = 0;
  let downX = 0;
  let downY = 0;
  let lastClickAt = 0;
  let bubbleTimer = null;
  let audioContext = null;

  const body = document.body;

  function say(text) {
    if (!text) return;
    bubble.textContent = text;
    bubble.classList.add('show');
    if (bubbleTimer) clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubble.classList.remove('show'), 2600);
  }

  function dropParticle(kind, glyph) {
    const node = document.createElement('span');
    node.className = 'particle ' + kind;
    node.textContent = glyph;
    if (kind === 'heart') {
      node.style.left = (28 + Math.random() * 44) + '%';
      node.style.top = (42 + Math.random() * 22) + '%';
      node.style.setProperty('--drift', (Math.random() * 30 - 15).toFixed(1) + 'px');
    } else {
      node.style.left = (32 + Math.random() * 36) + '%';
      node.style.top = '24%';
    }
    hearts.appendChild(node);
    node.addEventListener('animationend', () => node.remove());
  }

  // 合成呼噜声：噪声 + 26Hz 调幅，不依赖任何音频文件
  function purr() {
    try {
      audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === 'suspended') audioContext.resume();

      const ctx = audioContext;
      const duration = 0.85;
      const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.6;

      const source = ctx.createBufferSource();
      source.buffer = buffer;

      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 190;
      lowpass.Q.value = 7;

      const amp = ctx.createGain();
      amp.gain.value = 0.5;

      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 26;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.42;

      const out = ctx.createGain();
      out.gain.value = 0;

      lfo.connect(lfoGain);
      lfoGain.connect(amp.gain);
      source.connect(lowpass);
      lowpass.connect(amp);
      amp.connect(out);
      out.connect(ctx.destination);

      const now = ctx.currentTime;
      out.gain.setValueAtTime(0, now);
      out.gain.linearRampToValueAtTime(0.2, now + 0.08);
      out.gain.setValueAtTime(0.2, now + duration - 0.25);
      out.gain.linearRampToValueAtTime(0, now + duration);

      source.start(now);
      lfo.start(now);
      source.stop(now + duration);
      lfo.stop(now + duration);
    } catch (err) {
      /* 静音失败不影响互动 */
    }
  }

  window.addEventListener('pointermove', (event) => {
    if (!pressing) return;
    if (Math.abs(event.screenX - downX) > 4 || Math.abs(event.screenY - downY) > 4) moved = true;
  });

  window.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    pressing = true;
    moved = false;
    downAt = performance.now();
    downX = event.screenX;
    downY = event.screenY;
    body.classList.add('dragging');
    if (window.pet) {
      // 在按下瞬间记录"光标相对窗口左上角"的位置，避免主进程处理延迟导致窗口跳动
      window.pet.dragStart(event.screenX - window.screenX, event.screenY - window.screenY);
    }
  });

  window.addEventListener('pointerup', () => {
    if (!pressing) return;
    pressing = false;
    body.classList.remove('dragging');
    if (window.pet) window.pet.dragEnd();

    const isClick = !moved && performance.now() - downAt < 500;
    if (!isClick) return;

    const now = performance.now();
    if (now - lastClickAt < 330) {
      lastClickAt = 0;
      if (window.pet) window.pet.panel();
      return;
    }
    lastClickAt = now;
    if (window.pet) window.pet.click();
  });

  window.addEventListener('pointercancel', () => {
    if (!pressing) return;
    pressing = false;
    body.classList.remove('dragging');
    if (window.pet) window.pet.dragEnd();
  });

  window.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (window.pet) window.pet.menu();
  });

  if (window.pet) {
    window.pet.onSay((payload) => say(payload && payload.text));

    window.pet.onFx((fx) => {
      if (!fx) return;
      if (fx.heart) {
        dropParticle('heart', '♥');
        setTimeout(() => dropParticle('heart', '♥'), 130);
      }
      if (fx.fish) {
        dropParticle('fish', '🐟');
        setTimeout(() => dropParticle('fish', '🐟'), 180);
      }
      if (fx.purr) purr();
      if (fx.shake) {
        body.classList.add('shaking');
        setTimeout(() => body.classList.remove('shaking'), 900);
      }
    });

    window.pet.onState((snapshot) => {
      if (!snapshot) return;
      body.classList.toggle('sleeping', !!snapshot.sleeping);
      body.classList.toggle('annoyed', !!snapshot.annoyed);
      // 睡觉时把帧率降到 5fps，常驻功耗更低
      if (window.__setFrameCap) window.__setFrameCap(snapshot.sleeping ? 5 : 40);
    });
  }

  // 帧率采样，供性能验收读取
  let frames = 0;
  let fpsAt = performance.now();
  window.__fps = 0;
  function loop() {
    frames += 1;
    const now = performance.now();
    if (now - fpsAt >= 1000) {
      window.__fps = Math.round((frames * 1000) / (now - fpsAt));
      frames = 0;
      fpsAt = now;
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  window.addEventListener('load', () => {
    setTimeout(() => say('我回来啦'), 900);
  });
})();
