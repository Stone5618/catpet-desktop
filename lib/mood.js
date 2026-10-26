'use strict';

// 养成模型：心情 / 亲密度 / 连点惩罚 / 离线结算
// 全部为纯函数，不依赖 Electron，便于单元测试

const MAX_MOOD = 100;
const MIN_MOOD = 5;
const ANNOY_WINDOW_MS = 8000;
const ANNOY_THRESHOLD = 5;
const ANNOY_DURATION_MS = 30000;

const LEVELS = [
  { min: 0, title: '陌生猫' },
  { min: 10, title: '眼熟的猫' },
  { min: 30, title: '朋友' },
  { min: 60, title: '粘人精' },
  { min: 100, title: '家人' },
];

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

function dayKey(now) {
  const d = new Date(now);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

function createState(now = Date.now()) {
  return {
    version: 1,
    affinity: 0,
    mood: 70,
    lastSeen: now,
    lastPetAt: 0,
    lastFedAt: 0,
    annoyedUntil: 0,
    petStreak: 0,
    createdAt: now,
    day: dayKey(now),
    today: { petted: 0, fed: 0 },
  };
}

function levelOf(affinity) {
  let index = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if (affinity >= LEVELS[i].min) index = i;
  }
  const current = LEVELS[index];
  const next = LEVELS[index + 1] || null;
  const spanStart = current.min;
  const spanEnd = next ? next.min : current.min + 50;
  const progress = next
    ? clamp((affinity - spanStart) / (spanEnd - spanStart), 0, 1)
    : 1;
  return {
    index,
    title: current.title,
    nextAt: next ? next.min : null,
    progress,
  };
}

function refreshDay(state, now) {
  const key = dayKey(now);
  if (state.day === key) return state;
  return { ...state, day: key, today: { petted: 0, fed: 0 } };
}

// 启动时结算：按离开时长掉心情，并跨天重置计数
function settle(state, now) {
  const next = refreshDay({ ...state, today: { ...state.today } }, now);
  const away = Math.max(0, now - (state.lastSeen || now));
  const awayMinutes = Math.floor(away / 60000);
  if (awayMinutes >= 10) {
    const loss = Math.min(25, Math.floor(awayMinutes / 10));
    next.mood = clamp(next.mood - loss, MIN_MOOD, MAX_MOOD);
  }
  next.lastSeen = now;
  next.petStreak = 0;
  return next;
}

// 空闲衰减：20 分钟掉 1 点，地板 20
function idleDecay(state, idleMs) {
  const steps = Math.floor(idleMs / (20 * 60 * 1000));
  if (steps <= 0) return state;
  return { ...state, mood: clamp(state.mood - steps, 20, MAX_MOOD) };
}

function applyPetting(state, now) {
  const next = { ...state, today: { ...state.today } };
  next.today.petted += 1;
  next.lastPetAt = now;

  // 正在气头上：怎么摸都没用，也不延长生气时间
  if (now < (state.annoyedUntil || 0)) {
    return { state: next, event: 'grumpy' };
  }

  if (now - state.lastPetAt > ANNOY_WINDOW_MS) next.petStreak = 0;
  next.petStreak += 1;

  if (next.petStreak >= ANNOY_THRESHOLD) {
    next.petStreak = 0;
    next.annoyedUntil = now + ANNOY_DURATION_MS;
    next.mood = clamp(next.mood - 3, MIN_MOOD, MAX_MOOD);
    return { state: next, event: 'annoyed' };
  }

  next.mood = clamp(next.mood + 2, MIN_MOOD, MAX_MOOD);
  next.affinity = Math.max(0, next.affinity + 1);
  return { state: next, event: 'happy' };
}

function applyFeed(state, now) {
  const next = { ...state, today: { ...state.today } };
  if (next.mood >= 92) {
    return { state: next, event: 'full' };
  }
  next.mood = clamp(next.mood + 14, MIN_MOOD, MAX_MOOD);
  next.affinity = Math.max(0, next.affinity + 3);
  next.lastFedAt = now;
  next.today.fed += 1;
  return { state: next, event: 'fed' };
}

function isAnnoyed(state, now) {
  return now < (state.annoyedUntil || 0);
}

// 兜底：存档里可能出现缺字段/脏数据
function normalize(raw, fallback = createState()) {
  if (!raw || typeof raw !== 'object') return fallback;
  const base = { ...fallback, today: { ...fallback.today } };
  const num = (value, alt) => (Number.isFinite(value) ? value : alt);
  return {
    version: 1,
    affinity: Math.max(0, Math.round(num(raw.affinity, base.affinity))),
    mood: clamp(Math.round(num(raw.mood, base.mood)), MIN_MOOD, MAX_MOOD),
    lastSeen: num(raw.lastSeen, base.lastSeen),
    lastPetAt: num(raw.lastPetAt, 0),
    lastFedAt: num(raw.lastFedAt, 0),
    annoyedUntil: num(raw.annoyedUntil, 0),
    petStreak: Math.max(0, Math.round(num(raw.petStreak, 0))),
    createdAt: num(raw.createdAt, base.createdAt),
    day: typeof raw.day === 'string' ? raw.day : base.day,
    today: {
      petted: Math.max(0, Math.round(num(raw.today && raw.today.petted, 0))),
      fed: Math.max(0, Math.round(num(raw.today && raw.today.fed, 0))),
    },
  };
}

module.exports = {
  MAX_MOOD,
  MIN_MOOD,
  ANNOY_THRESHOLD,
  ANNOY_WINDOW_MS,
  ANNOY_DURATION_MS,
  LEVELS,
  clamp,
  dayKey,
  createState,
  levelOf,
  refreshDay,
  settle,
  idleDecay,
  applyPetting,
  applyFeed,
  isAnnoyed,
  normalize,
};
