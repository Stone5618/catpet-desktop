'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../../lib/store');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'catpet-store-'));
}

test('文件不存在时返回默认值', () => {
  const dir = tempDir();
  const file = path.join(dir, 'state.json');
  const result = store.load(file, () => ({ mood: 70 }));
  assert.deepEqual(result.data, { mood: 70 });
  assert.equal(result.missing, true);
  assert.equal(result.recovered, false);
});

test('存档损坏时回退默认值并标记 recovered', () => {
  const dir = tempDir();
  const file = path.join(dir, 'state.json');
  fs.writeFileSync(file, '{ this is not json', 'utf8');
  const result = store.load(file, () => ({ mood: 70 }));
  assert.deepEqual(result.data, { mood: 70 });
  assert.equal(result.recovered, true);
});

test('写入后能原样读回', () => {
  const dir = tempDir();
  const file = path.join(dir, 'nested', 'state.json');
  const data = { mood: 55, affinity: 12, today: { petted: 3, fed: 1 } };
  store.save(file, data);
  const result = store.load(file, () => ({}));
  assert.deepEqual(result.data, data);
  assert.equal(result.recovered, false);
});

test('原子写入不留下临时文件', () => {
  const dir = tempDir();
  const file = path.join(dir, 'state.json');
  store.save(file, { a: 1 });
  store.save(file, { a: 2 });
  const leftovers = fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
  assert.deepEqual(store.load(file, () => ({})).data, { a: 2 });
});
