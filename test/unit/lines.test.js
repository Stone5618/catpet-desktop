'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const lines = require('../../lib/lines');

test('时间段划分正确', () => {
  assert.equal(lines.bucketByHour(6), 'morning');
  assert.equal(lines.bucketByHour(10), 'morning');
  assert.equal(lines.bucketByHour(12), 'idle');
  assert.equal(lines.bucketByHour(20), 'night');
  assert.equal(lines.bucketByHour(23), 'late');
  assert.equal(lines.bucketByHour(3), 'late');
});

test('不会连续说同一句', () => {
  const last = lines.POOLS.pet[0];
  for (let i = 0; i < 60; i++) {
    const line = lines.pickLine({ kind: 'pet', mood: 80, affinity: 0, hour: 12, last });
    assert.notEqual(line, last);
  }
});

test('低心情时走低心情语料', () => {
  const line = lines.pickLine({ kind: 'pet', mood: 10, affinity: 0, hour: 12 }, () => 0);
  assert.ok(lines.POOLS.low.includes(line));
});

test('高亲密度时可能说黏人的话', () => {
  const line = lines.pickLine({ kind: 'pet', mood: 80, affinity: 80, hour: 12 }, () => 0);
  assert.ok(lines.POOLS.high.includes(line));
});

test('未知类型回退到 idle，不会抛错', () => {
  const line = lines.pickLine({ kind: 'nonsense', hour: 12 }, () => 0);
  assert.equal(typeof line, 'string');
  assert.ok(line.length > 0);
});

test('所有语料池都非空且无重复', () => {
  for (const [name, pool] of Object.entries(lines.POOLS)) {
    assert.ok(pool.length >= 2, `${name} 语料太少`);
    assert.equal(new Set(pool).size, pool.length, `${name} 有重复台词`);
  }
});
