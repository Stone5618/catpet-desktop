'use strict';

// 抛掷物理：重力 + 边缘反弹 + 地面摩擦，纯函数便于测试

const DEFAULTS = {
  gravity: 2600,
  restitution: 0.5,
  friction: 0.82,
  sleepSpeed: 20,
  maxDt: 0.05,
};

function createBody(x, y) {
  return { x, y, vx: 0, vy: 0 };
}

function step(body, dt, bounds, options = {}) {
  const opt = { ...DEFAULTS, ...options };
  const delta = Math.min(Math.max(dt, 0), opt.maxDt);

  let { x, y, vx, vy } = body;
  vy += opt.gravity * delta;
  x += vx * delta;
  y += vy * delta;

  if (x < bounds.left) {
    x = bounds.left;
    vx = Math.abs(vx) * opt.restitution;
  } else if (x > bounds.right) {
    x = bounds.right;
    vx = -Math.abs(vx) * opt.restitution;
  }

  if (y > bounds.bottom) {
    y = bounds.bottom;
    vy = -Math.abs(vy) * opt.restitution;
    if (Math.abs(vy) < 60) vy = 0;
  } else if (y < bounds.top) {
    y = bounds.top;
    vy = Math.abs(vy) * opt.restitution;
  }

  const onFloor = y >= bounds.bottom - 0.5;
  if (onFloor) {
    vx *= opt.friction;
    if (Math.abs(vx) < opt.sleepSpeed) vx = 0;
  }

  const settled = onFloor && vx === 0 && vy === 0;
  return { body: { x, y, vx, vy }, settled };
}

module.exports = { DEFAULTS, createBody, step };
