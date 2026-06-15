#!/usr/bin/env python3
"""의존성 없이 PWA 아이콘(PNG)을 생성한다.
브랜드 배경 + 흰색 인물 실루엣(행정전화부 = 직원 명부).
maskable 버전은 안전 영역(중앙 80%) 안에 모티브가 들어가도록 축소한다.
"""
import struct
import zlib
import os

BRAND = (31, 111, 235)       # #1f6feb
BRAND_DARK = (22, 87, 192)
WHITE = (255, 255, 255)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def make_icon(size, maskable=False):
    px = bytearray(size * size * 3)

    def setp(x, y, color):
        if 0 <= x < size and 0 <= y < size:
            i = (y * size + x) * 3
            px[i], px[i + 1], px[i + 2] = color

    def disc(cx, cy, r, color):
        r2 = r * r
        y0, y1 = max(0, int(cy - r)), min(size, int(cy + r) + 1)
        for y in range(y0, y1):
            for x in range(max(0, int(cx - r)), min(size, int(cx + r) + 1)):
                dx, dy = x - cx, y - cy
                if dx * dx + dy * dy <= r2:
                    setp(x, y, color)

    # 배경: 위→아래 그라데이션
    for y in range(size):
        col = lerp(BRAND, BRAND_DARK, y / size)
        for x in range(size):
            i = (y * size + x) * 3
            px[i], px[i + 1], px[i + 2] = col

    scale = 0.64 if maskable else 0.74
    cx = size / 2.0

    # 머리
    head_r = size * 0.16 * (scale / 0.74)
    head_cy = size * (0.40 if not maskable else 0.42)
    disc(cx, head_cy, head_r, WHITE)

    # 몸통(어깨): 아래로 열린 반타원
    body_cy = size * (0.95 if not maskable else 0.92)
    body_rx = size * 0.27 * (scale / 0.74)
    body_ry = size * 0.34 * (scale / 0.74)
    for y in range(size):
        for x in range(size):
            dx = (x - cx) / body_rx
            dy = (y - body_cy) / body_ry
            if dx * dx + dy * dy <= 1.0 and y < body_cy and y > head_cy + head_r * 0.55:
                setp(x, y, WHITE)

    return bytes(px)


def write_png(path, size, rgb):
    def chunk(typ, data):
        c = typ + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    raw = bytearray()
    stride = size * 3
    for y in range(size):
        raw.append(0)
        raw.extend(rgb[y * stride:(y + 1) * stride])

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit RGB
    idat = zlib.compress(bytes(raw), 9)
    with open(path, "wb") as f:
        f.write(sig)
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", idat))
        f.write(chunk(b"IEND", b""))


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, "..", "icons")
    os.makedirs(out, exist_ok=True)
    write_png(os.path.join(out, "icon-192.png"), 192, make_icon(192))
    write_png(os.path.join(out, "icon-512.png"), 512, make_icon(512))
    write_png(os.path.join(out, "icon-maskable-512.png"), 512, make_icon(512, maskable=True))
    print("아이콘 생성 완료: icons/icon-192.png, icon-512.png, icon-maskable-512.png")


if __name__ == "__main__":
    main()
