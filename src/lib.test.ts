// Тести формул і парсингу (node:test, вбудований у Node 22).
//   npm test
//
// Ціна помилки у цих функціях — гроші, тому кожна перевірка тут відповідає
// конкретному багу, який ми вже ловили руками.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  balanceAmount,
  breakevenZone,
  commissionOf,
  compute,
  cycleMinutes,
  deriveSlots,
  goldenRule,
  inArea,
  minGrossPerKmZone,
  refillBreakeven,
  shiftStats,
  slotPass,
  slotPassAdditive,
  slotsStats,
} from "./lib.ts";
import { dayLabel, fmtISO, gapsWithinShifts, parseDT, shiftsOf } from "./time.ts";
import { validateData } from "./validate.ts";
import { enrichOffers, filterRuleEvidence, offerStats } from "./offers.ts";
import type { Data, Settings, Slot, Trip } from "./types.ts";

const S: Settings = {
  gas_consumption_l_100km: 13.5,
  gas_price_per_l: 40,
  empty_run_coef: 0.5,
  empty_run_by_zone: { "Місто": 0.3, "Глухий кут": 1 },
  commission_uklon_pct: 18,
  commission_cashless_pct: 2,
  combined_balance_share: 0.5,
  threshold_net_per_km: 14,
  marginal_net_per_km: 10,
  target_net_per_hour: 240,
  default_year: 2026,
  shift_gap_min: 240,
  cycle_model: { base_min: 10, per_km_min: 2, by_zone: { "Глухий кут": { base_min: 12, per_km_min: 2 } } },
  dead_end_areas: ["Стрижавка"],
  live_areas: ["Центр"],
  long_haul_areas: ["Хмільник"],
};

const trip = (over: Partial<Trip> = {}): Trip => ({
  datetime: "2026-08-16 19:53",
  payment: "Готівка",
  amount: 200,
  distance: 5,
  from: "Соборна, 1",
  to: "Келецька, 100",
  zone: "Місто",
  ...over,
});

// ── Паливо, комісія, час ────────────────────────────────────────────
test("порожняк береться за ЗОНОЮ, а не глобальний", () => {
  const city = compute(trip(), S);
  const dead = compute(trip({ zone: "Глухий кут", to: "Зарічна (Стрижавка), 2" }), S);
  // 5 км × 5.4 грн/км × (1+0.3) проти × (1+1.0)
  assert.ok(Math.abs(city.gas - 5 * 5.4 * 1.3) < 1e-9);
  assert.ok(Math.abs(dead.gas - 5 * 5.4 * 2.0) < 1e-9);
});

test("комісія за вивід береться лише з безготівкової частини", () => {
  assert.equal(balanceAmount(trip({ payment: "Готівка" }), S), 0);
  assert.equal(balanceAmount(trip({ payment: "Безготівка" }), S), 200);
  // Комбінована без розбивки — оцінка з settings…
  assert.equal(balanceAmount(trip({ payment: "Комбінована" }), S), 100);
  // …а з розбивкою — факт.
  assert.equal(balanceAmount(trip({ payment: "Комбінована", amount_balance: 45 }), S), 45);
});

test("комбінована оплата ДОРОЖЧА за готівку (баг, який ми ловили)", () => {
  const cash = commissionOf(trip({ payment: "Готівка" }), S);
  const comb = commissionOf(trip({ payment: "Комбінована", amount_balance: 100 }), S);
  const card = commissionOf(trip({ payment: "Безготівка" }), S);
  assert.ok(comb > cash, "комбінована мусить платити за вивід частини");
  assert.ok(comb < card, "але менше, ніж повна безготівка");
  assert.equal(card - cash, 200 * 0.02);
});

test("cycle_model: зональні коефіцієнти мають пріоритет", () => {
  assert.equal(cycleMinutes(5, "Місто", S), 10 + 2 * 5);
  assert.equal(cycleMinutes(5, "Глухий кут", S), 12 + 2 * 5);
});

