// Оглядові панелі: KPI, золоте правило, розподіл рішень, інсайти, динаміка.
import type { Row, Settings } from "../../types.ts";
import {
  baseTargetPh,
  breakevenZone,
  fuelPerKm,
  goldenRule,
  marginalTargetPh,
  npkOf,
  phOf,
  shiftStats,
} from "../../lib.ts";
import { hourOf, shiftsOf } from "../../time.ts";
import { esc, f1, f2, money } from "../format.ts";

export function kpiCards(rows: Row[], s: Settings): string {
  const amount = rows.reduce((a, r) => a + r.amount, 0);
  const gas = rows.reduce((a, r) => a + r.gas, 0);
  const comm = rows.reduce((a, r) => a + r.commission, 0);
  const net = rows.reduce((a, r) => a + r.net, 0);
  const km = rows.reduce((a, r) => a + r.distance, 0);
  const sh = shiftStats(rows, s);
  const cards: Array<[string, string, string, string]> = [
    ["Поїздок", String(rows.length), "", `${sh.count} змін`],
    ["Виручка", money(amount), "грн", ""],
    ["Чистий прибуток", money(net), "грн", ""],
    ["Чистий / км", f1(km ? net / km : 0), "грн/км", ""],
    ["Газ", f1(amount ? (gas / amount) * 100 : 0), "% виручки", ""],
    ["Комісія", f1(amount ? (comm / amount) * 100 : 0), "% виручки", ""],
  ];
  const plain = cards
    .map(
      ([label, val, unit, note]) => `
      <div class="card">
        <div class="card-val">${val} <span class="card-unit">${unit}</span></div>
        <div class="card-label">${label}</div>
        ${note ? `<div class="card-note">${esc(note)}</div>` : ""}
      </div>`,
    )
    .join("");

  // Дві ставки поруч — інакше водій порівнює модельні ₴/год із гаманцем і не сходиться.
  const dual = `
    <div class="card card-dual">
      <div class="card-val">${money(sh.modelPh)} <span class="card-unit">грн/год</span></div>
      <div class="card-label">Чистий / год — <b>модель</b></div>
      <div class="card-note">Сума виміряних циклів (${f1(sh.modelH)} год). У цій шкалі
        задана ціль ${Math.round(baseTargetPh(s))} і порівнюються слоти.</div>
    </div>
    <div class="card card-dual">
      <div class="card-val">${money(sh.realPh)} <span class="card-unit">грн/год</span></div>
      <div class="card-label">Чистий / год — <b>факт зміни</b></div>
      <div class="card-note">Уся тривалість змін (${f1(sh.realH)} год), включно з
        ${f1(sh.idleH)} год пауз, яких модель не бачить. Утилізація ${Math.round(sh.utilization * 100)}%.</div>
    </div>`;
  // Два ряди окремо: інакше auto-fit ставить 7 карток у ряд і восьма висить сама,
  // а короткі картки розтягуються під висоту тих, що з поясненням.
  return `<div class="cards cards-metrics">${plain}</div>
    <div class="cards cards-rates">${dual}</div>`;
}

export function goldenBanner(s: Settings): string {
  const g = goldenRule(s);
  return `
    <div class="golden">
      <div class="golden-icon">★</div>
      <div>
        <div class="golden-title">Золоте правило</div>
        <div class="golden-body">Бери, якщо <b>сума ÷ км ≥ ${f1(g.city)} грн/км</b> у місті
          і <b>≥ ${f1(g.dead)}</b> у глухий кут.</div>
        <div class="golden-note">Різні числа не примха: порожняк назад із села
          (×${f2(1 + (s.empty_run_by_zone?.["Глухий кут"] ?? s.empty_run_coef))}) дорожчий за міський
          (×${f2(1 + (s.empty_run_by_zone?.["Місто"] ?? s.empty_run_coef))}).
          Беззбитковість палива: місто ${f1(breakevenZone(s, "Місто"))}, тупик
          ${f1(breakevenZone(s, "Глухий кут"))} грн/км (саме паливо — ${f2(fuelPerKm(s))} грн/км).
          Раніше тут стояло одне усереднене число з <code>empty_run_coef</code>, якого не має
          жодна зона.</div>
      </div>
    </div>`;
}

