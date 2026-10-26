'use strict';

(() => {
  const el = {
    levelTitle: document.getElementById('levelTitle'),
    affinity: document.getElementById('affinity'),
    levelBar: document.getElementById('levelBar'),
    moodText: document.getElementById('moodText'),
    moodBar: document.getElementById('moodBar'),
    todayPetted: document.getElementById('todayPetted'),
    todayFed: document.getElementById('todayFed'),
    modeText: document.getElementById('modeText'),
    autostartBtn: document.getElementById('autostartBtn'),
    passthroughBtn: document.getElementById('passthroughBtn'),
  };

  let info = { openAtLogin: false, autoPassthrough: true };

  function modeLabel(snapshot) {
    if (snapshot.sleeping) return '睡觉';
    if (snapshot.annoyed) return '生气';
    return '醒着';
  }

  function render(snapshot) {
    if (!snapshot) return;
    el.levelTitle.textContent = snapshot.level.title;
    el.affinity.textContent = snapshot.level.nextAt === null
      ? `亲密度 ${snapshot.affinity} · 满级`
      : `亲密度 ${snapshot.affinity} / ${snapshot.level.nextAt}`;
    el.levelBar.style.width = Math.round(snapshot.level.progress * 100) + '%';

    el.moodText.textContent = `${snapshot.mood} / 100`;
    el.moodBar.style.width = snapshot.mood + '%';

    el.todayPetted.textContent = snapshot.today.petted;
    el.todayFed.textContent = snapshot.today.fed;
    el.modeText.textContent = modeLabel(snapshot);
  }

  function renderInfo(next) {
    if (!next) return;
    info = { ...info, ...next };
    el.autostartBtn.textContent = '开机自启：' + (info.openAtLogin ? '开' : '关');
    el.passthroughBtn.textContent = '自动穿透：' + (info.autoPassthrough ? '开' : '关');
  }

  document.getElementById('close').addEventListener('click', () => {
    if (window.panel) window.panel.action('close-panel');
  });

  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.action;
      if (window.panel) window.panel.action(action);
      if (action === 'toggle-autostart') renderInfo({ openAtLogin: !info.openAtLogin });
      if (action === 'toggle-passthrough') renderInfo({ autoPassthrough: !info.autoPassthrough });
    });
  });

  if (window.panel) {
    window.panel.onState(render);
    window.panel.onInfo(renderInfo);
    window.panel.state().then((snapshot) => {
      render(snapshot);
      renderInfo(snapshot);
    });
  }
})();
