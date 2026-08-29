// Категоризований звіт: дистанція / зона / година / оплата
import { loadData, breakevenZone, enrich, baseTargetPh } from "./lib.ts";
import type { Row } from "./types.ts";
import { fmtShort, hourOf as hourOfDt } from "./time.ts";

const data = loadData();
const s = data.settings;
const target = baseTargetPh(s);
const rows = enrich(data);

const hourOf = (r: Row): number => hourOfDt(r.datetime, s);

function block(name: string, sub: Row[]): void {
  if (!sub.length) return;
  const n = sub.length;
  const amt = sub.reduce((a, r) => a + r.amount, 0);
  const km = sub.reduce((a, r) => a + r.distance, 0);
  const net = sub.reduce((a, r) => a + r.net, 0);
  const npk = km ? net / km : 0;
  const mins = sub.reduce((a, r) => a + r.timeMin, 0);
  const nph = mins ? net / (mins / 60) : 0;
  // «Погані» — за ЄДИНОЮ шкалою ₴/год (rec), а не за ₴/км: інакше консоль
  // суперечила б звіту й слотам, як це вже було.
  const bad = sub.filter((r) => r.rec !== "бери").length;
  console.log(
    `${name.padEnd(22)} | n=${String(n).padStart(2)} | ` +
      `виручка=${String(Math.round(amt)).padStart(5)} | ` +
      `чист=${String(Math.round(net)).padStart(6)} | ` +
      `чист/км=${npk.toFixed(1).padStart(5)} | ` +
      `₴/год=${String(Math.round(nph)).padStart(4)} | ` +
      `нижче цілі=${String(bad).padStart(2)} (${String(Math.round((bad / n) * 100)).padStart(3)}%)`,
  );
}

console.log(
  `Ціль: ${Math.round(target)} ₴/год чистими | беззбитк. палива: місто ` +
    `${breakevenZone(s, "Місто").toFixed(1)} · тупик ${breakevenZone(s, "Глухий кут").toFixed(1)} грн/км`,
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

const worst = [...rows].sort((a, b) => a.netPerHour - b.netPerHour).slice(0, 8);
console.log("НАЙГІРШІ 8 за ₴/год (кандидати відсікати):");
for (const r of worst) {
  console.log(
    `  ${fmtShort(r.datetime, s)} ${String(r.amount).padStart(3)}грн ` +
      `${r.distance.toFixed(2).padStart(5)}км ₴/год=${String(Math.round(r.netPerHour)).padStart(4)}  ` +
      `${r.zone.padEnd(10)} ${r.from.slice(0, 22).padEnd(22)}→ ${r.to.slice(0, 22)}`,
  );
}




