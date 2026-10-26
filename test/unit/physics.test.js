'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBody, step } = require('../../lib/physics');

const BOUNDS = { left: 0, top: 0, right: 800, bottom: 600 };

test('受重力下落到地面并停住', () => {
  let body = createBody(400, 100);
  let settled = false;
  for (let i = 0; i < 600 && !settled; i++) {
    const result = step(body, 1 / 60, BOUNDS);
    body = result.body;
    settled = result.settled;
  }
  assert.equal(settled, true);
  assert.equal(Math.round(body.y), 600);
  assert.equal(body.vx, 0);
});

test('任意初速度都不会越界', () => {
  const seeds = [
    { vx: 3000, vy: -2000 },
    { vx: -3000, vy: 2500 },
    { vx: 1200, vy: -4000 },
  ];
  for (const seed of seeds) {
    let body = { ...createBody(400, 300), ...seed };
    for (let i = 0; i < 400; i++) {
      const result = step(body, 1 / 60, BOUNDS);
      body = result.body;
      assert.ok(body.x >= BOUNDS.left - 0.001, `x 越界: ${body.x}`);
      assert.ok(body.x <= BOUNDS.right + 0.001, `x 越界: ${body.x}`);
      assert.ok(body.y >= BOUNDS.top - 0.001, `y 越界: ${body.y}`);
      assert.ok(body.y <= BOUNDS.bottom + 0.001, `y 越界: ${body.y}`);
    }
  }
});

test('水平速度会被摩擦耗尽', () => {
  let body = { ...createBody(100, 600), vx: 900 };
  for (let i = 0; i < 240; i++) {
    body = step(body, 1 / 60, BOUNDS).body;
  }
  assert.ok(Math.abs(body.vx) < 10, `vx 未衰减: ${body.vx}`);
});

test('dt 过大时会被钳制，不会瞬移出界', () => {
  let body = createBody(400, 600);
  const result = step(body, 5, BOUNDS);
  assert.ok(result.body.y <= BOUNDS.bottom);
  assert.ok(result.body.y >= BOUNDS.top);
});

test('零 dt 不产生位移', () => {
  const body = createBody(200, 200);
  const result = step(body, 0, BOUNDS);
  assert.equal(result.body.x, 200);
  assert.equal(result.body.y, 200);
});
