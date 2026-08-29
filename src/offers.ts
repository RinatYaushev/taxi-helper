// Журнал пропозицій: аналіз того, чого не бачать `trips`.
//
// Уся оптимізація фільтрів досі спиралась на **цензуровану** вибірку: у базі
// лежать тільки прийняті поїздки, вже відібрані інтуїцією водія. Через це
// «Треба заповнити» лишалось вимогою, а не виміром, радіус подачі виводився з
// ціни, а правило фільтра (max чи адитивне) не було на чому перевірити.
//
// `data.offers` закриває всі три питання одним форматом запису.
import type { Offer, Settings, Slot, Zone } from "./types.ts";
import {
  baseTargetPh,
  compute,
  inArea,
  slotPass,
  slotPassAdditive,
  slotPassPrice,
} from "./lib.ts";

export interface OfferRow extends Offer {
  zoneR: Zone;
  net: number;
  timeMin: number;
  ph: number;
  /** Надлишок над резервною ставкою, грн: чистий − T×цикл/60. */
  surplus: number;
  /** Що сказали б наші слоти (об'єднання за АБО). */
  ourYes: boolean;
}

/** Достатньо записів, щоб числа перестали бути анекдотом. */
export const MIN_OFFERS = 30;

export function enrichOffers(offers: Offer[], s: Settings, slots: Slot[]): OfferRow[] {
  const T = baseTargetPh(s);
  return offers.map((o) => {
    const zoneR: Zone = o.zone ?? (o.to && inArea(o.to, s.dead_end_areas) ? "Глухий кут" : "Місто");
    const c = compute(
      {
        datetime: o.datetime,
        // Тип оплати в пропозиції не показують — рахуємо як готівку (комісія за
        // вивід тут не при чому, а 2% не змінюють рішення).
        payment: "Готівка",
        amount: o.amount,
        distance: o.distance,
        from: "",
        to: o.to ?? "",
        zone: zoneR,
      },
      s,
    );
    return {
      ...o,
      zoneR,
      net: c.net,
      timeMin: c.timeMin,
      ph: c.netPerHour,
      surplus: c.net - (T * c.timeMin) / 60,
      ourYes: slots.some((sl) => slotPass({ ...o, zone: zoneR, longHaul: c.longHaul }, sl)),
    };
  });
}

export interface OfferStats {
  n: number;
  accepted: number;
  rejected: number;
  acceptRate: number;
  /** Скільки записів мають подачу — головна причина вести журнал. */
  pickupKnown: number;
  pickupAvg: number;
  pickupP90: number;
  /** ₴/год того, від чого водій відмовився (зважено за часом). */
  rejectedPh: number;
  acceptedPh: number;
  /** Матриця згоди «наші слоти × рішення водія». */
  agree: {
    bothYes: number;
    /** Слоти беруть, водій відмовився — кандидати «фільтр надто м'який». */
    ourYesHisNo: number;
    /** Слоти ріжуть, водій узяв і не пошкодував (ph ≥ ціль) — ціна звуження. */
    ourNoHisYesGood: number;
    ourNoHisYesBad: number;
    bothNo: number;
  };
  /** Скільки надлишку слоти лишили б на столі (грн) серед показаних пропозицій. */
  surplusMissed: number;
}

export function offerStats(rows: OfferRow[], s: Settings): OfferStats {
  const T = baseTargetPh(s);
  const acc = rows.filter((r) => r.accepted);
  const rej = rows.filter((r) => !r.accepted);
  const ph = (rs: OfferRow[]): number => {
    const m = rs.reduce((a, r) => a + r.timeMin, 0);
    return m ? rs.reduce((a, r) => a + r.net, 0) / (m / 60) : 0;
  };
  const pk = rows.map((r) => r.pickup_km).filter((x): x is number => x != null).sort((a, b) => a - b);
  const missed = rows.filter((r) => !r.ourYes && r.surplus > 0);
  return {
    n: rows.length,
    accepted: acc.length,
    rejected: rej.length,
    acceptRate: rows.length ? acc.length / rows.length : 0,
    pickupKnown: pk.length,
    pickupAvg: pk.length ? pk.reduce((a, b) => a + b, 0) / pk.length : 0,
    pickupP90: pk.length ? pk[Math.min(pk.length - 1, Math.floor(0.9 * pk.length))] : 0,
    rejectedPh: ph(rej),
    acceptedPh: ph(acc),
    agree: {
      bothYes: rows.filter((r) => r.ourYes && r.accepted).length,
      ourYesHisNo: rows.filter((r) => r.ourYes && !r.accepted).length,
      ourNoHisYesGood: rows.filter((r) => !r.ourYes && r.accepted && r.ph >= T).length,
      ourNoHisYesBad: rows.filter((r) => !r.ourYes && r.accepted && r.ph < T).length,
      bothNo: rows.filter((r) => !r.ourYes && !r.accepted).length,
    },
    surplusMissed: missed.reduce((a, r) => a + r.surplus, 0),
  };
}

