// Валідація data.json.
//
// У файл пишуть три різні скрипти (parse, update-pay, calibrate), а читає його
// геть усе. Раніше `loadData` робив сліпий `JSON.parse ... as Data`, тож будь-яке
// зіпсоване поле тихо псувало всі числа звіту. Тут — самоперевірка, яку ганяє
// і CLI (`npm run check`), і панель «Якість даних».
import type { Data, Offer, Trip } from "./types.ts";
import { inArea } from "./lib.ts";
import { parseDT } from "./time.ts";

export type Level = "err" | "warn" | "info";

export interface Issue {
  level: Level;
  title: string;
  details: string[];
}

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Понад стільки км «по місту» для компактної Вінниці — привід перевірити зону. */
const FAR_CITY_KM = 15;

/**
 * Для злиплої адреси (`from === to`): чи залежить зона від того, де її розрізати?
 *
 * Склеєний рядок містить обидві адреси, справжня межа невідома. Але зона —
 * єдине, що з адреси йде в гроші, тож питання не «яка адреса правильна», а
 * «чи можуть різні розрізи дати різні зони». Якщо ні — запис безпечний.
 */
function zoneAmbiguous(t: Trip, dead: string[]): boolean {
  const parts = (t.to ?? "").split(",");
  const zones = new Set<boolean>();
  for (let k = 1; k < parts.length; k++) zones.add(inArea(parts.slice(k).join(","), dead));
  zones.add(t.zone === "Глухий кут");
  return zones.size > 1;
}

