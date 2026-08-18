#!/usr/bin/env python3
"""Визначення типу оплати за кольором іконки біля суми (₴)."""
import os
import colorsys
from collections import defaultdict
from PIL import Image

DIR = os.path.expanduser("~/Desktop/screens")
BOXES = "/tmp/boxes.tsv"


def color_of(r, g, b):
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    if s < 0.5 or v < 0.4:
        return None
    hd = h * 360
    if 38 <= hd <= 62:
        return "Готівка"
    if 90 <= hd <= 165:
        return "Комбінована"
    if 190 <= hd <= 255:
        return "Безготівка"
    return None


# рядок ціни для кожного файлу
price = {}
for ln in open(BOXES, encoding="utf-8"):
    p = ln.rstrip("\n").split("\t")
    if len(p) == 6 and "₴" in p[1] and p[0] not in price:
        price[p[0]] = tuple(map(float, p[2:6]))  # x,y,w,h (Vision, origin bottom-left)


def detect(fname):
    im = Image.open(os.path.join(DIR, fname)).convert("RGB")
    W, H = im.size
    px = im.load()
    x, y, w, h = price[fname]
    # піксельні межі рядка ціни
    px0 = int(x * W)
    ytop = int((1 - (y + h)) * H)
    ybot = int((1 - y) * H)
    band_t = max(0, ytop - 12)
    band_b = min(H, ybot + 12)
    # регіон іконки: ліворуч від суми
    ix0 = max(0, px0 - int(0.11 * W))
    ix1 = px0 - 3
    cnt = defaultdict(int)
    for yy in range(band_t, band_b):
        for xx in range(ix0, ix1):
            c = color_of(*px[xx, yy])
            if c:
                cnt[c] += 1
    if not cnt:
        return "?", dict(cnt)
    return max(cnt, key=cnt.get), dict(cnt)


files = sorted(price)
green_ref = {"Screenshot 2026-08-18 at 12.43.06.png",
             "Screenshot 2026-08-18 at 12.44.15.png",
             "Screenshot 2026-08-18 at 12.45.15.png"}
for f in files:
    res, cnt = detect(f)
    mark = " <== має бути Комбінована" if f in green_ref else ""
    print(f"{f[-12:]}  ->  {res:12} {cnt}{mark}")

