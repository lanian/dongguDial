#!/usr/bin/env python3
"""광주광역시 동구 행정전화부 PWA 아이콘(PNG) 생성기.

광주광역시 동구 공식 심볼마크(빨강 태양 + 파랑 까치 'G' + 초록 잎)를
흰색 배경 위에 합성한다. 원본 마크는 tools/assets/donggu-symbol.png
(공식 CI에서 추출·정리한 투명 PNG).

    pip install pillow
    python3 tools/make_icons.py
"""
import os
from PIL import Image

WHITE = (255, 255, 255, 255)


def make_icon(size, mark, frac):
    canvas = Image.new("RGBA", (size, size), WHITE)
    target = int(size * frac)
    w, h = mark.size
    scale = target / max(w, h)
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    m = mark.resize((nw, nh), Image.LANCZOS)
    canvas.alpha_composite(m, ((size - nw) // 2, (size - nh) // 2))
    return canvas.convert("RGB")


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, "..", "icons")
    os.makedirs(out, exist_ok=True)
    mark = Image.open(os.path.join(here, "assets", "donggu-symbol.png")).convert("RGBA")
    # any: 큰 마크, maskable: 안전영역(중앙 80%) 고려해 작게
    make_icon(192, mark, 0.72).save(os.path.join(out, "icon-192.png"))
    make_icon(512, mark, 0.72).save(os.path.join(out, "icon-512.png"))
    make_icon(512, mark, 0.58).save(os.path.join(out, "icon-maskable-512.png"))
    print("아이콘 생성 완료(동구 공식 심볼마크): icon-192 / icon-512 / icon-maskable-512")


if __name__ == "__main__":
    main()
