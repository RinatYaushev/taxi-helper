// Швидкий per-trip аналіз у консоль
import { loadData, fuelPerKm, breakevenZone, compute } from "./lib.ts";
import { fmtShort } from "./time.ts";

const data = loadData();
const s = data.settings;
const fpk = fuelPerKm(s);

const pad = (v: string | number, n: number) => String(v).padStart(n);

// Беззбитковість по зонах: усередненого числа більше немає — порожняк у місті
// (0.3) і в тупику (1.0) відрізняється втричі.
console.log(
  `Паливо/км: ${fpk.toFixed(2)} грн/км | з порожняком: місто ` +
    `${breakevenZone(s, "Місто").toFixed(2)} · тупик ${breakevenZone(s, "Глухий кут").toFixed(2)} грн/км`,
);
console.log("-".repeat(64));

for (const t of data.trips) {
  const c = compute(t, s);
  console.log(
    `${fmtShort(t.datetime, s)}  ${pad(t.amount, 3)}грн ${pad(t.distance.toFixed(2), 5)}км  ` +
      `грн/км=${pad(c.grossPerKm.toFixed(1), 5)}  ` +
      `чист/км=${pad(c.netPerKm.toFixed(1), 5)}  ` +
      `₴/год=${pad(Math.round(c.netPerHour), 4)}  ${t.zone}`,
  );
}

const amt = data.trips.reduce((a, t) => a + t.amount, 0);
const km = data.trips.reduce((a, t) => a + t.distance, 0);
const gas = data.trips.reduce((a, t) => a + compute(t, s).gas, 0);
console.log("-".repeat(64));
console.log(
  `Разом: ${amt} грн, ${km.toFixed(1)} км, газ ${gas.toFixed(0)} грн ` +
    `(${((gas / amt) * 100).toFixed(0)}% виручки) | вал.грн/км=${(amt / km).toFixed(1)}`,
);

