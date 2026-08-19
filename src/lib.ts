// Спільні формули та завантаження даних
import { readFileSync, writeFileSync } from "node:fs";
import type { Data, Settings, Trip, Computed, Row, Mode, Zone } from "./types.ts";

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

/** Коеф. порожняку для зони призначення (місто/глухий кут), fallback — глобальний. */
export function emptyCoefZone(zone: Zone, s: Settings): number {
  return s.empty_run_by_zone?.[zone] ?? s.empty_run_coef;
}

/** Коеф. порожняку для поїздки — залежить від зони призначення (місто/глухий кут).
 *  Fallback — глобальний empty_run_coef, якщо зони немає в мапі. */
export function emptyCoef(t: Trip, s: Settings): number {
  return emptyCoefZone(t.zone, s);
}

/** Середня швидкість для зони (місто повільніше, села швидше), fallback — загальна. */
export function avgSpeedZone(zone: Zone, s: Settings): number {
  return (
    s.time_model?.avg_speed_by_zone?.[zone] ??
    s.time_model?.avg_speed_kmh ??
    24
  );
}

/** Базова планка ₴/год для афінного порогу. */
export function baseTargetPh(s: Settings): number {
  return s.target_net_per_hour ?? 200;
}

/**
 * Афінний поріг мінімальної суми: `A + B×км` (для заданого цільового ₴/год і зони).
 * Виводиться з моделі часу + палива + комісії (подача=0 для правила):
 *   A = targetPh × накладні/60 / (1−c)                     — фікс «за клопіт»
 *   B = (1+порожняк) × (targetPh/швидкість + паливо/км)/(1−c) — грн/км
 */
export function fareAB(s: Settings, targetPh: number, zone: Zone): { a: number; b: number } {
  const speed = avgSpeedZone(zone, s);
  const overhead = s.time_model?.order_overhead_min ?? 4;
  const c = s.commission_uklon_pct / 100;
  const k = 1 + emptyCoefZone(zone, s);
  const a = (targetPh * overhead) / 60 / (1 - c);
  const b = (k * (targetPh / speed + fuelPerKm(s))) / (1 - c);
  return { a, b };
}

/** Мінімально прийнятна сума замовлення для зони (афінний поріг). */
export function minFare(dist: number, zone: Zone, targetPh: number, s: Settings): number {
  const { a, b } = fareAB(s, targetPh, zone);
  return a + b * dist;
}

/** Беззбитковість з урахуванням порожнього пробігу, грн/км */
export function breakeven(s: Settings): number {
  return fuelPerKm(s) * (1 + s.empty_run_coef);
}

/** Беззбитковість для зони (порожняк за зоною), грн/км */
export function breakevenZone(s: Settings, zone: Zone): number {
  return fuelPerKm(s) * (1 + emptyCoefZone(zone, s));
}

/** Мін. валова ціна (золоте правило), грн/км */
export function minGrossPerKm(s: Settings): number {
  const cashRate = s.commission_uklon_pct / 100;
  return (s.threshold_net_per_km + breakeven(s)) / (1 - cashRate);
}

/** Мін. валова ціна для зони (еквів. ₴/км з урахуванням порожняку зони). */
export function minGrossPerKmZone(s: Settings, zone: Zone): number {
  const cashRate = s.commission_uklon_pct / 100;
  return (s.threshold_net_per_km + breakevenZone(s, zone)) / (1 - cashRate);
}

/**
 * Порахувати пороги ₴/км для кожного режиму з «золотого правила».
 * Так значення фільтрів **перераховуються** щоразу зі свіжих settings
 * (ціна газу, комісія, поріг), а не лишаються захардкодженими.
 */
