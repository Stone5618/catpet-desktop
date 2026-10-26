'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mood = require('../../lib/mood');

const T0 = new Date('2026-10-27T10:00:00+08:00').getTime();
const MIN = 60 * 1000;

test('createState 给出合理默认值', () => {
  const state = mood.createState(T0);
  assert.equal(state.affinity, 0);
  assert.equal(state.mood, 70);
  assert.deepEqual(state.today, { petted: 0, fed: 0 });
  assert.equal(state.day, '2026-10-27');
});

test('levelOf 在阈值处正确升级', () => {
  assert.equal(mood.levelOf(0).title, '陌生猫');
  assert.equal(mood.levelOf(9).title, '陌生猫');
  assert.equal(mood.levelOf(10).title, '眼熟的猫');
  assert.equal(mood.levelOf(30).title, '朋友');
  assert.equal(mood.levelOf(60).title, '粘人精');
  assert.equal(mood.levelOf(100).title, '家人');
  assert.equal(mood.levelOf(100).nextAt, null);
  assert.equal(mood.levelOf(100).progress, 1);
});

test('摸一下：心情 +2、亲密度 +1、计数 +1', () => {
  const state = mood.createState(T0);
  const { state: next, event } = mood.applyPetting(state, T0);
  assert.equal(event, 'happy');
  assert.equal(next.mood, 72);
  assert.equal(next.affinity, 1);
  assert.equal(next.today.petted, 1);
});

test('8 秒内连戳 5 次会炸毛，并且摸不回来', () => {
  let state = mood.createState(T0);
  let event = '';
  for (let i = 0; i < mood.ANNOY_THRESHOLD; i++) {
    const result = mood.applyPetting(state, T0 + i * 300);
    state = result.state;
    event = result.event;
  }
  assert.equal(event, 'annoyed');
  assert.ok(state.annoyedUntil > T0);
  assert.equal(mood.isAnnoyed(state, T0 + 1000), true);

  const before = state.affinity;
  const annoyedUntil = state.annoyedUntil;
  const grumpy = mood.applyPetting(state, T0 + 2000);
  assert.equal(grumpy.event, 'grumpy');
  assert.equal(grumpy.state.affinity, before);
  assert.equal(grumpy.state.annoyedUntil, annoyedUntil, '生气时间不该被续期');
});

test('气消之后连击计数清零，可以重新开始', () => {
  let state = mood.createState(T0);
  for (let i = 0; i < mood.ANNOY_THRESHOLD; i++) {
    state = mood.applyPetting(state, T0 + i * 300).state;
  }
  const afterCalm = state.annoyedUntil + 1000;
  const first = mood.applyPetting(state, afterCalm);
  assert.equal(first.event, 'happy');
  assert.equal(first.state.petStreak, 1, '计数应从头开始');
});

test('闹脾气会过期', () => {
  let state = mood.createState(T0);
  for (let i = 0; i < mood.ANNOY_THRESHOLD; i++) {
    state = mood.applyPetting(state, T0 + i * 300).state;
  }
  const later = state.annoyedUntil + 1;
  assert.equal(mood.isAnnoyed(state, later), false);
});

test('喂食：心情 +14、亲密度 +3；吃饱之后拒绝', () => {
  const state = mood.createState(T0);
  const fed = mood.applyFeed(state, T0);
  assert.equal(fed.event, 'fed');
  assert.equal(fed.state.mood, 84);
  assert.equal(fed.state.affinity, 3);

  const fullState = { ...state, mood: 92 };
  const full = mood.applyFeed(fullState, T0);
  assert.equal(full.event, 'full');
  assert.equal(full.state.mood, 92);
  assert.equal(full.state.affinity, 0);
});

test('心情上限 100、下限 5', () => {
  const high = { ...mood.createState(T0), mood: 99 };
  assert.equal(mood.applyPetting(high, T0).state.mood, 100);

  const low = { ...mood.createState(T0), mood: 6 };
  assert.equal(mood.applyPetting(low, T0).state.mood, 8);

  const hungry = { ...mood.createState(T0), mood: 5 };
  assert.equal(mood.applyFeed(hungry, T0).state.mood, 19);
});

test('离线结算：按离开时长掉心情，最多掉 25', () => {
  const state = { ...mood.createState(T0), mood: 90, lastSeen: T0 };
  const away30min = mood.settle(state, T0 + 30 * MIN);
  assert.equal(away30min.mood, 87);

  const away10h = mood.settle(state, T0 + 10 * 60 * MIN);
  assert.equal(away10h.mood, 65);
  assert.equal(away10h.lastSeen, T0 + 10 * 60 * MIN);
});

test('离线不足 10 分钟不掉心情', () => {
  const state = { ...mood.createState(T0), mood: 90, lastSeen: T0 };
  assert.equal(mood.settle(state, T0 + 9 * MIN).mood, 90);
});

test('空闲衰减 20 分钟掉 1 点，地板 20', () => {
  const state = { ...mood.createState(T0), mood: 30 };
  assert.equal(mood.idleDecay(state, 20 * MIN).mood, 29);
  assert.equal(mood.idleDecay(state, 19 * MIN).mood, 30);
  assert.equal(mood.idleDecay({ ...state, mood: 20 }, 5 * 60 * MIN).mood, 20);
});

test('跨天会重置今日计数', () => {
  const state = { ...mood.createState(T0), today: { petted: 9, fed: 3 } };
  const nextDay = mood.refreshDay(state, T0 + 24 * 60 * MIN);
  assert.deepEqual(nextDay.today, { petted: 0, fed: 0 });
  assert.notEqual(nextDay.day, state.day);
});

test('normalize 能兜住脏存档', () => {
  const fallback = mood.createState(T0);
  assert.deepEqual(mood.normalize(null, fallback), fallback);
  assert.equal(mood.normalize({ mood: 'abc' }, fallback).mood, 70);
  assert.equal(mood.normalize({ mood: 9999 }, fallback).mood, 100);
  assert.equal(mood.normalize({ mood: -50 }, fallback).mood, 5);
  assert.equal(mood.normalize({ affinity: -3 }, fallback).affinity, 0);
  assert.deepEqual(mood.normalize({ today: {} }, fallback).today, { petted: 0, fed: 0 });
});