export function decisionStrip(rows: Row[]): string {
  const recs: Array<["бери" | "думай" | "пропускай", string]> = [
    ["бери", "good"],
    ["думай", "warn"],
    ["пропускай", "bad"],
  ];
  const total = rows.length || 1;
  const segments = recs
    .map(([rec]) => {
      const g = rows.filter((r) => r.rec === rec);
      return `<div class="ds-seg ds-${rec}" style="width:${(g.length / total) * 100}%" title="${rec}: ${g.length}"></div>`;
    })
    .join("");
  const legend = recs
    .map(([rec, cls]) => {
      const g = rows.filter((r) => r.rec === rec);
      const net = g.reduce((a, r) => a + r.net, 0);
      const km = g.reduce((a, r) => a + r.distance, 0);
      return `<div class="ds-item">
        <span class="ds-dot ds-dot-${rec}"></span>
        <b>${rec}</b> · ${g.length} шт · ${Math.round((g.length / total) * 100)}%
        <span class="ds-net v-${cls === "good" ? "ok" : cls === "warn" ? "mid" : "low"}">${money(net)} грн</span>
        <span class="ds-km">${f1(km)} км</span>
      </div>`;
    })
    .join("");
  return `
    <div class="panel">
      <h3>Розподіл рішень</h3>
      <div class="ds-bar">${segments}</div>
      <div class="ds-legend">${legend}</div>
    </div>`;
}

export function insightsBox(rows: Row[], s: Settings): string {
  const npk = npkOf;
  const short = rows.filter((r) => r.distance < 7);
  const long = rows.filter((r) => r.distance >= 12);
  const city = rows.filter((r) => r.zone === "Місто");
  const dead = rows.filter((r) => r.zone === "Глухий кут");
  const cash = rows.filter((r) => r.payment === "Готівка");
  const cashless = rows.filter((r) => r.payment === "Безготівка");
  const comb = rows.filter((r) => r.payment === "Комбінована");
  const below = rows.filter((r) => r.rec !== "бери");
  const lostNet = rows.filter((r) => r.rec === "пропускай").reduce((a, r) => a + r.net, 0);

  const hb = (name: string, g: Row[]): [string, Row[]] => [name, g];
  const h = (r: Row): number => hourOf(r.datetime, s);
  const hourBuckets: Array<[string, Row[]]> = [
    hb("до 17:00", rows.filter((r) => h(r) < 17)),
    hb("17–19", rows.filter((r) => h(r) >= 17 && h(r) < 19)),
    hb("19–21", rows.filter((r) => h(r) >= 19 && h(r) < 21)),
    hb("після 21", rows.filter((r) => h(r) >= 21)),
  ].filter(([, g]) => g.length);
  const bestHour = [...hourBuckets].sort((a, b) => npk(b[1]) - npk(a[1]))[0];
  const worstHour = [...hourBuckets].sort((a, b) => npk(a[1]) - npk(b[1]))[0];

  const items: string[] = [];
  const lossMaking = rows.filter((r) => r.net < 0).length;
  items.push(
    `📏 Короткі (&lt;7 км) дають <b class="v-ok">${f1(npk(short))}</b> грн/км, довгі (12+ км) — <b class="v-low">${f1(npk(long))}</b> грн/км.
     Але <b>в мінус не йде ${lossMaking === 0 ? "жодна" : String(lossMaking)}</b>: 12+ км це ${money(phOf(long))} грн/год,
     тобто питання не «збиткова», а «гірша за твій час».`,
  );
  items.push(
    `🏘️ Місто: <b class="v-ok">${f1(npk(city))}</b> грн/км проти глухих кутів <b class="v-low">${f1(npk(dead))}</b> грн/км (${dead.length} поїздок у тупики).`,
  );
  items.push(
    `💳 Готівка <b>${f1(npk(cash))}</b> · безготівка <b>${f1(npk(cashless))}</b>${comb.length ? ` · комбінована <b>${f1(npk(comb))}</b>` : ""} грн/км — тип оплати майже не вирішує.`,
  );
  if (bestHour && worstHour) {
    const gap = npk(bestHour[1]) - npk(worstHour[1]);
    // Розкид ВСЕРЕДИНІ груп зазвичай у рази більший за розрив МІЖ ними,
    // тож подавати «найкращу годину» як пораду — видавати шум за сигнал.
    const spread = Math.sqrt(
      rows.reduce((a, r) => a + (r.netPerKm - npk(rows)) ** 2, 0) / (rows.length || 1),
    );
    items.push(
      gap >= spread / 2
        ? `⏰ Найкраще вікно: <b>${bestHour[0]}</b> — ${f1(npk(bestHour[1]))} грн/км (n=${bestHour[1].length}).`
        : `⏰ Година виїзду <b>майже не впливає</b>: розрив між найкращим (${bestHour[0]}, ${f1(npk(bestHour[1]))}) і найгіршим (${worstHour[0]}, ${f1(npk(worstHour[1]))}) вікном — лише ${f1(gap)} грн/км при розкиді ±${f1(spread)} всередині груп. Планувати графік за цим не варто.`,
    );
  }
  const sh = shiftStats(rows, s);
  items.push(
    `🕒 Медіанна зміна: <b>${f1(sh.medianTrips)}</b> поїздок, <b>${f1(sh.medianHours)}</b> год,
     <b>${money(sh.medianNet)}</b> грн чистими. Зміна рахується розривом &gt;${(s.shift_gap_min ?? 240) / 60} год,
     тому нічна не ріжеться навпіл опівночі.`,
  );
  items.push(
    `⚠️ Нижче цілі ${Math.round(baseTargetPh(s))} ₴/год: <b class="v-low">${below.length}</b> з ${rows.length} (${Math.round((below.length / (rows.length || 1)) * 100)}%). На «пропускай» (менше ${Math.round(marginalTargetPh(s))} ₴/год) злито <b class="v-low">${money(lostNet)} грн</b> чистого.`,
  );
  return `
    <div class="panel">
      <h3>💡 Авто-інсайти</h3>
      <ul class="insights">${items.map((i) => `<li>${i}</li>`).join("")}</ul>
    </div>`;
}

