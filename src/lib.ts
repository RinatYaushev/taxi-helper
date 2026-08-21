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

/** Середня швидкість для зони (місто повільніше, села швидше), fallback — загальна.
 *  @deprecated Використовується лише як запасний варіант, якщо немає cycle_model. */
export function avgSpeedZone(zone: Zone, s: Settings): number {
  return (
    s.time_model?.avg_speed_by_zone?.[zone] ??
    s.time_model?.avg_speed_kmh ??
    24
  );
}

/** Коефіцієнти ВИМІРЯНОЇ моделі циклу для зони: `хв = base + perKm × км`. */
export function cycleCoefs(zone: Zone, s: Settings): { base: number; perKm: number } {
  const cm = s.cycle_model;
  if (cm) {
    const z = cm.by_zone?.[zone];
    if (z) return { base: z.base_min, perKm: z.per_km_min };
    return { base: cm.base_min, perKm: cm.per_km_min };
  }
  // Запасний варіант зі старої (модельованої) схеми: накладні + рух з порожняком.
  const speed = avgSpeedZone(zone, s);
  const overhead = s.time_model?.order_overhead_min ?? 4;
  return { base: overhead, perKm: ((1 + emptyCoefZone(zone, s)) / speed) * 60 };
}

/** Тривалість повного циклу замовлення (хв): від старту цього до старту наступного.
 *  Виміряна з даних — уже включає подачу/чекання/передачу/репозиціонування. */
export function cycleMinutes(dist: number, zone: Zone, s: Settings): number {
  const { base, perKm } = cycleCoefs(zone, s);
  return base + perKm * dist;
}

/** Базова планка ₴/год для афінного порогу. */
export function baseTargetPh(s: Settings): number {
  return s.target_net_per_hour ?? 200;
}

/**
 * Афінний поріг мінімальної суми: `A + B×км` (для заданого цільового ₴/год і зони).
 * Виводиться з ВИМІРЯНОЇ моделі циклу + палива + комісії:
 *   A = targetPh × base_min/60 / (1−c)                        — фікс «за клопіт»
 *   B = (targetPh × per_km_min/60 + (1+порожняк)×паливо)/(1−c) — грн/км
 * Увага: порожняк множить лише ПАЛИВО. Час уже виміряний з інтервалів між
 * замовленнями, тож додавати до нього порожняк назад — подвійний рахунок.
 */
