'use strict';

// 本地存档：原子写入 + 损坏兜底

const fs = require('node:fs');
const path = require('node:path');

function load(file, createDefault) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return { data: parsed, recovered: false };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { data: createDefault(), recovered: false, missing: true };
    }
    return { data: createDefault(), recovered: true, error: err.message };
  }
}

function save(file, data) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

module.exports = { load, save };