/** Динаміка по ЗМІНАХ (не по календарних днях — нічна зміна лишається однією). */
export function shiftTrend(rows: Row[], s: Settings): string {
  const shifts = shiftsOf(rows, (r) => r.datetime, s);
  const maxNet = Math.max(...shifts.map((sh) => sh.items.reduce((a, r) => a + r.net, 0)), 1);
  const target = baseTargetPh(s);
  const marginal = marginalTargetPh(s);
  const bars = shifts
    .map((sh) => {
      const g = sh.items;
      const net = g.reduce((a, r) => a + r.net, 0);
      const ph = phOf(g);
      const height = Math.max(4, (net / maxNet) * 120);
      const cls = ph >= target ? "ok" : ph >= marginal ? "mid" : "low";
      const thin = g.length <= 3 ? ` <span class="bar-thin" title="мало даних">·${g.length}</span>` : "";
      return `<div class="bar-col" title="${esc(sh.label)}: ${money(net)} грн, ${Math.round(ph)} ₴/год, ${g.length} поїздок">
        <div class="bar-val">${money(net)}</div>
        <div class="bar bar-${cls}" style="height:${height}px"></div>
        <div class="bar-lbl">${esc(sh.label)}${thin}</div>
        <div class="bar-sub v-${cls}">${Math.round(ph)}</div>
      </div>`;
    })
    .join("");
  return `
    <div class="panel">
      <h3>Динаміка по змінах <span class="hint">(висота — чистий грн, число знизу — ₴/год за моделлю; ·N — зміна з малою вибіркою)</span></h3>
      <div class="chart">${bars}</div>
    </div>`;
}