export function fareAB(s: Settings, targetPh: number, zone: Zone): { a: number; b: number } {
  const { base, perKm } = cycleCoefs(zone, s);
  const c = s.commission_uklon_pct / 100;
  const kGas = 1 + emptyCoefZone(zone, s);
  const a = (targetPh * base) / 60 / (1 - c);
  const b = ((targetPh * perKm) / 60 + kGas * fuelPerKm(s)) / (1 - c);
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
  // Час: ВИМІРЯНИЙ цикл замовлення (старт цього → старт наступного).
  // Уже включає подачу, чекання, передачу й репозиціонування, тож порожняк
  // назад сюди НЕ додаємо — інакше подвійний рахунок (він і є те саме
  // репозиціонування, яке в місті майже завжди перекривається наступним замовленням).
  const timeMin = cycleMinutes(dist, t.zone, s);
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

// ── 3 постійні слоти Автопілота ──────────────────────────────────────

/**
 * Чи пройде замовлення крізь слот — точна семантика фільтра Uklon:
 *   `сума ≥ Мін.вартість` І `сума ≥ ₴/км × max(дистанція, Км-у-мінімалці)`.
 * (Інференс із поведінки фільтра, не з документації.)
 */
export function slotPass(r: Row, s: import("./types.ts").Slot): boolean {
  if (r.longHaul) return false; // міжміський — Автопілот off
  if (r.zone !== "Місто") {
    if (s.city_only || s.price_km_suburb == null) return false;
  }
  if (r.amount < s.min_order) return false;
  if (r.pickup_km != null && r.pickup_km > s.max_pickup_km) return false;
  const p = r.zone === "Місто" ? s.price_km : (s.price_km_suburb as number);
  return r.amount >= p * Math.max(r.distance, s.km_in_min);
}

/** Бектест набору слотів (об'єднання за АБО). */
export function slotsStats(rows: Row[], slots: import("./types.ts").Slot[]): import("./types.ts").SlotStat {
  const acc = rows.filter((r) => slots.some((s) => slotPass(r, s)));
  const cut = rows.filter((r) => !slots.some((s) => slotPass(r, s)));
  const ph = (rs: Row[]): number => {
    const mins = rs.reduce((a, r) => a + r.timeMin, 0);
    return mins ? rs.reduce((a, r) => a + r.net, 0) / (mins / 60) : 0;
  };
  return {
    pass: acc.length,
    cut: cut.length,
    phPass: Math.round(ph(acc)),
    phCut: Math.round(ph(cut)),
    netPass: Math.round(acc.reduce((a, r) => a + r.net, 0)),
    netCut: Math.round(cut.reduce((a, r) => a + r.net, 0)),
    deadEnds: acc.filter((r) => r.zone === "Глухий кут").length,
  };
}

/**
 * Беззбитковість фільтра: яку частку **звільненого часу** треба заповнити новими
 * замовленнями, щоб фільтр вийшов хоча б у нуль по грошах.
 *
 * Фільтр — це завжди обмін: ти віддаєш `lostNet` гривень зараз в обмін на
 * `freedH` вільних годин. Обмін окупається, якщо ці години принесуть не менше:
 *   `freedH × phPass × fill ≥ lostNet`  ⇒  `fill = lostNet / (freedH × phPass)`.
 *
 * Це єдине чесне число для вибору `target_net_per_hour`: воно показує, наскільки
 * щільним має бути потік замовлень, щоб ставка виправдала відсіювання. Дані про
 * відхилені замовлення нам недоступні, тож `fill` — вимога, а не факт.
 */
export function refillBreakeven(
  rows: Row[],
  slots: import("./types.ts").Slot[],
): { freedH: number; lostNet: number; fill: number; phPass: number } {
  const pass = rows.filter((r) => slots.some((s) => slotPass(r, s)));
  const cut = rows.filter((r) => !slots.some((s) => slotPass(r, s)));
  const passH = pass.reduce((a, r) => a + r.timeMin, 0) / 60;
  const freedH = cut.reduce((a, r) => a + r.timeMin, 0) / 60;
  const lostNet = cut.reduce((a, r) => a + r.net, 0);
  const phPass = passH ? pass.reduce((a, r) => a + r.net, 0) / passH : 0;
  const potential = freedH * phPass;
  return { freedH, lostNet, fill: potential > 0 ? lostNet / potential : 0, phPass };
}

/**
 * Підібрати 3 постійні слоти з даних.
 *
 * Ідея: приймати варто рівно ті замовлення, де **надлишок** над резервною ставкою
 * додатний: `surplus = чистий − T×цикл/60`, де `T = target_net_per_hour` — ставка,
 * яку ти отримав би замість цього замовлення. Ідеальний поріг — гіпербола
 * (короткі вимагають вищої ₴/км), а важіль Uklon плаский, тож наближаємо її
 * **сходинкою з 3 прямокутників** і жадібно беремо трійку, що захоплює
 * максимум наявного надлишку.
 *
 * Передмістя дозволяємо лише за «безпечною» ціною `B + A/k` (тоді слот ніколи
 * не пустить тупик нижче цілі) — саме тупики єдині системно збиткові.
 */
export function deriveSlots(rows: Row[], s: Settings): import("./types.ts").Slot[] {
  const T = baseTargetPh(s);
  const surplus = (r: Row): number => r.net - (T * r.timeMin) / 60;
  const dead = fareAB(s, T, "Глухий кут");

  interface Cand { price_km: number; km_in_min: number; min_order: number; price_km_suburb?: number }
  const cands: Cand[] = [];
  for (const km_in_min of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]) {
    // «Безпечна» ціна для передмістя за цього km_in_min
    const subSafe = Math.ceil(dead.b + dead.a / km_in_min);
    for (let price_km = 18; price_km <= 60; price_km++) {
      for (const min_order of [80, 90]) {
        cands.push({ price_km, km_in_min, min_order });
        cands.push({ price_km, km_in_min, min_order, price_km_suburb: subSafe });
      }
    }
  }
  const asSlot = (c: Cand): import("./types.ts").Slot => ({
    id: "x", name: "", icon: "", role: "",
    price_km: c.price_km,
    price_km_suburb: c.price_km_suburb,
    km_in_min: c.km_in_min,
    min_order: c.min_order,
    max_pickup_km: 3,
    city_only: c.price_km_suburb == null,
  });
  const masks = cands.map((c) => { const sl = asSlot(c); return rows.map((r) => slotPass(r, sl)); });

  const chosen: Cand[] = [];
  let cur = rows.map(() => false);
  for (let step = 0; step < 3; step++) {
    let best = -Infinity, bestI = -1;
    for (let i = 0; i < cands.length; i++) {
      let sc = 0;
      for (let j = 0; j < rows.length; j++) if (cur[j] || masks[i][j]) sc += surplus(rows[j]);
      if (sc > best) { best = sc; bestI = i; }
    }
    if (bestI < 0) break;
    chosen.push(cands[bestI]);
    cur = cur.map((v, j) => v || masks[bestI][j]);
  }

  // Ролі за «км у мінімалці»: менший — короткі/вершки, більший — довгі/преміум.
  chosen.sort((a, b) => a.km_in_min - b.km_in_min);
  const meta = [
    { id: "cream", name: "Вершки", icon: "🟢", role: "Короткі поруч: найвища ₴/км, мала подача — найкращий сегмент.", pickup: 1.5 },
    { id: "work", name: "Робочий", icon: "🔵", role: "Основний потік міста. Тримає тебе зайнятим весь час.", pickup: 3 },
    { id: "premium", name: "Преміум / довгі", icon: "🟣", role: "Довгі й передмістя — лише за високу суму (спрацьовує рідко).", pickup: 3 },
  ];
  return chosen.map((c, i) => ({
    id: meta[i]?.id ?? `slot${i}`,
    name: meta[i]?.name ?? `Слот ${i + 1}`,
    icon: meta[i]?.icon ?? "⚪",
    role: meta[i]?.role ?? "",
    price_km: c.price_km,
    price_km_suburb: c.price_km_suburb,
    km_in_min: c.km_in_min,
    min_order: c.min_order,
    max_pickup_km: meta[i]?.pickup ?? 3,
    city_only: c.price_km_suburb == null,
  }));
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
