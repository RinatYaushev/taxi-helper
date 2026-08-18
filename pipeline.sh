#!/usr/bin/env bash
# Повний конвеєр обробки скріншотів замовлень Uklon.
#
# Кроки:
#   1) OCR тексту (адреси, сума, км, дата/час)
#   2) OCR координат рядків (для прив'язки іконки оплати)
#   3) авто-визначення типу оплати за кольором іконки -> data.json
#   4) генерація HTML-звіту
#   5) текстовий аналіз у консоль
#
# Використання:
#   ./pipeline.sh [шлях_до_папки_зі_скрінами]
# За замовчуванням: ~/Desktop/screens
#
# УВАГА: OCR і updatePay лише ОНОВЛЮЮТЬ payment для вже наявних поїздок
# за збігом дати/часу. Нові поїздки в data.json додаються вручну — див. README.

set -euo pipefail
cd "$(dirname "$0")"

SCREENS="${1:-$HOME/Desktop/screens}"

if [ ! -d "$SCREENS" ]; then
  echo "❌ Папки зі скрінами немає: $SCREENS"
  exit 1
fi

echo "▶ 1/5 OCR тексту…"
swift ocr.swift "$SCREENS" > /tmp/ocr.txt

echo "▶ 2/5 OCR координат…"
swift ocr_boxes.swift "$SCREENS" > /tmp/boxes.tsv

echo "▶ 3/5 Визначення типу оплати за кольором іконки…"
node src/updatePay.ts "$SCREENS"

echo "▶ 4/5 Генерація HTML-звіту…"
node src/generate.ts

echo "▶ 5/5 Аналіз:"
node src/report.ts

