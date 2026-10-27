"""生成猫猫音效（纯程序合成，无第三方素材、无授权问题）。

产出：
    assets/sounds/meow.wav          普通喵
    assets/sounds/meow2.wav         第二声（音高不同）
    assets/sounds/meow-annoyed.wav  不耐烦的低喵
    assets/sounds/purr.wav          呼噜（可循环）
    assets/sounds/eat.wav           吃东西的咔嚓声

合成方式：源-滤波器模型
    声源 = 谐波堆叠的锯齿波（模拟声带）
    声道 = 三个时变共振峰（模拟猫的声道）
    呼噜 = 低频噪声 + 26Hz 调幅（真实呼噜的物理特征）
"""

import math
import os
import random
import struct
import wave

SR = 22050
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "sounds")
random.seed(7)


def write_wav(path, samples):
    peak = max(1e-9, max(abs(s) for s in samples))
    scale = 0.85 / peak
    data = b"".join(struct.pack("<h", int(max(-1.0, min(1.0, s * scale)) * 32767)) for s in samples)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data)


class Resonator:
    """二阶共振峰滤波器，系数随中心频率变化。"""

    def __init__(self):
        self.y1 = 0.0
        self.y2 = 0.0

    def process(self, x, freq, bw):
        r = math.exp(-math.pi * bw / SR)
        theta = 2 * math.pi * freq / SR
        a1 = 2 * r * math.cos(theta)
        a2 = -r * r
        y = (1 - r) * x + a1 * self.y1 + a2 * self.y2
        self.y2 = self.y1
        self.y1 = y
        return y


def glottal_source(f0_curve, n, jitter=0.01):
    """谐波堆叠的锯齿波，带轻微抖动。"""
    out = []
    phase = 0.0
    for i in range(n):
        f0 = f0_curve(i / n)
        phase += f0 / SR
        phase -= math.floor(phase)
        # 带限锯齿：12 个谐波
        s = 0.0
        for k in range(1, 13):
            s += math.sin(2 * math.pi * k * phase) / k
        jitter_v = 1.0 + (random.random() - 0.5) * jitter
        out.append(s * jitter_v)
    return out


def synth_meow(duration, f0_points, f1_points, f2_points, f3_points, gain=1.0):
    n = int(SR * duration)
    f0 = lambda t: interp(f0_points, t)
    src = glottal_source(f0, n)
    r1, r2, r3 = Resonator(), Resonator(), Resonator()
    out = []
    for i in range(n):
        t = i / n
        s = src[i]
        s = r1.process(s, interp(f1_points, t), 110)
        s = r2.process(s, interp(f2_points, t), 180)
        s = r3.process(s, interp(f3_points, t), 260)
        env = envelope(t)
        out.append(s * env * gain)
    return out


def interp(points, t):
    """points: [(t0,v0),(t1,v1),...]，线性插值。"""
    if t <= points[0][0]:
        return points[0][1]
    for i in range(1, len(points)):
        t0, v0 = points[i - 1]
        t1, v1 = points[i]
        if t <= t1:
            k = (t - t0) / max(1e-6, t1 - t0)
            return v0 + (v1 - v0) * k
    return points[-1][1]


def envelope(t):
    attack, release = 0.06, 0.28
    if t < attack:
        return t / attack
    if t > 1 - release:
        return max(0.0, (1 - t) / release) ** 0.8
    return 1.0


def make_purr(seconds=2.0):
    n = int(SR * seconds)
    out = []
    lp = 0.0
    lp2 = 0.0
    for i in range(n):
        noise = random.uniform(-1, 1)
        lp += 0.12 * (noise - lp)          # 低通
        lp2 += 0.35 * (lp - lp2)           # 再收一点高频
        t = i / SR
        am = 0.45 + 0.55 * (0.5 + 0.5 * math.sin(2 * math.pi * 26 * t))
        body = lp2 * am
        thump = 0.35 * math.sin(2 * math.pi * 26 * t) * (0.5 + 0.5 * math.sin(2 * math.pi * 0.7 * t))
        out.append(body * 0.9 + thump * 0.25)
    # 首尾淡入淡出，便于循环
    fade = int(SR * 0.05)
    for i in range(fade):
        k = i / fade
        out[i] *= k
        out[-1 - i] *= k
    return out


def make_eat():
    n = int(SR * 0.35)
    out = []
    for i in range(n):
        t = i / SR
        burst = 0.0
        for center in (0.02, 0.14, 0.24):
            d = t - center
            if 0 <= d < 0.06:
                burst += math.exp(-d * 60) * random.uniform(-1, 1)
        out.append(burst * 0.6)
    return out


def main():
    os.makedirs(OUT, exist_ok=True)

    # 普通喵：短促上扬再收
    meow = synth_meow(
        0.5,
        f0_points=[(0.0, 560), (0.18, 780), (0.45, 620), (1.0, 430)],
        f1_points=[(0.0, 950), (0.4, 780), (1.0, 620)],
        f2_points=[(0.0, 2100), (0.4, 1750), (1.0, 1400)],
        f3_points=[(0.0, 3100), (1.0, 2600)],
    )
    write_wav(os.path.join(OUT, "meow.wav"), meow)

    # 第二声：更高更短
    meow2 = synth_meow(
        0.42,
        f0_points=[(0.0, 700), (0.2, 900), (1.0, 520)],
        f1_points=[(0.0, 1050), (1.0, 700)],
        f2_points=[(0.0, 2300), (1.0, 1550)],
        f3_points=[(0.0, 3300), (1.0, 2700)],
    )
    write_wav(os.path.join(OUT, "meow2.wav"), meow2)

    # 不耐烦：低、短、粗糙
    annoyed = synth_meow(
        0.38,
        f0_points=[(0.0, 420), (0.5, 470), (1.0, 330)],
        f1_points=[(0.0, 750), (1.0, 560)],
        f2_points=[(0.0, 1500), (1.0, 1150)],
        f3_points=[(0.0, 2500), (1.0, 2100)],
        gain=0.9,
    )
    write_wav(os.path.join(OUT, "meow-annoyed.wav"), annoyed)

    write_wav(os.path.join(OUT, "purr.wav"), make_purr(2.0))
    write_wav(os.path.join(OUT, "eat.wav"), make_eat())

    for name in ("meow.wav", "meow2.wav", "meow-annoyed.wav", "purr.wav", "eat.wav"):
        p = os.path.join(OUT, name)
        print(name, os.path.getsize(p), "bytes")


if __name__ == "__main__":
    main()
