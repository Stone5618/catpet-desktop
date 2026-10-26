'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGrid, hitTest, solidPoints } = require('../../lib/hitmask');

// 10x10 画布，中间 6x6 是实心方块
function alphaAt(x, y) {
  return x >= 2 && x < 8 && y >= 2 && y < 8 ? 255 : 0;
}

test('buildGrid 能把方块采样出来', () => {
  const mask = buildGrid(alphaAt, 10, 10, 5, 5, { threshold: 0.5, sampleStep: 1 });
  assert.equal(mask.cols, 5);
  assert.equal(mask.rows, 5);
  // 4 个角一定是空的
  assert.equal(mask.cells[0][0], false);
  assert.equal(mask.cells[4][4], false);
  // 中间格一定命中
  assert.equal(mask.cells[2][2], true);
});

test('hitTest 命中/未命中/越界', () => {
  const mask = buildGrid(alphaAt, 10, 10, 5, 5, { threshold: 0.5, sampleStep: 1 });
  assert.equal(hitTest(mask, 0.5, 0.5), true);
  assert.equal(hitTest(mask, 0.02, 0.02), false);
  assert.equal(hitTest(mask, 1.2, 0.5), false);
  assert.equal(hitTest(mask, -0.1, 0.5), false);
  assert.equal(hitTest(null, 0.5, 0.5), false);
  assert.equal(hitTest(mask, Number.NaN, 0.5), false);
});

test('solidPoints 只返回实心格', () => {
  const mask = buildGrid(alphaAt, 10, 10, 5, 5, { threshold: 0.5, sampleStep: 1 });
  const points = solidPoints(mask);
  assert.ok(points.length > 0);
  for (const point of points) {
    assert.equal(hitTest(mask, point.x, point.y), true);
  }
});

test('阈值决定边缘格是否算命中', () => {
  // 每格 5px 宽，左侧 3px 为实心 -> 覆盖率 0.6
  const partial = (x) => (x < 3 ? 255 : 0);
  const strict = buildGrid(partial, 10, 10, 2, 2, { threshold: 0.7, sampleStep: 1 });
  assert.equal(strict.cells[0][0], false);
  const loose = buildGrid(partial, 10, 10, 2, 2, { threshold: 0.5, sampleStep: 1 });
  assert.equal(loose.cells[0][0], true);
});
