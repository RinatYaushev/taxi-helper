// Спільні формули та завантаження даних
import { readFileSync, writeFileSync } from "node:fs";
import type { Data, Settings, Trip, Computed, Row, Mode } from "./types.ts";

export function loadData(path = "data.json"): Data {
  return JSON.parse(readFileSync(path, "utf8")) as Data;
}

export function saveData(data: Data, path = "data.json"): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/** Собівартість палива, грн/км */
export function fuelPerKm(s: Settings): number {
  return (s.gas_consumption_l_100km / 100) * s.gas_price_per_l;
}

/** Беззбитковість з урахуванням порожнього пробігу, грн/км */
export function breakeven(s: Settings): number {
  return fuelPerKm(s) * (1 + s.empty_run_coef);
}

/** Мін. валова ціна (золоте правило), грн/км */
export function minGrossPerKm(s: Settings): number {
  const cashRate = s.commission_uklon_pct / 100;
  return (s.threshold_net_per_km + breakeven(s)) / (1 - cashRate);
}

/**
 * Порахувати пороги ₴/км для кожного режиму з «золотого правила».
 * Так значення фільтрів **перераховуються** щоразу зі свіжих settings
 * (ціна газу, комісія, поріг), а не лишаються захардкодженими.
 */
export function deriveModes(s: Settings): import("./types.ts").Mode[] {
  const g = minGrossPerKm(s);
  return s.modes.map((m) => ({
    ...m,
    min_price_km_city: Math.round(g * m.price_km_mult),
    min_price_km_suburb:
      m.price_km_suburb_mult != null
        ? Math.round(g * m.price_km_suburb_mult)
        : undefined,
  }));
}

/** Локалітети призначення — текст у дужках, де за конвенцією стоїть село/місто
 *  (напр. "Зарічна (Стрижавка), 2" → "Стрижавка"). Вулиця/заклад поза дужками
 *  ігноруються, тож "Бар Бюро (Оводова, 62а)" НЕ вважається містом Бар. */
function localities(addr: string): string {
  const out: string[] = [];
  const re = /\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(addr)) !== null) out.push(m[1]);
  return out.join(" ; ").toLowerCase();
}

/** Чи згадується в локалітеті адреси якийсь із районів списку (ціле слово). */
export function inArea(text: string, areas: string[]): boolean {
  const scope = localities(text);
  if (!scope) return false;
  const isLetter = (ch: string): boolean => /[a-zа-яіїєґ]/.test(ch);
  return areas.some((a) => {
    const n = a.toLowerCase();
    let from = 0;
    let idx: number;
    while ((idx = scope.indexOf(n, from)) !== -1) {
      const before = idx > 0 ? scope[idx - 1] : "";
      const after = idx + n.length < scope.length ? scope[idx + n.length] : "";
      if (!isLetter(before) && !isLetter(after)) return true;
      from = idx + 1;
    }
    return false;
  });
}

/** Порахувати газ, комісію, чистий, грн/км і рекомендацію для однієї поїздки */
export function compute(t: Trip, s: Settings): Computed {
  const amount = Number(t.amount);
  const dist = Number(t.distance);
  const fpk = fuelPerKm(s);
  const gas = dist * (1 + s.empty_run_coef) * fpk;
  let commission = (amount * s.commission_uklon_pct) / 100;
  if (t.payment === "Безготівка") {
    commission += (amount * s.commission_cashless_pct) / 100;
  }
  const net = amount - commission - gas;
  const grossPerKm = dist ? amount / dist : 0;
  const netPerKm = dist ? net / dist : 0;
  const rating: "OK" | "погана" =
    netPerKm >= s.threshold_net_per_km ? "OK" : "погана";
  const marginal = s.marginal_net_per_km ?? 10;
  const rec =
    netPerKm >= s.threshold_net_per_km
      ? "бери"
      : netPerKm >= marginal
        ? "думай"
        : "пропускай";
  // Дальняк визначаємо за призначенням (to); список — settings.long_haul_areas.
  const longHaul = inArea(t.to, s.long_haul_areas ?? []);
  return { gas, commission, net, grossPerKm, netPerKm, rating, rec, longHaul };
}

export function enrich(data: Data): Row[] {
  return data.trips.map((t) => ({ ...t, ...compute(t, data.settings) }));
}


export interface GroupStat {
  n: number;
  amount: number;
  km: number;
  net: number;
  netPerKm: number;
  badPct: number;
}

