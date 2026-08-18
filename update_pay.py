#!/usr/bin/env python3
"""Оновлює payment у data.json за кольором іконки на скрінах (зіставлення по даті/часу)."""
import os
import re
import json
import colorsys
from collections import defaultdict
from PIL import Image

DIR = os.path.expanduser("~/Desktop/screens")
BOXES = "/tmp/boxes.tsv"
OCR = "/tmp/ocr.txt"

# 1) рядок ціни (координати) для кожного файлу
price = {}
for ln in open(BOXES, encoding="utf-8"):
    p = ln.rstrip("\n").split("\t")
    if len(p) == 6 and "₴" in p[1] and p[0] not in price:
        price[p[0]] = tuple(map(float, p[2:6]))

# 2) дата/час для кожного файлу з OCR-тексту
dt_of = {}
cur = None
rx = re.compile(r"(\d{1,2})\s*серп\.?\s*(\d{1,2}:\d{2})")
for ln in open(OCR, encoding="utf-8"):
    m = re.match(r"===== (.+?) =====", ln)
    if m:
        cur = m.group(1)
        continue
    if cur and cur not in dt_of:
        mm = rx.search(ln)
        if mm:
            dt_of[cur] = f"{mm.group(1)}.08 {mm.group(2)}"


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


def detect(fname):
    im = Image.open(os.path.join(DIR, fname)).convert("RGB")
    W, H = im.size
    px = im.load()
    x, y, w, h = price[fname]
    px0 = int(x * W)
    ytop = int((1 - (y + h)) * H)
    ybot = int((1 - y) * H)
    cnt = defaultdict(int)
    for yy in range(max(0, ytop - 12), min(H, ybot + 12)):
        for xx in range(max(0, px0 - int(0.11 * W)), px0 - 3):
            c = color_of(*px[xx, yy])
            if c:
                cnt[c] += 1
    return max(cnt, key=cnt.get) if cnt else None


# 3) datetime -> payment
pay_by_dt = {}
for f in price:
    if f in dt_of:
        pay_by_dt[dt_of[f]] = detect(f)

# 4) оновлюємо data.json
data = json.load(open("data.json", encoding="utf-8"))
changed = 0
for t in data["trips"]:
    new = pay_by_dt.get(t["datetime"])
    if new and new != t["payment"]:
        print(f"  {t['datetime']}: {t['payment']:12} -> {new}")
        t["payment"] = new
        changed += 1

if changed:
    with open("data.json", "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
from collections import Counter
print(f"\nЗмінено: {changed}")
print("Розподіл:", dict(Counter(t["payment"] for t in data["trips"])))