test("золоте правило по зонах різне і не усереднене", () => {
  const g = goldenRule(S);
  assert.ok(g.dead > g.city);
  assert.equal(g.city, minGrossPerKmZone(S, "Місто"));
  assert.ok(breakevenZone(S, "Глухий кут") > breakevenZone(S, "Місто"));
});

// ── Зони за адресою ─────────────────────────────────────────────────
test("inArea дивиться лише на текст у дужках і на цілі слова", () => {
  assert.equal(inArea("Зарічна (Стрижавка), 2", ["Стрижавка"]), true);
  assert.equal(inArea("Бар Бюро (Оводова, 62а)", ["Бар"]), false);
  assert.equal(inArea("Стрижавка, 2", ["Стрижавка"]), false, "поза дужками — не локалітет");
});

// ── Час і зміни ─────────────────────────────────────────────────────
test("parseDT читає обидва формати, ISO — канон", () => {
  const iso = parseDT("2026-08-16 19:53", S)!;
  const legacy = parseDT("16.08 19:53", S)!;
  assert.equal(iso.abs, legacy.abs, "legacy добирає рік із settings");
  assert.equal(fmtISO(legacy), "2026-08-16 19:53");
  assert.equal(dayLabel("2026-08-16 19:53", S), "16.08");
});

test("рік більше не губиться: серпень різних років не зливається", () => {
  const a = parseDT("2026-08-16 19:53", S)!;
  const b = parseDT("2027-08-16 19:53", S)!;
  assert.notEqual(a.abs, b.abs);
});

test("нічна зміна не ріжеться опівночі", () => {
  const items = [
    trip({ datetime: "2026-08-16 22:10" }),
    trip({ datetime: "2026-08-16 23:40" }),
    trip({ datetime: "2026-08-17 00:50" }),
    // наступного вечора — вже інша зміна
    trip({ datetime: "2026-08-17 19:00" }),
  ];
  const shifts = shiftsOf(items, (t) => t.datetime, S);
  assert.equal(shifts.length, 2);
  assert.equal(shifts[0].items.length, 3);
  assert.equal(shifts[0].label, "16.08");
});

test("інтервали не перестрибують межу зміни", () => {
  const items = [
    trip({ datetime: "2026-08-16 22:10" }),
    trip({ datetime: "2026-08-16 22:40" }),
    trip({ datetime: "2026-08-17 19:00" }),
  ];
  const gaps = gapsWithinShifts(items, (t) => t.datetime, S);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].gapMin, 30);
});

test("shiftStats: фактична ставка не вища за модельну", () => {
  const data: Data = {
    settings: S,
    trips: [
      trip({ datetime: "2026-08-16 19:00" }),
      trip({ datetime: "2026-08-16 20:00" }),
      trip({ datetime: "2026-08-16 21:30" }),
    ],
  };
  const rows = data.trips.map((t) => ({ ...t, ...compute(t, S) }));
  const st = shiftStats(rows, S);
  assert.equal(st.count, 1);
  assert.ok(st.realPh <= st.modelPh, "простій може лише знизити фактичну ставку");
  assert.ok(st.utilization <= 1);
});

// ── Слоти ───────────────────────────────────────────────────────────
const slot: Slot = {
  id: "t", name: "T", icon: "", role: "",
  price_km: 28, km_in_min: 5, min_order: 80, max_pickup_km: 2.5, city_only: true,
};

test("slotPass — семантика форми Uklon: max(дистанція, км у мінімалці)", () => {
  const r = { amount: 140, distance: 2, zone: "Місто" as const, longHaul: false };
  // 28 × max(2,5) = 140 → рівно проходить
  assert.equal(slotPass(r, slot), true);
  assert.equal(slotPass({ ...r, amount: 139 }, slot), false);
});

test("подача перевіряється лише коли відома", () => {
  const r = { amount: 300, distance: 5, zone: "Місто" as const, longHaul: false };
  assert.equal(slotPass(r, slot), true);
  assert.equal(slotPass({ ...r, pickup_km: 3 }, slot), false);
  assert.equal(slotPass({ ...r, pickup_km: 2 }, slot), true);
});