export function validateData(data: Data): Issue[] {
  const issues: Issue[] = [];
  const add = (level: Level, title: string, details: string[]): void => {
    if (details.length) issues.push({ level, title, details });
  };
  const s = data.settings;

  // ── settings ───────────────────────────────────────────────────────
  const cfg: string[] = [];
  if (!isNum(s?.gas_price_per_l) || s.gas_price_per_l <= 0) cfg.push("gas_price_per_l ≤ 0");
  if (!isNum(s?.gas_consumption_l_100km) || s.gas_consumption_l_100km <= 0)
    cfg.push("gas_consumption_l_100km ≤ 0");
  if (!isNum(s?.commission_uklon_pct) || s.commission_uklon_pct < 0 || s.commission_uklon_pct >= 100)
    cfg.push("commission_uklon_pct поза 0..100");
  if (s?.target_net_per_hour != null && s.target_net_per_hour <= 0)
    cfg.push("target_net_per_hour ≤ 0");
  if (!s?.cycle_model) cfg.push("немає cycle_model — час рахується запасними коефіцієнтами (npm run calibrate --write)");
  if (s?.combined_balance_share != null && (s.combined_balance_share < 0 || s.combined_balance_share > 1))
    cfg.push("combined_balance_share поза 0..1");
  add("err", "Налаштування", cfg);

  // ── trips ──────────────────────────────────────────────────────────
  const trips: Trip[] = data.trips ?? [];
  const badDt: string[] = [];
  const badNum: string[] = [];
  const badZone: string[] = [];
  const sameAddr: string[] = [];
  const sameAddrRisky: string[] = [];
  const brokenAddr: string[] = [];
  const farCity: string[] = [];
  const badPickup: string[] = [];
  const badBalance: string[] = [];
  const dupes: string[] = [];
  const legacy: string[] = [];
  const seen = new Map<string, number>();

  for (const t of trips) {
    const ts = parseDT(t.datetime, s);
    if (!ts) badDt.push(`«${t.datetime}»`);
    else if (!/^\d{4}-/.test(t.datetime)) legacy.push(t.datetime);
    if (!isNum(t.amount) || t.amount <= 0 || !isNum(t.distance) || t.distance <= 0)
      badNum.push(`${t.datetime}: сума ${t.amount}, км ${t.distance}`);
    if (!t.zone_manual && inArea(t.to ?? "", s.dead_end_areas ?? []) !== (t.zone === "Глухий кут"))
      badZone.push(`${t.datetime} — ${t.zone}, але «${(t.to ?? "").slice(0, 46)}»`);
    if (t.from && t.from === t.to) {
      sameAddr.push(`${t.datetime} · ${t.distance} км`);
      if (zoneAmbiguous(t, s.dead_end_areas ?? []))
        sameAddrRisky.push(`${t.datetime} · ${t.distance} км — «${t.to.slice(0, 50)}»`);
    }
    const cnt = (x: string, ch: string): number => x.split(ch).length - 1;
    if (cnt(t.to ?? "", "(") !== cnt(t.to ?? "", ")") || cnt(t.from ?? "", "(") !== cnt(t.from ?? "", ")"))
      brokenAddr.push(`${t.datetime} — «${(t.to ?? "").slice(0, 46)}»`);
    // Вінниця компактна: понад FAR_CITY_KM «по місту» майже завжди означає, що
    // локалітет призначення загубився (OCR/злипання), а з ним і зона. Ціна
    // помилки реальна: порожняк 0.3 проти 1.0 — на 30 км це 125 ₴ різниці.
    if (t.zone === "Місто" && !t.zone_manual && isNum(t.distance) && t.distance > FAR_CITY_KM)
      farCity.push(`${t.datetime} · ${t.distance} км — «${(t.to ?? "").slice(0, 50)}»`);
    if (t.pickup_km != null && (t.pickup_km < 0 || t.pickup_km > 25))
      badPickup.push(`${t.datetime}: подача ${t.pickup_km} км`);
    if (t.amount_balance != null && (t.amount_balance < 0 || t.amount_balance > t.amount))
      badBalance.push(`${t.datetime}: на баланс ${t.amount_balance} із ${t.amount}`);
    const key = `${t.datetime}|${t.amount}|${t.distance}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, n] of seen) if (n > 1) dupes.push(`${key} ×${n}`);

  add("err", `Нерозпізнаний datetime: ${badDt.length}`, badDt);
  add("err", `Некоректні числа: ${badNum.length}`, badNum);
  add("err", `Дублікати поїздок: ${dupes.length}`, dupes);
  add("err", `Зона не збігається з адресою: ${badZone.length}`, [
    ...badZone,
    ...(badZone.length ? ['Свідоме рішення? Постав "zone_manual": true у цій поїздці.'] : []),
  ]);
  // from === to — злиплі адреси парсера (полагоджено в parseOrders, лишились
  // старі записи). Полагодити текст без скріншотів неможливо, але на ГРОШІ це
  // впливає рівно через одне поле — `zone` за `to`. Тому окремо рахуємо, у
  // скількох записах зона взагалі могла б змінитись від місця розрізу: якщо в
  // нуля — попередження косметичне, і роздувати його не варто.
  if (sameAddr.length) {
    add(sameAddrRisky.length ? "warn" : "info", `Точка А = точка Б (злиплі адреси парсера): ${sameAddr.length}`, [
      sameAddrRisky.length
        ? `З них зона залежить від місця розрізу: ${sameAddrRisky.length} — перевір вручну.`
        : "Зона не залежить від місця розрізу в жодному записі → на числа не впливає, лише на текст адреси.",
      ...sameAddrRisky,
      ...sameAddr.slice(0, 12),
    ]);
  }
  add("warn", `Поламані дужки в адресі: ${brokenAddr.length}`, brokenAddr.slice(0, 12));
  add("warn", `Довга поїздка з зоною «Місто» (>${FAR_CITY_KM} км): ${farCity.length}`, [
    ...farCity,
    ...(farCity.length
      ? ['Схоже на загублений локалітет призначення. Якщо це справді місто — постав "zone_manual": true.']
      : []),
  ]);
  add("warn", `Підозріла подача: ${badPickup.length}`, badPickup);
  add("warn", `Розбивка оплати > суми: ${badBalance.length}`, badBalance);
  if (legacy.length) {
    add("warn", `Старий формат дати (без року): ${legacy.length}`, [
      `напр. «${legacy[0]}» — рік підставляється з settings.default_year (${s.default_year ?? "поточний"}).`,
      `Полагодити: npm run migrate`,
    ]);
  }

  // ── offers ─────────────────────────────────────────────────────────
  const offers: Offer[] = data.offers ?? [];
  const badOffer: string[] = [];
  for (const o of offers) {
    if (!parseDT(o.datetime, s)) badOffer.push(`«${o.datetime}» — не розпізнано`);
    if (!isNum(o.amount) || !isNum(o.distance)) badOffer.push(`${o.datetime}: сума/км не числа`);
    if (typeof o.accepted !== "boolean") badOffer.push(`${o.datetime}: accepted має бути true/false`);
  }
  add("err", `Помилки в журналі пропозицій: ${badOffer.length}`, badOffer);

  return issues;
}

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.level === "err");
}
