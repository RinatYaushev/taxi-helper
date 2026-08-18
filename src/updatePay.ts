// Оновлює payment у data.json за кольором іконки на скрінах (аналог update_pay.py)
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadData, saveData } from "./lib.ts";
import { detect, type Box } from "./detectPay.ts";
import type { Payment } from "./types.ts";

const DIR = process.argv[2] ?? join(homedir(), "Desktop", "screens");
const BOXES = "/tmp/boxes.tsv";
const OCR = "/tmp/ocr.txt";

// 1) рядок ціни (координати) для кожного файлу
const price = new Map<string, Box>();
for (const ln of readFileSync(BOXES, "utf8").split("\n")) {
  const p = ln.split("\t");
  if (p.length === 6 && p[1].includes("₴") && !price.has(p[0])) {
    price.set(p[0], { x: +p[2], y: +p[3], w: +p[4], h: +p[5] });
  }
}

// 2) дата/час для кожного файлу з OCR-тексту
const dtOf = new Map<string, string>();
const rx = /(\d{1,2})\s*серп\.?\s*(\d{1,2}:\d{2})/;
let cur: string | null = null;
for (const ln of readFileSync(OCR, "utf8").split("\n")) {
  const m = ln.match(/^===== (.+?) =====/);
  if (m) {
    cur = m[1];
    continue;
  }
  if (cur && !dtOf.has(cur)) {
    const mm = ln.match(rx);
    if (mm) dtOf.set(cur, `${mm[1]}.08 ${mm[2]}`);
  }
}

// 3) datetime -> payment
const payByDt = new Map<string, Payment | null>();
for (const [file, box] of price) {
  const dt = dtOf.get(file);
  if (dt) payByDt.set(dt, await detect(join(DIR, file), box));
}

// 4) оновлюємо data.json
const data = loadData();
let changed = 0;
for (const t of data.trips) {
  const nu = payByDt.get(t.datetime);
  if (nu && nu !== t.payment) {
    console.log(`  ${t.datetime}: ${t.payment.padEnd(12)} -> ${nu}`);
    t.payment = nu;
    changed++;
  }
}
if (changed) saveData(data);

const dist: Record<string, number> = {};
for (const t of data.trips) dist[t.payment] = (dist[t.payment] ?? 0) + 1;
console.log(`\nЗмінено: ${changed}`);
console.log("Розподіл:", dist);

