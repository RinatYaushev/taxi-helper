// Категоризований звіт: дистанція / зона / година / оплата (аналог report.py)
import { loadData, breakeven, enrich } from "./lib.ts";import type { Row } from "./types.ts";

const data = loadData();
const s = data.settings;
const thr = s.threshold_net_per_km;
const rows = enrich(data);

const hourOf = (r: Row) => Number(r.datetime.split(" ")[1].split(":")[0]);

function block(name: string, sub: Row[]): void {
  if (!sub.length) return;
  const n = sub.length;
  const amt = sub.reduce((a, r) => a + r.amount, 0);
  const km = sub.reduce((a, r) => a + r.distance, 0);
  const net = sub.reduce((a, r) => a + r.net, 0);
  const npk = km ? net / km : 0;
  const bad = sub.filter((r) => r.netPerKm < thr).length;
  console.log(
    `${name.padEnd(22)} | n=${String(n).padStart(2)} | ` +
      `виручка=${String(Math.round(amt)).padStart(5)} | ` +
      `чист=${String(Math.round(net)).padStart(6)} | ` +
      `чист/км=${npk.toFixed(1).padStart(5)} | ` +
      `нижче порогу=${String(bad).padStart(2)} (${String(Math.round((bad / n) * 100)).padStart(3)}%)`,
  );
}

console.log(
  `Поріг «доброї» поїздки: ${thr} грн/км чистими | беззбитк.=${breakeven(s).toFixed(1)}`,
);
console.log("=".repeat(92));
console.log("ЗА ДИСТАНЦІЄЮ");
block("Коротка (<3 км)", rows.filter((r) => r.distance < 3));
block("Середня (3-7 км)", rows.filter((r) => r.distance >= 3 && r.distance < 7));
block("Довга (7-12 км)", rows.filter((r) => r.distance >= 7 && r.distance < 12));
block("Дуже довга (12+ км)", rows.filter((r) => r.distance >= 12));
console.log("-".repeat(92));
console.log("ЗА ЗОНОЮ ПРИЗНАЧЕННЯ");
block("Місто", rows.filter((r) => r.zone === "Місто" && !r.longHaul));
block("Глухий кут", rows.filter((r) => r.zone === "Глухий кут" && !r.longHaul));
block("Дальняк (міжміс.)", rows.filter((r) => r.longHaul));
console.log("-".repeat(92));
console.log("ЗА ГОДИНОЮ");
const buckets: [number, number, string][] = [
  [0, 17, "до 17:00"],
  [17, 19, "17-19 (пік)"],
  [19, 21, "19-21 (вечір)"],
  [21, 24, "після 21"],
];
for (const [lo, hi, nm] of buckets) {
  block(nm, rows.filter((r) => hourOf(r) >= lo && hourOf(r) < hi));
}
console.log("-".repeat(92));
console.log("ЗА ОПЛАТОЮ");
for (const p of ["Готівка", "Безготівка", "Комбінована"] as const) {
  block(p, rows.filter((r) => r.payment === p));
}
console.log("=".repeat(92));

const worst = [...rows].sort((a, b) => a.netPerKm - b.netPerKm).slice(0, 8);
console.log("НАЙГІРШІ 8 (кандидати відсікати):");
for (const r of worst) {
  console.log(
    `  ${r.datetime} ${String(r.amount).padStart(3)}грн ` +
      `${r.distance.toFixed(2).padStart(5)}км чист/км=${r.netPerKm.toFixed(1).padStart(4)}  ` +
      `${r.zone.padEnd(10)} ${r.from.slice(0, 22).padEnd(22)}→ ${r.to.slice(0, 22)}`,
  );
}




