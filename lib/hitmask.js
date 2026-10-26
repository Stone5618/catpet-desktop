'use strict';

// UMD：主进程 require 用，渲染进程 <script> 也能用
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.hitmask = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function buildGrid(getAlpha, width, height, cols, rows, options) {
    const opt = options || {};
    const threshold = opt.threshold ?? 0.12;
    const alphaCut = opt.alphaCut ?? 40;
    const sampleStep = opt.sampleStep ?? 2;
    const cellW = width / cols;
    const cellH = height / rows;
    const cells = [];

    for (let r = 0; r < rows; r++) {
      const row = [];
      const y0 = Math.floor(r * cellH);
      const y1 = Math.ceil((r + 1) * cellH);
      for (let c = 0; c < cols; c++) {
        const x0 = Math.floor(c * cellW);
        const x1 = Math.ceil((c + 1) * cellW);
        let hits = 0;
        let total = 0;
        for (let y = y0; y < y1; y += sampleStep) {
          for (let x = x0; x < x1; x += sampleStep) {
            total += 1;
            if (getAlpha(x, y) > alphaCut) hits += 1;
          }
        }
        row.push(total > 0 && hits / total >= threshold);
      }
      cells.push(row);
    }

    return { cols, rows, cells };
  }

  function hitTest(mask, nx, ny) {
    if (!mask || !Array.isArray(mask.cells)) return false;
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return false;
    if (nx < 0 || ny < 0 || nx >= 1 || ny >= 1) return false;
    const col = Math.floor(nx * mask.cols);
    const row = Math.floor(ny * mask.rows);
    if (col < 0 || row < 0 || col >= mask.cols || row >= mask.rows) return false;
    const line = mask.cells[row];
    return Boolean(line && line[col]);
  }

  function solidPoints(mask) {
    const points = [];
    for (let r = 0; r < mask.rows; r++) {
      for (let c = 0; c < mask.cols; c++) {
        if (mask.cells[r] && mask.cells[r][c]) {
          points.push({ x: (c + 0.5) / mask.cols, y: (r + 0.5) / mask.rows });
        }
      }
    }
    return points;
  }

  return { buildGrid, hitTest, solidPoints };
});
