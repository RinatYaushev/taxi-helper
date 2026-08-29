// Рекалібрування ядра з наявних поїздок.
//
// Використання:
//   node src/calibrate.ts            # показує підгонку + профіль даних (нічого не пише)
//   node src/calibrate.ts --write    # записує settings.uklon_fare і cycle_model
//
// ЩО калібрується з даних (сума, дистанція, зона, дата/час):
//   • uklon_fare {base, per_km} — лінійна регресія amount ~ distance (OLS), довідкова.
//   • cycle_model {base_min, per_km_min} — регресія ІНТЕРВАЛУ між стартами
//     сусідніх замовлень на дистанцію. Це реальна «вартість часу» замовлення:
//     вона вже включає подачу, чекання, передачу й репозиціонування.
// ЩО НЕ калібрується:
//   • empty_run_by_zone (впливає лише на пальне), target_net_per_hour — це вибір
//     політики, а не вимірювання (хоч орієнтир — фактичні ₴/год нижче).
//
// ⚠️ Межа інтервалу тепер одна — `settings.shift_gap_min` (кінець зміни), а не
// окремий GAP_MAX=60. Стара відсічка викидала довгі паузи ВСЕРЕДИНІ зміни, тож
// модель систематично недооцінювала вартість часу: 276 ₴/год «за моделлю» проти
// 249 фактичних. Тепер обидві ставки друкуються поруч.
import { loadData, saveData, compute, shiftStats } from "./lib.ts";
import { gapsWithinShifts, shiftGapMin } from "./time.ts";
import type { Trip, Zone } from "./types.ts";

const round = (n: number, d = 2): number => { const p = 10 ** d; return Math.round(n * p) / p; };

/** Проста лінійна регресія y = a + b·x методом найменших квадратів. */
function ols(pts: Array<{ x: number; y: number }>): { a: number; b: number; r2: number; n: number } {
  const n = pts.length;
  if (n < 2) return { a: 0, b: 0, r2: 0, n };
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const p of pts) { sx += p.x; sy += p.y; sxy += p.x * p.y; sxx += p.x * p.x; }
  const denom = n * sxx - sx * sx;
  const b = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const a = (sy - b * sx) / n;
  const my = sy / n;
  let ssr = 0, sst = 0;
  for (const p of pts) { const yhat = a + b * p.x; ssr += (p.y - yhat) ** 2; sst += (p.y - my) ** 2; }
  const r2 = sst === 0 ? 0 : 1 - ssr / sst;
  return { a: round(a, 2), b: round(b, 2), r2: round(r2, 3), n };
}

const args = process.argv.slice(2);
const write = args.includes("--write");

const data = loadData();
const s = data.settings;
const trips = data.trips.filter((t) => t.amount > 0 && t.distance > 0);

// ── 1. Тариф Uklon: amount ~ distance ────────────────────────────────
const fit = ols(trips.map((t) => ({ x: t.distance, y: t.amount })));
const cur = s.uklon_fare ?? { base: 81, per_km: 16.4 };

console.log(`\n=== Тариф Uklon (amount ~ distance), n=${fit.n} ===`);
console.log(`  поточний:  base=${cur.base}   per_km=${cur.per_km}`);
console.log(`  підгонка:  base=${fit.a}   per_km=${fit.b}   R²=${fit.r2}`);
for (const z of ["Місто", "Глухий кут"] as Zone[]) {
  const zp = trips.filter((t) => t.zone === z).map((t) => ({ x: t.distance, y: t.amount }));
  if (zp.length >= 5) { const f = ols(zp); console.log(`    ${z}: base=${f.a} per_km=${f.b} R²=${f.r2} (n=${f.n})`); }
}

// ── 2. Модель циклу: інтервал між стартами всередині ЗМІНИ ───────────
const gaps = gapsWithinShifts(trips, (t) => t.datetime, s)
  .filter((g) => g.gapMin > 2)
  .map((g) => ({ x: g.from.distance, y: g.gapMin, zone: g.from.zone }));