test("city_only не пускає глухий кут", () => {
  const r = { amount: 500, distance: 5, zone: "Глухий кут" as const, longHaul: false };
  assert.equal(slotPass(r, slot), false);
  assert.equal(slotPass(r, { ...slot, city_only: false, price_km_suburb: 40 }), true);
});

test("адитивна модель СЛАБША за нашу на коротких", () => {
  // 10 км: наша вимагає 28×10=280, адитивна — 80 + 28×5 = 220
  const r = { amount: 240, distance: 10, zone: "Місто" as const, longHaul: false };
  assert.equal(slotPass(r, slot), false);
  assert.equal(slotPassAdditive(r, slot), true);
});

test("deriveSlots детермінований і не вкладений за подачею", () => {
  const trips: Trip[] = [];
  for (let d = 0; d < 6; d++) {
    for (let i = 0; i < 12; i++) {
      const dist = 2 + ((i * 7) % 11);
      trips.push(
        trip({
          datetime: `2026-08-${String(10 + d).padStart(2, "0")} ${String(17 + Math.floor(i / 3)).padStart(2, "0")}:${String((i * 13) % 60).padStart(2, "0")}`,
          amount: Math.round(80 + dist * (18 + (i % 5) * 3)),
          distance: dist,
        }),
      );
    }
  }
  const rows = trips.map((t) => ({ ...t, ...compute(t, S) }));
  const a = deriveSlots(rows, S);
  const b = deriveSlots(rows, S);
  assert.deepEqual(a, b, "той самий вхід — той самий результат (сід фіксований)");
  assert.ok(a.length >= 1 && a.length <= 3);
  for (let i = 1; i < a.length; i++) {
    assert.ok(a[i].max_pickup_km > a[i - 1].max_pickup_km, "драбина за радіусом подачі");
  }
  for (const sl of a) {
    assert.ok(sl.stability, "кожен слот несе діагностику стабільності");
    assert.ok(sl.stability!.plateauLo <= sl.price_km && sl.price_km <= sl.stability!.plateauHi);
  }
});

test("слот вводиться у форму Uklon: Простий і Складний не змішуються", () => {
  // Регресія: `candidates` видавала кандидатів без ціни передмістя (→ city_only)
  // з будь-яким `km_in_min`, і звіт друкував інструкцію «Тип тарифу: Складний»
  // разом із «Лише по місту: увімк.» — таке у формі ввести НЕМОЖЛИВО:
  // тумблер живе у «Простому», а «Км у мінімалці» / ціна передмістя — у «Складному».
  const trips: Trip[] = [];
  for (let d = 0; d < 6; d++) {
    for (let i = 0; i < 12; i++) {
      const dist = 2 + ((i * 7) % 11);
      trips.push(
        trip({
          datetime: `2026-08-${String(10 + d).padStart(2, "0")} ${String(17 + Math.floor(i / 3)).padStart(2, "0")}:${String((i * 13) % 60).padStart(2, "0")}`,
          amount: Math.round(80 + dist * (18 + (i % 5) * 3)),
          distance: dist,
        }),
      );
    }
  }
  const rows = trips.map((t) => ({ ...t, ...compute(t, S) }));
  for (const sl of deriveSlots(rows, S)) {
    if (sl.city_only) {
      // Простий: немає ні «Км у мінімалці», ні ціни передмістя.
      assert.equal(sl.km_in_min, 1, `${sl.id}: city_only + км у мінімалці — не вводиться`);
      assert.equal(sl.price_km_suburb, undefined, `${sl.id}: city_only + ціна передмістя — не вводиться`);
    } else {
      // Складний: ціна передмістя мусить бути задана, інакше тупики летять без порога.
      assert.ok(sl.price_km_suburb != null, `${sl.id}: Складний без ціни передмістя`);
    }
  }
});

test("slotsStats і refillBreakeven узгоджені між собою", () => {
  const rows = [
    trip({ amount: 300, distance: 5 }),
    trip({ amount: 90, distance: 8 }),
  ].map((t) => ({ ...t, ...compute(t, S) }));
  const st = slotsStats(rows, [slot]);
  const rb = refillBreakeven(rows, [slot]);
  assert.equal(st.pass + st.cut, rows.length);
  assert.ok(rb.freedH > 0);
  assert.ok(rb.fill >= 0);
});

