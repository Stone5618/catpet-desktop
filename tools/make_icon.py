"""生成应用图标（build/icon.ico + build/icon.png）。

用法：python tools/make_icon.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
BUILD.mkdir(exist_ok=True)

S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

BLACK = (32, 32, 38, 255)
EAR_INNER = (78, 62, 66, 255)
EYE = (242, 193, 78, 255)
PUPIL = (24, 20, 16, 255)
NOSE = (225, 132, 150, 255)

# 耳朵
d.polygon([(200, 420), (280, 120), (470, 330)], fill=BLACK)
d.polygon([(824, 420), (744, 120), (554, 330)], fill=BLACK)
d.polygon([(255, 400), (300, 205), (420, 345)], fill=EAR_INNER)
d.polygon([(769, 400), (724, 205), (604, 345)], fill=EAR_INNER)

# 头
d.ellipse([150, 260, 874, 900], fill=BLACK)

# 眼睛
d.ellipse([300, 500, 460, 660], fill=EYE)
d.ellipse([564, 500, 724, 660], fill=EYE)
d.ellipse([355, 545, 410, 620], fill=PUPIL)
d.ellipse([619, 545, 674, 620], fill=PUPIL)
d.ellipse([370, 555, 392, 580], fill=(255, 255, 255, 210))
d.ellipse([634, 555, 656, 580], fill=(255, 255, 255, 210))

# 鼻子与嘴
d.polygon([(492, 700), (532, 700), (512, 730)], fill=NOSE)
d.arc([452, 720, 512, 780], 20, 160, fill=BLACK, width=8)
d.arc([512, 720, 572, 780], 20, 160, fill=BLACK, width=8)

# 胡须
for y1, y2, x2 in [(660, 640, 150), (700, 700, 160), (740, 760, 180)]:
    d.line([(400, y1), (x2, y2)], fill=(230, 230, 230, 190), width=10)
for y1, y2, x2 in [(660, 640, 874), (700, 700, 864), (740, 760, 844)]:
    d.line([(624, y1), (x2, y2)], fill=(230, 230, 230, 190), width=10)

img = img.resize((256, 256), Image.LANCZOS)
img.save(BUILD / "icon.png")

sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
img.save(BUILD / "icon.ico", sizes=sizes)
print("icon ok:", (BUILD / "icon.ico").stat().st_size, "bytes")
