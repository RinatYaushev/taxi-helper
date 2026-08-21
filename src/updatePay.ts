// Оновлює payment у data.json за кольором іконки на скрінах (аналог update_pay.py)
//
// Зіставлення скрін↔поїздка — за «відбитком» (сума + дистанція), а НЕ за датою:
// сьогоднішні замовлення застосунок показує без дати (лише час), тому старий
// матчинг за "DD серп. HH:MM" їх не бачив. Пара сума+км практично унікальна
// (163/164 на поточній базі); рідкісні колізії розрізняємо часом HH:MM, який
// на екрані є завжди (шукаємо біля мітки "Архівне", щоб не сплутати з
// годинником у статус-барі).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadData, saveData } from "./lib.ts";
import { detect, type Box } from "./detectPay.ts";
import type { Payment } from "./types.ts";

const DIR = process.argv[2] ?? join(homedir(), "Desktop", "screens");
const BOXES = "/tmp/boxes.tsv";
const OCR = "/tmp/ocr.txt";

/** Правдоподібна сума: 40–1200 грн; інакше зрізаємо шум іконки зліва (9111→111). */
function normFare(n: number): number | null {
  if (n >= 40 && n <= 1200) return n;
  const s = String(n);
  for (let cut = 1; cut < s.length; cut++) {
    const v = Number(s.slice(cut));
    if (v >= 40 && v <= 1200) return v;
  }
  return null;
}

interface Fingerprint {
  amounts: number[]; // кандидати суми (верхнє число та/або сума з розбивки)
  dist: number | null;
  times: string[]; // усі "HH:MM" зі скріна (крім годинника статус-бара)
}

/** Витягнути відбиток замовлення з OCR-рядків одного скріна. */
function fingerprintOf(L: string[]): Fingerprint {
  let dist: number | null = null;
  let kmIdx = -1;
  for (let i = 0; i < L.length; i++) {
    const m = L[i].match(/(\d+)[.,](\d+)\s*км/i);
    if (m) { dist = parseFloat(`${m[1]}.${m[2]}`); kmIdx = i; break; }
  }
  const amounts: number[] = [];
  if (kmIdx >= 0) {
    for (let i = kmIdx; i >= 0 && i >= kmIdx - 4; i--) {
      const m = L[i].match(/(\d{2,5})\s*₴/);
      if (m) { const v = normFare(+m[1]); if (v != null) amounts.push(v); break; }
    }
  }
  // сума з розбивки оплати ("84 ₴ готівкою, 28 ₴ на баланс")
  for (const ln of L) {
    if (/Рух коштів|Транзакці/i.test(ln)) continue;
    if (!/готівк|на баланс|безготів/i.test(ln)) continue;
    const nums = [...ln.matchAll(/(\d{2,4})\s*₴/g)].map((mm) => +mm[1]);
    if (!nums.length || nums.length > 3) continue;
    const sum = nums.reduce((a, b) => a + b, 0);
    if (sum >= 40 && sum <= 2000 && !amounts.includes(sum)) amounts.push(sum);
    break;
  }
  // Часи зі скріна для розрізнення колізій. Перші рядки пропускаємо — там
  // годинник статус-бара телефону (він не має стосунку до часу замовлення).
  const times: string[] = [];
  for (let i = 3; i < L.length; i++) {
    for (const m of L[i].matchAll(/(?:^|[\s.])(\d{1,2}):(\d{2})(?:\s|$)/g)) {
      const t = `${m[1].padStart(2, "0")}:${m[2]}`;
      if (!times.includes(t)) times.push(t);
    }
  }
  return { amounts, dist, times };
}

// 1) рядок ціни (координати) для кожного файлу
const price = new Map<string, Box>();
for (const ln of readFileSync(BOXES, "utf8").split("\n")) {
  const p = ln.split("\t");
  if (p.length === 6 && p[1].includes("₴") && !price.has(p[0])) {
    price.set(p[0], { x: +p[2], y: +p[3], w: +p[4], h: +p[5] });
  }
}

// 2) відбиток замовлення для кожного файлу
const fpOf = new Map<string, Fingerprint>();
{
  let cur: string | null = null;
  let lines: string[] = [];
  const flush = (): void => { if (cur) fpOf.set(cur, fingerprintOf(lines)); };
  for (const ln of readFileSync(OCR, "utf8").split("\n")) {
    const m = ln.match(/^===== (.+?) =====/);
    if (m) { flush(); cur = m[1]; lines = []; } else if (cur) lines.push(ln);
  }
  flush();
}

// 3) зіставлення з поїздками за відбитком (сума+км, час — тайбрейкер)
const data = loadData();
const key = (amount: number, dist: number): string => `${amount}|${dist.toFixed(2)}`;
const byKey = new Map<string, typeof data.trips>();
for (const t of data.trips) {
  const k = key(t.amount, t.distance);
  const arr = byKey.get(k) ?? [];
  arr.push(t);
  byKey.set(k, arr);
}

let changed = 0;
let matched = 0;
const unmatched: string[] = [];
for (const [file, box] of price) {
  const fp = fpOf.get(file);
  if (!fp || fp.dist == null || !fp.amounts.length) { unmatched.push(file); continue; }
  let cands: typeof data.trips = [];
  for (const a of fp.amounts) {
    const hit = byKey.get(key(a, fp.dist));
    if (hit) cands = cands.concat(hit);
  }
  if (!cands.length) { unmatched.push(file); continue; }
  if (cands.length > 1 && fp.times.length) {
    const exact = cands.filter((t) => fp.times.some((tm) => t.datetime.endsWith(tm)));
    if (exact.length) cands = exact;
  }
  if (cands.length !== 1) { unmatched.push(`${file} (неоднозначно: ${cands.length})`); continue; }
  const trip = cands[0];
  matched++;
  const nu: Payment | null = await detect(join(DIR, file), box);
  if (nu && nu !== trip.payment) {
    console.log(`  ${trip.datetime} ${trip.amount}₴/${trip.distance}км: ${trip.payment.padEnd(12)} -> ${nu}`);
    trip.payment = nu;
    changed++;
  }
}
if (changed) saveData(data);

console.log(`\nСкрінів із ціною: ${price.size} | зіставлено: ${matched} | не зіставлено: ${unmatched.length}`);
for (const u of unmatched) console.log(`  ⚠️ ${u}`);
console.log(`Змінено: ${changed}`);
const dist: Record<string, number> = {};
for (const t of data.trips) dist[t.payment] = (dist[t.payment] ?? 0) + 1;
console.log("Розподіл:", dist);

