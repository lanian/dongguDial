#!/usr/bin/env python3
"""광주광역시 동구 행정전화부 PWA 아이콘(PNG) 생성기.

브랜드 그라데이션 배경 + 흰색 "동구" 한글 워드마크.
한글 렌더링을 위해 Pillow + CJK 폰트(WenQuanYi Zen Hei 등)를 사용한다.

    pip install pillow
    python3 tools/make_icons.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

BRAND = (31, 111, 235)       # #1f6feb
BRAND_DARK = (22, 87, 192)
WHITE = (255, 255, 255)
TEXT = "동구"

# 한글 글리프를 포함한 폰트 후보 (있는 첫 번째 사용)
FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf",
    "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/unifont/unifont.otf",
]


def find_font():
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            return p
    raise SystemExit("한글 폰트를 찾을 수 없습니다. NanumGothic 등 CJK 폰트를 설치하세요.")


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def fit_font(draw, font_path, text, target_w, max_size):
    size = 10
    best = ImageFont.truetype(font_path, size)
    while size < max_size:
        f = ImageFont.truetype(font_path, size)
        bb = draw.textbbox((0, 0), text, font=f)
        if bb[2] - bb[0] > target_w:
            break
        best = f
        size += 4
    return best


def make_icon(size, font_path, maskable=False):
    img = Image.new("RGB", (size, size), BRAND)
    px = img.load()
    for y in range(size):
        col = lerp(BRAND, BRAND_DARK, y / size)
        for x in range(size):
            px[x, y] = col

    draw = ImageDraw.Draw(img)
    frac = 0.52 if maskable else 0.66      # maskable 은 안전영역(중앙 80%) 고려
    font = fit_font(draw, font_path, TEXT, size * frac, size)
    bb = draw.textbbox((0, 0), TEXT, font=font)
    w, h = bb[2] - bb[0], bb[3] - bb[1]
    x = (size - w) / 2 - bb[0]
    y = (size - h) / 2 - bb[1]
    draw.text((x, y), TEXT, font=font, fill=WHITE)
    return img


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, "..", "icons")
    os.makedirs(out, exist_ok=True)
    fp = find_font()
    make_icon(192, fp).save(os.path.join(out, "icon-192.png"))
    make_icon(512, fp).save(os.path.join(out, "icon-512.png"))
    make_icon(512, fp, maskable=True).save(os.path.join(out, "icon-maskable-512.png"))
    print("아이콘 생성 완료(동구 워드마크): icon-192 / icon-512 / icon-maskable-512")


if __name__ == "__main__":
    main()
