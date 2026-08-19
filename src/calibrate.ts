// Рекалібрування ядра з наявних поїздок.
//
// Використання:
//   node src/calibrate.ts            # показує підгонку тарифу + профіль даних (нічого не пише)
//   node src/calibrate.ts --write    # записує settings.uklon_fare {base, per_km}
//
// ЩО калібрується з даних (сума, дистанція, зона, дата):
//   • uklon_fare {base, per_km} — лінійна регресія amount ~ distance (OLS).
//     Саме він визначає max_km (перетин тарифу з афінним порогом), тож важливий.
// ЩО НЕ калібрується (немає часу поїздки / порожняку в скрінах):
//   • avg_speed_by_zone, empty_run_by_zone, target_net_per_hour, order_overhead_min
//     — лишаються обґрунтованими припущеннями. Профіль нижче — ОПИСОВИЙ (залежить
//     від цих припущень), тож не є їх валідацією, лише орієнтир.
import { loadData, saveData, compute } from "./lib.ts";
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
const trips = data.trips.filter((t) => t.amount > 0 && t.distance > 0);

// ── 1. Тариф Uklon: amount ~ distance ────────────────────────────────
const pts = trips.map((t) => ({ x: t.distance, y: t.amount }));
const fit = ols(pts);
const cur = data.settings.uklon_fare ?? { base: 81, per_km: 16.4 };

console.log(`\n=== Тариф Uklon (amount ~ distance), n=${fit.n} ===`);
console.log(`  поточний:  base=${cur.base}   per_km=${cur.per_km}`);
console.log(`  підгонка:  base=${fit.a}   per_km=${fit.b}   R²=${fit.r2}`);

// Для контексту — окремо місто vs глухий кут (чи тариф залежить від зони; не має сильно).
for (const z of ["Місто", "Глухий кут"] as Zone[]) {
  const zp = trips.filter((t) => t.zone === z).map((t) => ({ x: t.distance, y: t.amount }));
  if (zp.length >= 5) { const f = ols(zp); console.log(`    ${z}: base=${f.a} per_km=${f.b} R²=${f.r2} (n=${f.n})`); }
}

// ── 2. Описовий профіль (залежить від припущень!) ────────────────────
function profile(label: string, rows: Trip[]): void {
  if (!rows.length) return;
  const c = rows.map((t) => compute(t, data.settings));
  const km = rows.reduce((a, t) => a + t.distance, 0);
  const net = c.reduce((a, x) => a + x.net, 0);
  const npk = km ? net / km : 0;
  const nph = c.reduce((a, x) => a + x.netPerHour, 0) / c.length;
  console.log(`  ${label.padEnd(22)} n=${String(rows.length).padStart(3)}  ₴/км=${round(npk, 1).toString().padStart(5)}  ₴/год=${String(Math.round(nph)).padStart(4)}`);
}

console.log(`\n=== Профіль даних (ОПИСОВИЙ, залежить від швидкості/порожняку) ===`);
profile("Усі", trips);
profile("Місто", trips.filter((t) => t.zone === "Місто"));
profile("Глухий кут", trips.filter((t) => t.zone === "Глухий кут"));
const bucket = (t: Trip): string => t.distance < 3 ? "<3 км" : t.distance < 7 ? "3–7 км" : t.distance < 12 ? "7–12 км" : "12+ км";
for (const b of ["<3 км", "3–7 км", "7–12 км", "12+ км"]) profile(b, trips.filter((t) => bucket(t) === b));

// ── 3. Запис ─────────────────────────────────────────────────────────
if (write) {
  if (fit.n < 30) { console.log(`\n⚠️ Замало точок (${fit.n}) для надійної підгонки — не записую.`); }
  else {
    data.settings.uklon_fare = { base: fit.a, per_km: fit.b };
    saveData(data);
    console.log(`\n✅ Записано uklon_fare = { base: ${fit.a}, per_km: ${fit.b} } у data.json.`);
  }
} else {
  console.log(`\ndry-run. Додай --write, щоб записати uklon_fare у settings.`);
}