export function deriveModes(s: Settings): import("./types.ts").Mode[] {
  const gCity = minGrossPerKmZone(s, "Місто");
  const gDead = minGrossPerKmZone(s, "Глухий кут");
  const basePh = baseTargetPh(s);
  const uf = s.uklon_fare ?? { base: 81, per_km: 16.4 };
  // Дистанція, де тариф Uklon (base + per_km×d) перестає покривати афінний
  // поріг (a + B×d). Якщо Uklon платить достатньо/км (per_km ≥ B) або перетин
  // за межами компактної Вінниці (>15 км) — межі фактично немає (undefined).
  const econCap = (a: number, B: number): number | undefined => {
    if (uf.per_km >= B) return undefined;
    const d = (a - uf.base) / (uf.per_km - B);
    if (!isFinite(d) || d <= 0 || d > 15) return undefined;
    return Math.round(d);
  };
  return s.modes.map((m) => {
    const targetPh = Math.round(basePh * m.price_km_mult);
    const city = fareAB(s, targetPh, "Місто");
    const suburb = fareAB(s, targetPh, "Глухий кут");
    const suburbAllowed = !m.city_only && m.price_km_suburb_mult != null;
    const a = Math.round(city.a);
    return {
      ...m,
      min_price_km_city: Math.round(gCity * m.price_km_mult),
      min_price_km_suburb:
        m.price_km_suburb_mult != null
          ? Math.round(gDead * m.price_km_suburb_mult)
          : undefined,
      target_ph: targetPh,
      fare_a: a,
      fare_b_city: Math.round(city.b),
      fare_b_suburb: suburbAllowed ? Math.round(suburb.b) : undefined,
      max_km_city: econCap(a, Math.round(city.b)),
      max_km_suburb: suburbAllowed ? econCap(a, Math.round(suburb.b)) : undefined,
    };
  });
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
  const gas = dist * (1 + emptyCoef(t, s)) * fpk;
  let commission = (amount * s.commission_uklon_pct) / 100;
  if (t.payment === "Безготівка") {
    commission += (amount * s.commission_cashless_pct) / 100;
  }
  const net = amount - commission - gas;
  const grossPerKm = dist ? amount / dist : 0;
  const netPerKm = dist ? net / dist : 0;
  // Час: подача (якщо відома) + пробіг + порожняк назад, за зонною швидкістю,
  // плюс фікс. накладні на замовлення (пошук/чекання/передача/оплата).
  const speed = avgSpeedZone(t.zone, s);
  const overhead = s.time_model?.order_overhead_min ?? 4;
  const pickup = Number(t.pickup_km ?? 0);
  const movingKm = pickup + dist * (1 + emptyCoef(t, s));
  const timeMin = overhead + (movingKm / speed) * 60;
  const netPerHour = timeMin > 0 ? net / (timeMin / 60) : 0;
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
  return { gas, commission, net, grossPerKm, netPerKm, timeMin, netPerHour, rating, rec, longHaul };
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
 * Предикат «пройде замовлення крізь режим?». Економічний гейт — **афінний поріг
 * мінімальної суми** (fare_a + fare_b×км), виведений із моделі часу/палива/комісії.
 * Подача перевіряється лише коли відома (pickup_km). max_km — стратегічний кап
 * (обіг у пік), не економіка. `m` має бути похідним режимом із deriveModes().
 */
export function modePass(r: Row, m: Mode): boolean {
  if (r.longHaul) return false; // дальняк (міжміський) — окрема логіка, Автопілот off
  if (r.amount < m.min_order) return false; // платформна мінімалка Uklon
  // Кап дистанції: стратегічний (обіг у пік) + економічний (де тариф Uklon
  // перестає покривати наш поріг). Беремо жорсткіший із наявних.
  const zoneEcon = r.zone === "Місто" ? m.max_km_city : m.max_km_suburb;
  const caps = [m.max_km, zoneEcon].filter((x): x is number => x != null);
  if (caps.length && r.distance > Math.min(...caps)) return false;
  if (r.pickup_km != null && r.pickup_km > m.max_pickup_km) return false;
  const a = m.fare_a ?? 0;
  if (r.zone === "Місто") {
    return r.amount >= a + (m.fare_b_city ?? Infinity) * r.distance;
  }
  // Глухий кут:
  if (m.city_only || m.fare_b_suburb == null) return false;
  return r.amount >= a + m.fare_b_suburb * r.distance;
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

