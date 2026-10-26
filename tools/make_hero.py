"""生成 README / Release 用的展示图（不含任何真实桌面内容）。

用透明的猫渲染图 + 合成壁纸，避免把用户桌面截图发到公开仓库。

用法：python tools/make_hero.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / "test" / "artifacts"
W, H = 1200, 675

# 1. 渐变壁纸
bg = Image.new("RGB", (W, H))
d = ImageDraw.Draw(bg)
top = (38, 44, 66)
bottom = (18, 20, 30)
for y in range(H):
    t = y / H
    d.line(
        [(0, y), (W, y)],
        fill=(
            int(top[0] + (bottom[0] - top[0]) * t),
            int(top[1] + (bottom[1] - top[1]) * t),
            int(top[2] + (bottom[2] - top[2]) * t),
        ),
    )

# 一点氛围光斑
glow = Image.new("RGB", (W, H), (0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse([120, -180, 720, 420], fill=(58, 70, 120))
gd.ellipse([760, 60, 1240, 520], fill=(44, 52, 86))
glow = glow.filter(ImageFilter.GaussianBlur(120))
bg = Image.blend(bg, Image.blend(bg, glow, 0.35), 0.6)

# 2. 底部任务栏
bar_h = 46
bar = Image.new("RGBA", (W, bar_h), (12, 13, 18, 235))
bg = bg.convert("RGBA")
bg.alpha_composite(bar, (0, H - bar_h))
d = ImageDraw.Draw(bg)
for i in range(6):
    x = 24 + i * 40
    d.rounded_rectangle([x, H - bar_h + 12, x + 24, H - bar_h + 34], radius=6,
                        fill=(90, 100, 130, 160))

# 3. 猫（透明底）
cat = Image.open(ART / "01-initial.png").convert("RGBA")
cat = cat.resize((int(cat.width * 1.18), int(cat.height * 1.18)), Image.LANCZOS)

# 影子
shadow = Image.new("RGBA", (cat.width, 40), (0, 0, 0, 0))
sd = ImageDraw.Draw(shadow)
sd.ellipse([cat.width * 0.18, 0, cat.width * 0.82, 34], fill=(0, 0, 0, 110))
shadow = shadow.filter(ImageFilter.GaussianBlur(10))

cx = W - cat.width - 60
cy = H - cat.height - 34
bg.alpha_composite(shadow, (cx, cy + cat.height - 26))
bg.alpha_composite(cat, (cx, cy))

# 4. 一句台词气泡
from PIL import ImageFont

try:
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 22)
except OSError:
    font = ImageFont.load_default()

text = "我回来啦"
d = ImageDraw.Draw(bg)
bbox = d.textbbox((0, 0), text, font=font)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
pad_x, pad_y = 18, 11
bw, bh = tw + pad_x * 2, th + pad_y * 2
bx = cx + cat.width // 2 - bw // 2 - 70
by = cy - bh - 26

d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=14, fill=(255, 255, 255, 242))
d.polygon([(bx + bw - 46, by + bh - 2), (bx + bw - 30, by + bh - 2), (bx + bw - 40, by + bh + 12)],
          fill=(255, 255, 255, 242))
d.text((bx + pad_x, by + pad_y - 2), text, font=font, fill=(50, 50, 60))

out = ART / "00-desktop.png"
bg.convert("RGB").save(out, quality=92)
print("hero ok:", out, out.stat().st_size, "bytes")