/** Зведена статистика для групи поїздок */
export function groupStats(rows: Row[], threshold: number): GroupStat {
  const n = rows.length;
  const amount = rows.reduce((a, r) => a + r.amount, 0);
  const km = rows.reduce((a, r) => a + r.distance, 0);
  const net = rows.reduce((a, r) => a + r.net, 0);
  const bad = rows.filter((r) => r.netPerKm < threshold).length;
  return {
    n,
    amount,
    km,
    net,
    netPerKm: km ? net / km : 0,
    badPct: n ? (bad / n) * 100 : 0,
  };
}

/** Чист/км для набору рядків */
export function npkOf(rs: Row[]): number {
  const km = rs.reduce((a, r) => a + r.distance, 0);
  return km ? rs.reduce((a, r) => a + r.net, 0) / km : 0;
}

/**
 * Предикат «пройде замовлення крізь режим?». Подача перевіряється лише коли
 * вона відома (pickup_km); суму, дистанцію, зону й ₴/км (grossPerKm) — завжди.
 * `m` має бути похідним режимом із deriveModes() (пороги вже пораховані).
 */
export function modePass(r: Row, m: Mode): boolean {
  if (r.longHaul) return false; // дальняк (міжміський) — окрема логіка, Автопілот off
  if (r.amount < m.min_order) return false;
  if (m.max_km && r.distance > m.max_km) return false;
  if (r.pickup_km != null && r.pickup_km > m.max_pickup_km) return false;
  if (r.zone === "Місто") return r.grossPerKm >= (m.min_price_km_city ?? Infinity);
  // Глухий кут:
  if (m.city_only || m.min_price_km_suburb == null) return false;
  return r.grossPerKm >= m.min_price_km_suburb;
}

export interface ModeStat {
  pass: number;
  cut: number;
  npkPass: number;
  npkCut: number;
  below: number;
  missedGood: number;
}

/** Бектест одного режиму на історії поїздок. */
export function modeStats(rows: Row[], m: Mode, thr: number): ModeStat {
  const pass = rows.filter((r) => modePass(r, m));
  const cut = rows.filter((r) => !modePass(r, m));
  return {
    pass: pass.length,
    cut: cut.length,
    npkPass: round(npkOf(pass)),
    npkCut: round(npkOf(cut)),
    below: pass.filter((r) => r.netPerKm < thr).length,
    missedGood: cut.filter((r) => r.netPerKm >= thr).length,
  };
}

function round(n: number, d = 2): number {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

// ── Знімок стану для дифу між запусками ──────────────────────────────

export interface ModeSnap {
  id: string;
  name: string;
  cityPrice: number | null;
  suburbPrice: number | null;
  pass: number;
  npkPass: number;
  missedGood: number;
  below: number;
}

export interface Snapshot {
  at: string;
  trips: number;
  days: number;
  base: number;
  net: number;
  amount: number;
  km: number;
  /** Сигнатура витрат/порогів — від неї залежать ₴/км-пороги. */
  sig: {
    gas_price: number;
    gas_cons: number;
    empty: number;
    comm: number;
    comm_cashless: number;
    thr: number;
  };
  modes: ModeSnap[];
}

/** Побудувати компактний знімок поточного стану звіту. */
export function buildSnapshot(data: Data): Snapshot {
  const s = data.settings;
  const rows = enrich(data);
  const thr = s.threshold_net_per_km;
  const modes = deriveModes(s);
  const days = new Set(rows.map((r) => r.datetime.split(" ")[0])).size;
  return {
    at: new Date().toISOString(),
    trips: rows.length,
    days,
    base: round(npkOf(rows), 3),
    net: round(rows.reduce((a, r) => a + r.net, 0)),
    amount: rows.reduce((a, r) => a + r.amount, 0),
    km: round(rows.reduce((a, r) => a + r.distance, 0)),
    sig: {
      gas_price: s.gas_price_per_l,
      gas_cons: s.gas_consumption_l_100km,
      empty: s.empty_run_coef,
      comm: s.commission_uklon_pct,
      comm_cashless: s.commission_cashless_pct,
      thr,
    },
    modes: modes.map((m) => {
      const st = modeStats(rows, m, thr);
      return {
        id: m.id,
        name: m.name,
        cityPrice: m.min_price_km_city ?? null,
        suburbPrice: m.min_price_km_suburb ?? null,
        pass: st.pass,
        npkPass: st.npkPass,
        missedGood: st.missedGood,
        below: st.below,
      };
    }),
  };
}

/** Прочитати попередній знімок (null, якщо файлу немає / битий). */
export function loadSnapshot(path = ".report-state.json"): Snapshot | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Snapshot;
  } catch {
    return null;
  }
}

export function saveSnapshot(s: Snapshot, path = ".report-state.json"): void {
  writeFileSync(path, JSON.stringify(s, null, 2) + "\n", "utf8");
}

