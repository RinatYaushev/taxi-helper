// Спільні формули та завантаження даних.
//
// ⚠️ Головне правило файлу: **все, що потрапляє у слот, мусить існувати як поле
// форми фільтра Uklon**. Тут колись жив шар «режимів» з афінним порогом
// `A + B×км`, якого у формі немає — звіт показував «екв. ₴/км», а бектестив
// зовсім інше правило (33 розбіжності зі 164). Не повторювати.
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import type { Data, Settings, Trip, Computed, Row, Zone, Slot, SlotStat } from "./types.ts";
import { shiftsOf, gapsWithinShifts } from "./time.ts";

export function loadData(path = "data.json"): Data {
  return JSON.parse(readFileSync(path, "utf8")) as Data;
}

/** Записати дані, лишивши `<path>.bak` — у файл пишуть три різні скрипти. */
export function saveData(data: Data, path = "data.json"): void {
  if (existsSync(path)) copyFileSync(path, `${path}.bak`);
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

export function emptyCoef(t: Trip, s: Settings): number {
  return emptyCoefZone(t.zone, s);
}

/** Запасні коефіцієнти циклу, якщо `cycle_model` ще не калібрували. */
export const DEFAULT_CYCLE = { base: 10.6, perKm: 1.79 };

/** Коефіцієнти ВИМІРЯНОЇ моделі циклу для зони: `хв = base + perKm × км`. */
export function cycleCoefs(zone: Zone, s: Settings): { base: number; perKm: number } {
  const cm = s.cycle_model;
  if (!cm) return { ...DEFAULT_CYCLE };
  const z = cm.by_zone?.[zone];
  if (z) return { base: z.base_min, perKm: z.per_km_min };
  return { base: cm.base_min, perKm: cm.per_km_min };
}

/** Тривалість повного циклу замовлення (хв): від старту цього до старту наступного.
 *  Виміряна з даних — уже включає подачу/чекання/передачу/репозиціонування. */
export function cycleMinutes(dist: number, zone: Zone, s: Settings): number {
  const { base, perKm } = cycleCoefs(zone, s);
  return base + perKm * dist;
}

/** Базова планка ₴/год — єдина шкала рішень. */
export function baseTargetPh(s: Settings): number {
  return s.target_net_per_hour ?? 200;
}

/**
 * Нижня межа «сірої зони» в ₴/год — під нею замовлення однозначно «пропускай».
 * Ширина смуги «думай» успадкована з давньої пропорції в ₴/км
 * (`marginal_net_per_km / threshold_net_per_km`), але міряється часом.
 */
export function marginalTargetPh(s: Settings): number {
  const ratio = s.threshold_net_per_km > 0 ? s.marginal_net_per_km / s.threshold_net_per_km : 0.7;
  return baseTargetPh(s) * ratio;
}

/**
 * Афінний поріг мінімальної суми `A + B×км` для цілі ₴/год і зони.
 *
 * ⚠️ Це **не** налаштування фільтра (такого поля у формі немає) — лише
 * внутрішня похідна: з неї виводиться «безпечна» ціна передмістя для слота.
 *   A = targetPh × base_min/60 / (1−c)
 *   B = (targetPh × per_km_min/60 + (1+порожняк)×паливо) / (1−c)
 * Порожняк множить лише ПАЛИВО: час уже виміряний з інтервалів між замовленнями.
 */
export function fareAB(s: Settings, targetPh: number, zone: Zone): { a: number; b: number } {
  const { base, perKm } = cycleCoefs(zone, s);
  const c = s.commission_uklon_pct / 100;
  const kGas = 1 + emptyCoefZone(zone, s);
  const a = (targetPh * base) / 60 / (1 - c);
  const b = ((targetPh * perKm) / 60 + kGas * fuelPerKm(s)) / (1 - c);
  return { a, b };
}

/** Беззбитковість палива з порожняком зони, грн/км. */
export function breakevenZone(s: Settings, zone: Zone): number {
  return fuelPerKm(s) * (1 + emptyCoefZone(zone, s));
}

/**
 * Мін. валова ціна («золоте правило») для зони, грн/км.
 *
 * ⚠️ Глобального варіанта більше немає навмисно: він рахувався з
 * `empty_run_coef = 0.5`, якого не має **жодна** зона (місто 0.3, тупик 1.0),
 * і давав 27.8 ₴/км — середнє ні для чого. Правильні числа: місто ≈ 26.4,
 * глухий кут ≈ 31.4.
 */
export function minGrossPerKmZone(s: Settings, zone: Zone): number {
  const cashRate = s.commission_uklon_pct / 100;
  return (s.threshold_net_per_km + breakevenZone(s, zone)) / (1 - cashRate);
}

/** Золоте правило по зонах — те, що показує звіт. */
export function goldenRule(s: Settings): { city: number; dead: number } {
  return {
    city: minGrossPerKmZone(s, "Місто"),
    dead: minGrossPerKmZone(s, "Глухий кут"),
  };
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

/**
 * Комісія за поїздку.
 *
 * `commission_cashless_pct` — це плата за **вивід безготівки**, тож вона
 * стосується лише тієї частини суми, що впала на баланс:
 *   • Готівка      — 0 безготівкової частини;
 *   • Безготівка   — уся сума;
 *   • Комбінована  — `amount_balance`, а якщо розбивки немає — оцінка
 *     `combined_balance_share` (раніше комбінована взагалі не платила цей
 *     відсоток, і 28 поїздок зі 164 рахувались дешевшими, ніж є).
 */
export function balanceAmount(t: Trip, s: Settings): number {
  if (t.payment === "Готівка") return 0;
  if (t.payment === "Безготівка") return t.amount;
  if (t.amount_balance != null) return Math.min(t.amount_balance, t.amount);
  return t.amount * (s.combined_balance_share ?? 0.5);
}

export function commissionOf(t: Trip, s: Settings): number {
  const base = (t.amount * s.commission_uklon_pct) / 100;
  return base + (balanceAmount(t, s) * s.commission_cashless_pct) / 100;
}

/** Порахувати газ, комісію, чистий, грн/км і рекомендацію для однієї поїздки */
export function compute(t: Trip, s: Settings): Computed {
  const amount = Number(t.amount);
  const dist = Number(t.distance);
  const gas = dist * (1 + emptyCoef(t, s)) * fuelPerKm(s);
  const commission = commissionOf(t, s);
  const net = amount - commission - gas;
  const grossPerKm = dist ? amount / dist : 0;
  const netPerKm = dist ? net / dist : 0;
  // Час: ВИМІРЯНИЙ цикл замовлення (старт цього → старт наступного). Уже
  // включає подачу/чекання/передачу/репозиціонування, тож порожняк назад сюди
  // НЕ додаємо — це подвійний рахунок.
  const timeMin = cycleMinutes(dist, t.zone, s);
  const netPerHour = timeMin > 0 ? net / (timeMin / 60) : 0;
  const targetPh = baseTargetPh(s);
  const marginalPh = marginalTargetPh(s);
  const rating: "OK" | "погана" = netPerHour >= targetPh ? "OK" : "погана";
  const rec =
    netPerHour >= targetPh ? "бери" : netPerHour >= marginalPh ? "думай" : "пропускай";
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
  /** Частка замовлень, що НЕ дотягують до цілі ₴/год (rec !== "бери"). */
  badPct: number;
}

export function groupStats(rows: Row[]): GroupStat {
  const n = rows.length;
  const amount = rows.reduce((a, r) => a + r.amount, 0);
  const km = rows.reduce((a, r) => a + r.distance, 0);
  const net = rows.reduce((a, r) => a + r.net, 0);
  const bad = rows.filter((r) => r.rec !== "бери").length;
  return { n, amount, km, net, netPerKm: km ? net / km : 0, badPct: n ? (bad / n) * 100 : 0 };
}

/** Чист/км для набору рядків */
export function npkOf(rs: Row[]): number {
  const km = rs.reduce((a, r) => a + r.distance, 0);
  return km ? rs.reduce((a, r) => a + r.net, 0) / km : 0;
}

/** ₴/год для набору рядків за виміряним циклом. */
export function phOf(rs: Row[]): number {
  const mins = rs.reduce((a, r) => a + r.timeMin, 0);
  return mins ? rs.reduce((a, r) => a + r.net, 0) / (mins / 60) : 0;
}

// ── Зміни: модельний час проти фактичного ────────────────────────────

export interface ShiftStats {
  /** Скільки змін у вибірці (розрив > shift_gap_min = нова зміна). */
  count: number;
  /** Фактична тривалість змін: від першого старту до кінця останнього циклу, год. */
  realH: number;
  /** Сума модельних циклів, год. */
  modelH: number;
  /** Час, якого модель не бачить (довгі паузи всередині зміни), год. */
  idleH: number;
  /** Утилізація = modelH / realH. */
  utilization: number;
  /** ₴/год за модельними циклами — шкала, в якій задана ціль. */
  modelPh: number;
  /** ₴/год за фактичною тривалістю зміни — те, що видно в гаманці. */
  realPh: number;
  /** Медіани зміни — для «реальності зміни» у звіті. */
  medianTrips: number;
  medianHours: number;
  medianNet: number;
}

/**
 * Дві ставки, і обидві чесні.
 *
 * `modelPh` — вартість замовлення (сума виміряних циклів). Саме в ній задана
 * ціль `target_net_per_hour`, і саме її порівнюють слоти між собою.
 * `realPh` — той самий чистий, поділений на фактично проведений на лінії час,
 * включно з паузами, яких модель циклу не бачить (вона обрізає розриви).
 *
 * Розрив між ними — не помилка, а **простій**. Але звіт мусить показувати
 * обидві: інакше водій порівнює 294 ₴/год із тим, що в гаманці, і не сходиться.
 */
export function shiftStats(rows: Row[], s: Settings): ShiftStats {
  const shifts = shiftsOf(rows, (r) => r.datetime, s);
  const net = rows.reduce((a, r) => a + r.net, 0);
  const modelMin = rows.reduce((a, r) => a + r.timeMin, 0);
  let realMin = 0;
  const perShift: Array<{ n: number; h: number; net: number }> = [];
  for (const sh of shifts) {
    const last = sh.items[sh.items.length - 1];
    const span = sh.spanMin + (last?.timeMin ?? 0);
    realMin += span;
    perShift.push({
      n: sh.items.length,
      h: span / 60,
      net: sh.items.reduce((a, r) => a + r.net, 0),
    });
  }
  const med = (xs: number[]): number => {
    if (!xs.length) return 0;
    const a = [...xs].sort((x, y) => x - y);
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  return {
    count: shifts.length,
    realH: realMin / 60,
    modelH: modelMin / 60,
    idleH: Math.max(0, (realMin - modelMin) / 60),
    utilization: realMin ? modelMin / realMin : 0,
    modelPh: modelMin ? net / (modelMin / 60) : 0,
    realPh: realMin ? net / (realMin / 60) : 0,
    medianTrips: med(perShift.map((x) => x.n)),
    medianHours: med(perShift.map((x) => x.h)),
    medianNet: med(perShift.map((x) => x.net)),
  };
}

/** Інтервали між замовленнями всередині змін — вхід для калібрування. */
export function tripGaps(rows: Trip[], s: Settings): Array<{ from: Trip; gapMin: number }> {
  return gapsWithinShifts(rows, (r) => r.datetime, s).map((g) => ({ from: g.from, gapMin: g.gapMin }));
}

function round(n: number, d = 2): number {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

// ── Слоти Автопілота ─────────────────────────────────────────────────

/**
 * Цінова частина слота — усе, крім радіуса подачі:
 *   `сума ≥ Мін.вартість` І `сума ≥ ₴/км × max(дистанція, Км-у-мінімалці)`.
 * Винесено окремо, бо `earnedPickupKm` виводить радіус саме з цінового порогу
 * (інакше вийшло б колове визначення).
 */
export function slotPassPrice(r: Pick<Row, "amount" | "distance" | "zone" | "longHaul">, s: Slot): boolean {
  if (r.longHaul) return false; // міжміський — Автопілот off
  if (r.zone !== "Місто") {
    if (s.city_only || s.price_km_suburb == null) return false;
  }
  if (r.amount < s.min_order) return false;
  const p = r.zone === "Місто" ? s.price_km : (s.price_km_suburb as number);
  return r.amount >= p * Math.max(r.distance, s.km_in_min);
}

/**
 * Чи пройде замовлення крізь слот — семантика фільтра Uklon:
 *   `сума ≥ Мін.вартість` І `сума ≥ ₴/км × max(дистанція, Км-у-мінімалці)`
 *   І `подача ≤ Відстань`.
 * Подача перевіряється лише коли відома (`pickup_km`).
 */
export function slotPass(
  r: Pick<Row, "amount" | "distance" | "zone" | "longHaul" | "pickup_km">,
  s: Slot,
): boolean {
  if (r.pickup_km != null && r.pickup_km > s.max_pickup_km) return false;
  return slotPassPrice(r, s);
}

/**
 * Альтернативне прочитання правила фільтра — **адитивне**:
 *   `сума ≥ Мін.вартість + ₴/км × max(0, дистанція − Км-у-мінімалці)`.
 * Офіційна стаття Uklon описує поля двома несумісними прикладами, тож обидва
 * читання лишаються живими, поки не перевірені журналом пропозицій
 * (`src/offers.ts::filterRuleEvidence`).
 */
export function slotPassAdditive(
  r: Pick<Row, "amount" | "distance" | "zone" | "longHaul" | "pickup_km">,
  s: Slot,
): boolean {
  if (r.longHaul) return false;
  if (r.pickup_km != null && r.pickup_km > s.max_pickup_km) return false;
  if (r.zone !== "Місто" && (s.city_only || s.price_km_suburb == null)) return false;
  if (r.amount < s.min_order) return false;
  const p = r.zone === "Місто" ? s.price_km : (s.price_km_suburb as number);
  return r.amount >= s.min_order + p * Math.max(0, r.distance - s.km_in_min);
}

/** Ціна одного кілометра подачі, грн: пальне + час за цільовою ставкою. */
export function pickupCostPerKm(s: Settings): number {
  const pace = s.cycle_model?.per_km_min ?? DEFAULT_CYCLE.perKm;
  return fuelPerKm(s) + (baseTargetPh(s) * pace) / 60;
}

/**
 * Типова подача, яка **вже врахована** в моделі, км.
 * Поки `pickup_km` не збирають — оцінка з порожняку; від 20 замірів рахуємо з факту.
 */
export function typicalPickupKm(rows: Row[], s: Settings): number {
  const known = rows.map((r) => r.pickup_km).filter((x): x is number => x != null);
  if (known.length >= 20) return known.reduce((a, b) => a + b, 0) / known.length;
  const avgKm = rows.length ? rows.reduce((a, r) => a + r.distance, 0) / rows.length : 0;
  return avgKm * emptyCoefZone("Місто", s);
}

/**
 * Радіус подачі, який слот **заробив** своїм ціновим порогом, км.
 * 10-й перцентиль надлишку над ціллю серед пропущених за ціною замовлень,
 * поділений на ціну км: радіус витримують ~90% потоку слота.
 */
export function earnedPickupKm(rows: Row[], slot: Slot, s: Settings): number {
  const pass = rows.filter((r) => slotPassPrice(r, slot));
  if (pass.length < 5) return 2;
  const T = baseTargetPh(s);
  const sp = pass.map((r) => r.net - (T * r.timeMin) / 60).sort((a, b) => a - b);
  const p10 = sp[Math.floor(0.1 * sp.length)];
  const km = typicalPickupKm(rows, s) + p10 / pickupCostPerKm(s);
  return Math.max(1, Math.min(4, Math.round(km * 2) / 2));
}

/** Бектест набору слотів (об'єднання за АБО). */
export function slotsStats(rows: Row[], slots: Slot[]): SlotStat {
  const acc = rows.filter((r) => slots.some((s) => slotPass(r, s)));
  const cut = rows.filter((r) => !slots.some((s) => slotPass(r, s)));
  return {
    pass: acc.length,
    cut: cut.length,
    phPass: Math.round(phOf(acc)),
    phCut: Math.round(phOf(cut)),
    netPass: Math.round(acc.reduce((a, r) => a + r.net, 0)),
    netCut: Math.round(cut.reduce((a, r) => a + r.net, 0)),
    deadEnds: acc.filter((r) => r.zone === "Глухий кут").length,
  };
}

/**
 * Беззбитковість фільтра: яку частку **звільненого часу** треба заповнити
 * новими замовленнями, щоб фільтр вийшов у нуль:
 *   `fill = lostNet / (freedH × phPass)`.
 */
export function refillBreakeven(
  rows: Row[],
  slots: Slot[],
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

// ── Підбір слотів ────────────────────────────────────────────────────

/** Детермінований ГПВЧ — звіт має бути відтворюваним між запусками. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Скільки надлишку над ціллю кандидат втрачає, лишаючись «не гіршим за оптимум». */
const PLATEAU_TOL = 0.02;
const BOOTSTRAPS = 60;

interface Cand {
  price_km: number;
  km_in_min: number;
  min_order: number;
  price_km_suburb?: number;
}

function candidates(s: Settings, T: number): Cand[] {
  const dead = fareAB(s, T, "Глухий кут");
  const out: Cand[] = [];
  for (const km_in_min of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]) {
    // Безпечна ціна передмістя: за неї слот ніколи не пустить тупик нижче цілі.
    const subSafe = Math.ceil(dead.b + dead.a / km_in_min);
    for (let price_km = 18; price_km <= 60; price_km++) {
      for (const min_order of [80, 90]) {
        // ⚠️ Кандидат БЕЗ ціни передмістя → `candToSlot` вмикає `city_only`, а
        // тумблер «Лише по місту» живе у вкладці **Простий**, де полів
        // «Км у мінімалці» та ціни передмістя НЕМАЄ. Тому такий кандидат
        // допустимий лише з `km_in_min = 1` — це рівно те, що вводиться у
        // Простий (для d ≥ 1 км `max(d, 1) = d`, а коротші й так відсікає
        // `min_order`). Інакше звіт видавав інструкцію, яку **неможливо
        // ввести у форму**: «Тип тарифу: Складний» + «Лише по місту: увімк.».
        if (km_in_min === 1) out.push({ price_km, km_in_min, min_order });
        out.push({ price_km, km_in_min, min_order, price_km_suburb: subSafe });
      }
    }
  }
  return out;
}

function candToSlot(c: Cand, pickup: number): Slot {
  return {
    id: "x",
    name: "",
    icon: "",
    role: "",
    price_km: c.price_km,
    price_km_suburb: c.price_km_suburb,
    km_in_min: c.km_in_min,
    min_order: c.min_order,
    max_pickup_km: pickup,
    city_only: c.price_km_suburb == null,
  };
}

/**
 * Підібрати 2 постійні слоти з даних.
 *
 * Критерій: **надлишок над резервною ставкою** `surplus = чистий − T×цикл/60`.
 * Приймати варто рівно ті замовлення, де він додатний.
 *
 * ⚠️ Чому не просто аргмакс по історії. Оптимум **плоский**: у межах 2% від
 * максимуму захопленого надлишку лежить широкий діапазон цін, а водій вбиває ці
 * числа в застосунок руками — стабільність параметра важливіша за третій знак.
 * Тому з «плато» береться **найм'якший** поріг: за рівного очікуваного
 * результату дешевше помилитись у бік зайвого замовлення, ніж у бік простою
 * (відхилених ми не бачимо, а сам Uklon пише, що 90% водіїв ставлять фільтри
 * **надто жорсткими**).
 *
 * ⚠️ **Ціна цієї м'якості виміряна** — 200 розбиттів 60/40 по змінах:
 * м'яке плато 287.4 ₴/год і 87% прийнятих проти 292.6 ₴/год і 82% в аргмакса.
 * Це **не** втрата: ₴/год механічно вища у строгішого фільтра (він рахується
 * лише серед прийнятих). Чесне порівняння — гроші за ту саму зміну:
 * м'який набір виграє, поки звільнений час заповнюється **гірше ніж на 74%**
 * (при f=0 це +678 ₴, при f=1 −238 ₴). Заповнення ми не міряємо, тож обрано
 * бік, який програє менше в поганому сценарії. Переглянути, щойно зʼявиться
 * `data.offers`/`data.idles`.
 *
 * ⚠️ Бутстреп **не бере участі у виборі** — і це виміряно, а не смак. Коли
 * кандидати оцінювались песимістичним P10 по бутстрепах, ціна першого слота
 * гуляла по 8 значеннях (18–28) проти 4 без нього, out-of-sample ставка не
 * мінялась (287.6 проти 287.4), а вкладка тарифу фліпала частіше. Песимістична
 * оцінка сама по собі шумніша, тож аргмакс по ній стрибав. Бутстреп лишився
 * рівно там, де корисний, — у **діагностиці** `Slot.stability.agreePct`.
 *
 * ⚠️ Об'єднання за АБО бере **мінімум** порогів, тож слоти мусять бути
 * невкладеними. Єдиний вимір, який це дає, — **радіус подачі**: щабель 1 —
 * ціновий оптимум зі своїм заслуженим радіусом, щабель 2 — найдешевший поріг,
 * що заробляє радіус на STEP ширший.
 *
 * ⚠️ Третього щабля («Далека подача») свідомо немає. На всій історії він не
 * ловив жодного замовлення ексклюзивно (перевірено): за будь-якої ціни програвав
 * або першому слоту на коротких, або другому на середніх, а ширший радіус сам
 * по собі, без своєї ціни, нічого не додає в об'єднанні за АБО. Втеча з глухого
 * кута — окрема задача (див. панель фільтрів): `zone` визначається за
 * призначенням поїздки, а не позицією водія, тож фільтром вона не вирішується.
 */
export function deriveSlots(rows: Row[], s: Settings): Slot[] {
  const T = baseTargetPh(s);
  const surplus = rows.map((r) => r.net - (T * r.timeMin) / 60);
  const cands = candidates(s, T);
  const masks = cands.map((c) => {
    const sl = candToSlot(c, 99);
    return rows.map((r) => slotPassPrice(r, sl));
  });

  const scoreWith = (mask: boolean[], w: number[]): number => {
    let acc = 0;
    for (let j = 0; j < mask.length; j++) if (mask[j]) acc += surplus[j] * w[j];
    return acc;
  };
  const ones = rows.map(() => 1);
  const inSample = masks.map((m) => scoreWith(m, ones));

  // Бутстреп по ЗМІНАХ (ресемплимо зміни, ваги = скільки разів зміна випала).
  // Потрібен ЛИШЕ для діагностики `agreement()` — вибір іде по `inSample`.
  const shifts = shiftsOf(
    rows.map((r, i) => ({ r, i })),
    (x) => x.r.datetime,
    s,
  ).map((sh) => sh.items.map((x) => x.i));
  const rnd = mulberry32(20260829);
  const bootScores: number[][] = []; // [bootstrap][cand]
  if (shifts.length >= 3) {
    for (let b = 0; b < BOOTSTRAPS; b++) {
      const w = rows.map(() => 0);
      for (let k = 0; k < shifts.length; k++) {
        const pick = shifts[Math.floor(rnd() * shifts.length)];
        for (const idx of pick) w[idx] += 1;
      }
      bootScores.push(masks.map((m) => scoreWith(m, w)));
    }
  }

  const radii = cands.map((c) => earnedPickupKm(rows, candToSlot(c, 99), s));

  /** Найм'якший (найдешевший) кандидат у межах плато навколо максимуму. */
  const pickPlateau = (allowed: number[]): { idx: number; lo: number; hi: number } => {
    let best = allowed[0];
    for (const i of allowed) if (inSample[i] > inSample[best]) best = i;
    const bar = inSample[best] - Math.abs(inSample[best]) * PLATEAU_TOL;
    const plateau = allowed.filter((i) => inSample[i] >= bar);
    const prices = plateau.map((i) => cands[i].price_km);
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
    // З плато беремо найм'якший поріг; за рівної ціни — менший «км у мінімалці».
    let soft = plateau[0];
    for (const i of plateau) {
      const c = cands[i];
      const cur = cands[soft];
      if (
        c.price_km < cur.price_km ||
        (c.price_km === cur.price_km && c.km_in_min < cur.km_in_min) ||
        (c.price_km === cur.price_km && c.km_in_min === cur.km_in_min && c.min_order < cur.min_order)
      ) {
        soft = i;
      }
    }
    return { idx: soft, lo, hi };
  };

  /** Наскільки бутстрепи згодні, що оптимум лежить у цьому діапазоні цін. */
  const agreement = (allowed: Set<number>, lo: number, hi: number): number => {
    if (!bootScores.length) return 100;
    let ok = 0;
    for (const b of bootScores) {
      let bi = -1;
      for (let i = 0; i < cands.length; i++) {
        if (!allowed.has(i)) continue;
        if (bi < 0 || b[i] > b[bi]) bi = i;
      }
      if (bi >= 0 && cands[bi].price_km >= lo && cands[bi].price_km <= hi) ok++;
    }
    return Math.round((ok / bootScores.length) * 100);
  };

  const chosen: Array<{ c: Cand; pickup: number; lo: number; hi: number; agree: number }> = [];

  // Щабель 1 — ціновий оптимум серед усіх кандидатів.
  {
    const all = cands.map((_, i) => i);
    const { idx, lo, hi } = pickPlateau(all);
    chosen.push({
      c: cands[idx],
      pickup: radii[idx],
      lo,
      hi,
      agree: agreement(new Set(all), lo, hi),
    });
  }

  // Щабель 2 — найкращий серед тих, хто заробив помітно ширший радіус.
  const STEP = 0.5;
  while (chosen.length < 2) {
    const need = chosen[chosen.length - 1].pickup + STEP;
    const allowed = cands.map((_, i) => i).filter((i) => radii[i] >= need);
    if (!allowed.length) break; // ширший радіус ніхто не заробляє — чесніше віддати слот
    const { idx, lo, hi } = pickPlateau(allowed);
    chosen.push({
      c: cands[idx],
      pickup: radii[idx],
      lo,
      hi,
      agree: agreement(new Set(allowed), lo, hi),
    });
  }

  const meta = [
    { id: "close", name: "Впритул", icon: "🟢", role: "Основний потік. Дешевше — але тільки коли клієнт поруч." },
    { id: "mid", name: "Робочий", icon: "🔵", role: "Ловить решту прибуткових замовлень — платять краще, тож не шкода проїхати далі по клієнта." },
  ];
  return chosen.map((x, i) => ({
    ...candToSlot(x.c, x.pickup),
    id: meta[i]?.id ?? `slot${i}`,
    name: meta[i]?.name ?? `Слот ${i + 1}`,
    icon: meta[i]?.icon ?? "⚪",
    role: meta[i]?.role ?? "",
    stability: { plateauLo: x.lo, plateauHi: x.hi, agreePct: x.agree },
  }));
}

// ── Знімок стану для дифу між запусками ──────────────────────────────

export interface SlotSnap {
  id: string;
  name: string;
  price_km: number;
  price_km_suburb: number | null;
  km_in_min: number;
  min_order: number;
  max_pickup_km: number;
}

export interface Snapshot {
  at: string;
  trips: number;
  shifts: number;
  base: number;
  net: number;
  amount: number;
  km: number;
  /** ₴/год: модельна (ціль задана в ній) і фактична (з простоями). */
  modelPh: number;
  realPh: number;
  /** Сигнатура витрат/порогів — від неї залежать пороги слотів. */
  sig: {
    gas_price: number;
    gas_cons: number;
    empty: number;
    comm: number;
    comm_cashless: number;
    thr: number;
    target_ph: number;
  };
  slots: SlotSnap[];
  slotStat: { pass: number; cut: number; phPass: number; fill: number };
}

export function buildSnapshot(data: Data): Snapshot {
  const s = data.settings;
  const rows = enrich(data);
  const slots = deriveSlots(rows, s);
  const st = slotsStats(rows, slots);
  const rb = refillBreakeven(rows, slots);
  const sh = shiftStats(rows, s);
  return {
    at: new Date().toISOString(),
    trips: rows.length,
    shifts: sh.count,
    base: round(npkOf(rows), 3),
    net: round(rows.reduce((a, r) => a + r.net, 0)),
    amount: rows.reduce((a, r) => a + r.amount, 0),
    km: round(rows.reduce((a, r) => a + r.distance, 0)),
    modelPh: Math.round(sh.modelPh),
    realPh: Math.round(sh.realPh),
    sig: {
      gas_price: s.gas_price_per_l,
      gas_cons: s.gas_consumption_l_100km,
      empty: s.empty_run_coef,
      comm: s.commission_uklon_pct,
      comm_cashless: s.commission_cashless_pct,
      thr: s.threshold_net_per_km,
      target_ph: baseTargetPh(s),
    },
    slots: slots.map((sl) => ({
      id: sl.id,
      name: sl.name,
      price_km: sl.price_km,
      price_km_suburb: sl.price_km_suburb ?? null,
      km_in_min: sl.km_in_min,
      min_order: sl.min_order,
      max_pickup_km: sl.max_pickup_km,
    })),
    slotStat: { pass: st.pass, cut: st.cut, phPass: st.phPass, fill: round(rb.fill, 3) },
  };
}

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
