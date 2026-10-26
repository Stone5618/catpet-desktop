"""从渲染截图生成点击遮罩。

用法：
    python tools/gen_hitmask.py E:/temp/pet_v2.png

输出：
    renderer/hitmask.js   （window.HITMASK = {...}）
    E:/temp/hitmask_overlay.png （红色遮罩可视化，用于人工校验）
"""

import json
import sys
from pathlib import Path

from PIL import Image

COLS = 20
ROWS = 24
ALPHA_CUT = 40
COVERAGE = 0.10
SAMPLE = 2

ROOT = Path(__file__).resolve().parent.parent


def build_grid(img, cols, rows, coverage, alpha_cut, sample):
    w, h = img.size
    alpha = img.getchannel("A").load()
    cell_w = w / cols
    cell_h = h / rows
    cells = []
    for r in range(rows):
        row = []
        y0, y1 = int(r * cell_h), int((r + 1) * cell_h)
        for c in range(cols):
            x0, x1 = int(c * cell_w), int((c + 1) * cell_w)
            hits = total = 0
            for y in range(y0, y1, sample):
                for x in range(x0, x1, sample):
                    total += 1
                    if alpha[x, y] > alpha_cut:
                        hits += 1
            row.append(bool(total) and hits / total >= coverage)
        cells.append(row)
    return cells


def solid_points(cells):
    pts = []
    for r, row in enumerate(cells):
        for c, on in enumerate(row):
            if on:
                pts.append((c, r))
    return pts


def main():
    image_path = Path(sys.argv[1] if len(sys.argv) > 1 else "E:/temp/pet_v2.png")
    img = Image.open(image_path).convert("RGBA")
    cells = build_grid(img, COLS, ROWS, COVERAGE, ALPHA_CUT, SAMPLE)
    pts = solid_points(cells)

    payload = {"cols": COLS, "rows": ROWS, "cells": cells}
    out_js = ROOT / "renderer" / "hitmask.js"
    out_js.write_text(
        "// 由 tools/gen_hitmask.py 自动生成，请勿手改\n"
        f"window.HITMASK = {json.dumps(payload)};\n",
        encoding="utf-8",
    )
    (ROOT / "renderer" / "hitmask.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # 可视化：把实心格涂成半透明红色
    overlay = img.copy()
    px = overlay.load()
    cw, ch = img.size[0] / COLS, img.size[1] / ROWS
    for c, r in pts:
        x0, x1 = int(c * cw), int((c + 1) * cw)
        y0, y1 = int(r * ch), int((r + 1) * ch)
        for y in range(y0, y1):
            for x in range(x0, x1):
                r0, g0, b0, a0 = px[x, y]
                px[x, y] = (255, 60, 60, max(a0, 90))

    overlay_path = Path("E:/temp/hitmask_overlay.png")
    overlay.save(overlay_path)

    # 终端里也打一份，方便快速判断形状
    for r in range(ROWS):
        print("".join("#" if cells[r][c] else "." for c in range(COLS)))
    print(f"\n实心格: {len(pts)} / {COLS * ROWS}, 输出: {out_js}")


if __name__ == "__main__":
    main()