const cyc = ols(gaps);
const curCyc = s.cycle_model;
console.log(`\n=== Модель циклу (інтервал між замовленнями ~ дистанція), n=${cyc.n} ===`);
console.log(`  зміна = розрив понад ${shiftGapMin(s)} хв (нічна зміна не ріжеться опівночі)`);
if (curCyc) console.log(`  поточна:   ${curCyc.base_min} + ${curCyc.per_km_min}×км`);
console.log(`  підгонка:  ${cyc.a} + ${cyc.b}×км   R²=${cyc.r2}   (темп ${round(60 / (cyc.b || 1), 1)} км/год)`);
const zoneCyc: Partial<Record<Zone, { base_min: number; per_km_min: number }>> = {};
for (const z of ["Місто", "Глухий кут"] as Zone[]) {
  const zp = gaps.filter((g) => g.zone === z);
  if (zp.length >= 15) {
    const f = ols(zp);
    zoneCyc[z] = { base_min: f.a, per_km_min: f.b };
    console.log(`    ${z}: ${f.a} + ${f.b}×км (R²=${f.r2}, n=${f.n})`);
  }
}

// ── 3. Дві ставки — орієнтир для target_net_per_hour ─────────────────
{
  const rows = trips.map((t) => ({ ...t, ...compute(t, s) }));
  const sh = shiftStats(rows, s);
  console.log(`\n=== Ставка (${sh.count} змін) ===`);
  console.log(`  за моделлю циклів:      ${Math.round(sh.modelPh)} ₴/год (${round(sh.modelH, 1)} год)`);
  console.log(`  за тривалістю зміни:    ${Math.round(sh.realPh)} ₴/год (${round(sh.realH, 1)} год, з них ${round(sh.idleH, 1)} пауз)`);
  console.log(`  утилізація:             ${Math.round(sh.utilization * 100)}%`);
  console.log(`  поточна ціль:           ${s.target_net_per_hour ?? 200} ₴/год (у шкалі МОДЕЛІ)`);
}

// ── 4. Описовий профіль ──────────────────────────────────────────────
function profile(label: string, rows: Trip[]): void {
  if (!rows.length) return;
  const c = rows.map((t) => compute(t, s));
  const km = rows.reduce((a, t) => a + t.distance, 0);
  const net = c.reduce((a, x) => a + x.net, 0);
  const mins = c.reduce((a, x) => a + x.timeMin, 0);
  console.log(
    `  ${label.padEnd(22)} n=${String(rows.length).padStart(3)}  ` +
      `₴/км=${round(km ? net / km : 0, 1).toString().padStart(5)}  ` +
      `₴/год=${String(Math.round(mins ? net / (mins / 60) : 0)).padStart(4)}`,
  );
}

console.log(`\n=== Профіль даних (₴/год — за виміряним циклом) ===`);
profile("Усі", trips);
profile("Місто", trips.filter((t) => t.zone === "Місто"));
profile("Глухий кут", trips.filter((t) => t.zone === "Глухий кут"));
const bucket = (t: Trip): string => t.distance < 3 ? "<3 км" : t.distance < 7 ? "3–7 км" : t.distance < 12 ? "7–12 км" : "12+ км";
for (const b of ["<3 км", "3–7 км", "7–12 км", "12+ км"]) profile(b, trips.filter((t) => bucket(t) === b));

// ── 5. Запис ─────────────────────────────────────────────────────────
if (write) {
  if (fit.n < 30) {
    console.log(`\n⚠️ Замало точок (${fit.n}) для надійної підгонки — не записую.`);
  } else {
    s.uklon_fare = { base: fit.a, per_km: fit.b };
    if (cyc.n >= 30) {
      s.cycle_model = {
        base_min: cyc.a,
        per_km_min: cyc.b,
        ...(Object.keys(zoneCyc).length ? { by_zone: zoneCyc } : {}),
      };
      console.log(`\n✅ cycle_model = ${cyc.a} + ${cyc.b}×км${Object.keys(zoneCyc).length ? " (+ за зонами)" : ""}`);
    }
    saveData(data);
    console.log(`✅ uklon_fare = { base: ${fit.a}, per_km: ${fit.b} } → data.json (бекап у data.json.bak).`);
  }
} else {
  console.log(`\ndry-run. Додай --write, щоб записати uklon_fare і cycle_model у settings.`);
}