// ── Журнал пропозицій ───────────────────────────────────────────────
test("журнал пропозицій розрізняє правило фільтра", () => {
  const offers = [
    // 240 ₴ на 10 км: наша модель каже «не пройшло б», адитивна — «пройшло б».
    { datetime: "2026-08-30 19:12", amount: 240, distance: 10, accepted: false, source: "Фільтр" as const },
    { datetime: "2026-08-30 19:40", amount: 245, distance: 10, accepted: false, source: "Фільтр" as const },
    { datetime: "2026-08-30 20:10", amount: 250, distance: 10, accepted: true, source: "Фільтр" as const },
  ];
  const rows = enrichOffers(offers, S, [slot]);
  const ev = filterRuleEvidence(rows, [slot]);
  assert.equal(ev.decisive.length, 3);
  assert.equal(ev.votesAdditive, 3);
  assert.equal(ev.verdict, "адитивне");
  const st = offerStats(rows, S);
  assert.equal(st.n, 3);
  assert.equal(st.rejected, 2);
});

// ── Валідація ───────────────────────────────────────────────────────
test("validateData ловить биту зону, дублі й зламану дату", () => {
  const data: Data = {
    settings: S,
    trips: [
      trip({ datetime: "16 серпня", amount: 100 }),
      trip({ to: "Зарічна (Стрижавка), 2", zone: "Місто" }),
      trip({ datetime: "2026-08-16 19:53" }),
      trip({ datetime: "2026-08-16 19:53" }),
    ],
  };
  const titles = validateData(data).map((i) => i.title).join(" | ");
  assert.match(titles, /Нерозпізнаний datetime: 1/);
  assert.match(titles, /Зона не збігається/);
  assert.match(titles, /Дублікати поїздок: 1/);
});

test("чиста база не дає помилок", () => {
  const data: Data = { settings: S, trips: [trip()] };
  assert.equal(validateData(data).filter((i) => i.level === "err").length, 0);
});

test("злиплі адреси: попередження за рівнем залежить від того, чи страждає зона", () => {
  // Зона однакова за будь-якого розрізу → косметично, рівень info.
  const safe = "Космонавтів Проспект (Вінниця), Миколи Амосова Вулиця, 2ба";
  const infoIssue = validateData({
    settings: S,
    trips: [trip({ from: safe, to: safe, zone: "Місто" })],
  }).find((i) => /Точка А = точка Б/.test(i.title));
  assert.equal(infoIssue?.level, "info");

  // Розріз змінює зону (тупик лишається лише в хвості) → рівень warn.
  const risky = "Зарічна (Стрижавка), 2, Соборна Вулиця (Вінниця), 5";
  const warnIssue = validateData({
    settings: S,
    trips: [trip({ from: risky, to: risky, zone: "Глухий кут" })],
  }).find((i) => /Точка А = точка Б/.test(i.title));
  assert.equal(warnIssue?.level, "warn");
});

test("довга поїздка «по місту» позначається як підозра на загублений локалітет", () => {
  // Вінниця компактна: 20 км із зоною «Місто» майже завжди означає, що
  // локалітет призначення загубився в OCR — а з ним і порожняк 0.3 vs 1.0.
  const titles = validateData({
    settings: S,
    trips: [trip({ distance: 20, to: "12-а Вулиця", zone: "Місто" })],
  })
    .map((i) => i.title)
    .join(" | ");
  assert.match(titles, /Довга поїздка з зоною «Місто».*: 1/);

  // Свідоме рішення водія не повторює це попередження щоразу.
  const manual = validateData({
    settings: S,
    trips: [trip({ distance: 20, to: "12-а Вулиця", zone: "Місто", zone_manual: true })],
  })
    .map((i) => i.title)
    .join(" | ");
  assert.doesNotMatch(manual, /Довга поїздка з зоною «Місто»/);
});