export type RuleVerdict = "max" | "адитивне" | "невідомо";

export interface RuleEvidence {
  /** Пропозиції, на яких дві моделі дають різну відповідь. */
  decisive: Array<{ offer: OfferRow; maxSays: boolean; addSays: boolean }>;
  /** Показана пропозиція, яку наша (max) модель НЕ пропустила б → адитивне. */
  votesAdditive: number;
  /** Показана пропозиція, яку адитивна модель НЕ пропустила б → max. */
  votesMax: number;
  verdict: RuleVerdict;
}

/**
 * Перевірка правила фільтра **фактами, а не очікуванням рідкісного випадку**.
 *
 * Офіційна стаття Uklon описує «Км у мінімалці» двома несумісними прикладами:
 *   • адитивно: `сума ≥ мін + ₴/км × max(0, d − K)`;
 *   • мультиплікативно (наша модель): `сума ≥ ₴/км × max(d, K)`.
 * Різниця не академічна: за адитивного прочитання крізь ціновий поріг лізуть
 * тупики нижче цілі, і whitelist секторів перестає бути запасним варіантом.
 *
 * Логіка тесту: якщо фільтр **показав** замовлення, воно пройшло справжнє
 * правило. Беремо ті пропозиції, де дві моделі розходяться, і дивимось, яка з
 * них пояснює факт показу. Кожна така пропозиція — один голос.
 *
 * ⚠️ Передумова: слоти в застосунку на момент запису збігалися з тими, що
 * передані сюди. Тому в журналі є поле `source` — рахуємо лише `"Фільтр"`
 * (Ефір і «додаткові» замовлення платформа підкидає **поза** фільтром).
 */
export function filterRuleEvidence(rows: OfferRow[], slots: Slot[]): RuleEvidence {
  const shown = rows.filter((r) => (r.source ?? "Фільтр") === "Фільтр");
  const decisive: RuleEvidence["decisive"] = [];
  let votesAdditive = 0;
  let votesMax = 0;
  for (const o of shown) {
    const probe = { ...o, zone: o.zoneR, longHaul: false };
    const maxSays = slots.some((sl) => slotPass(probe, sl));
    const addSays = slots.some((sl) => slotPassAdditive(probe, sl));
    if (maxSays === addSays) continue;
    decisive.push({ offer: o, maxSays, addSays });
    if (addSays && !maxSays) votesAdditive++;
    if (maxSays && !addSays) votesMax++;
  }
  const verdict: RuleVerdict =
    votesAdditive >= 3 && votesAdditive > votesMax * 3
      ? "адитивне"
      : votesMax >= 3 && votesMax > votesAdditive * 3
        ? "max"
        : "невідомо";
  return { decisive, votesAdditive, votesMax, verdict };
}

/**
 * Скільки потоку коштує радіус подачі — те, що досі виводилось із теорії.
 * Для кожного радіуса рахуємо, яка частка пропозицій, що проходять слот
 * **за ціною**, лишається в межах радіуса.
 */
export function pickupCoverage(
  rows: OfferRow[],
  slot: Slot,
  radii = [1.5, 2, 2.5, 3, 3.5, 4],
): Array<{ km: number; keptPct: number; lostSurplus: number }> {
  const priced = rows.filter((r) =>
    slotPassPrice({ amount: r.amount, distance: r.distance, zone: r.zoneR, longHaul: false }, slot),
  );
  const known = priced.filter((r) => r.pickup_km != null);
  if (!known.length) return [];
  return radii.map((km) => {
    const kept = known.filter((r) => (r.pickup_km as number) <= km);
    const lost = known.filter((r) => (r.pickup_km as number) > km);
    return {
      km,
      keptPct: (kept.length / known.length) * 100,
      lostSurplus: lost.reduce((a, r) => a + Math.max(0, r.surplus), 0),
    };
  });
}

