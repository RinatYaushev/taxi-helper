// Таблиця поїздок, зведення по групах, найгірші.
import type { Row, Settings } from "../../types.ts";
import { baseTargetPh, groupStats, marginalTargetPh, phOf } from "../../lib.ts";
import { fmtShort, hourOf } from "../../time.ts";
import { esc, f1, f2, money } from "../format.ts";

export function tripsTable(rows: Row[], s: Settings): string {
  const maxNpk = Math.max(...rows.map((r) => r.netPerKm), 1);
  const body = rows
    .map((r) => {
      const barW = Math.max(0, Math.min(100, (r.netPerKm / maxNpk) * 100));
      const zoneTag = r.longHaul
        ? `<span class="tag tag-haul">Дальняк</span>`
        : r.zone === "Глухий кут"
          ? `<span class="tag tag-dead">Глухий кут</span>`
          : `<span class="tag tag-city">Місто</span>`;
      return `
      <tr data-rec="${r.rec}" data-amount="${r.amount}" data-dist="${r.distance}" data-zone="${esc(r.zone)}" data-longhaul="${r.longHaul ? 1 : 0}"${r.pickup_km != null ? ` data-pickup="${r.pickup_km}"` : ""}>
        <td class="nowrap">${esc(fmtShort(r.datetime, s))}</td>
        <td>${esc(r.payment)}</td>
        <td class="num">${money(r.amount)}</td>
        <td class="num">${f2(r.distance)}</td>
        <td class="num${r.pickup_km == null ? " dim" : ""}">${r.pickup_km != null ? f1(r.pickup_km) : "—"}</td>
        <td class="addr">${esc(r.from)}</td>
        <td class="addr">${esc(r.to)}</td>
        <td>${zoneTag}</td>
        <td class="num">${money(r.gas)}</td>
        <td class="num">${money(r.net)}</td>
        <td class="num">${f1(r.grossPerKm)}</td>
        <td class="num">
          <div class="npk"><div class="npk-bar" style="width:${barW}%"></div><span>${f1(r.netPerKm)}</span></div>
        </td>
        <td class="num">${money(r.netPerHour)}</td>
        <td><span class="badge badge-${r.rec}">${r.rec}</span></td>
      </tr>`;
    })
    .join("");
  // Колонка «Подача, км» стоїть навіть коли порожня — щоб діра в даних була
  // видимою, а не невидимою. Раніше заголовок «Подача» стояв над адресою
  // ЗВІДКИ і плутався з радіусом подачі.
  const headers = [
    "Дата/час", "Оплата", "Сума", "Км", "Подача, км", "Звідки", "Куди",
    "Зона", "Газ", "Чистий", "грн/км", "Чист/км", "₴/год", "Дія",
  ];
  const numeric = new Set([2, 3, 4, 8, 9, 10, 11, 12]);
  const ths = headers
    .map((h, i) => `<th data-col="${i}" data-num="${numeric.has(i) ? 1 : 0}">${h}<span class="arrow"></span></th>`)
    .join("");
  return `
    <div class="panel">
      <div class="table-head">
        <h3>Поїздки (${rows.length})</h3>
        <div class="filters">
          <input id="search" class="search" type="search" placeholder="🔍 адреса / дата…">
          <button class="fbtn active" data-f="all">Усі</button>
          <button class="fbtn" data-f="бери">🟢 бери</button>
          <button class="fbtn" data-f="думай">🟡 думай</button>
          <button class="fbtn" data-f="пропускай">🔴 пропускай</button>
          <div class="dropdown">
            <button id="dlBtn" class="fbtn dl" aria-haspopup="true" aria-expanded="false">⬇ Завантажити <span class="caret">▾</span></button>
            <div class="dropdown-menu" id="dlMenu" role="menu">
              <button data-dl="csv" role="menuitem">📄 CSV</button>
              <button data-dl="pdf" role="menuitem">🧾 PDF</button>
            </div>
          </div>
        </div>
      </div>
      <div class="table-wrap">
        <table id="trips"><thead><tr>${ths}</tr></thead><tbody>${body}</tbody></table>
      </div>
    </div>`;
}

export function breakdowns(rows: Row[], s: Settings): string {
  const target = baseTargetPh(s);
  const marginal = marginalTargetPh(s);
  const h = (r: Row): number => hourOf(r.datetime, s);
  const section = (title: string, groups: Array<[string, Row[]]>): string => {
    const body = groups
      .filter(([, g]) => g.length)
      .map(([name, g]) => {
        const st = groupStats(g);
        const ph = phOf(g);
        const cls = ph >= target ? "ok" : ph >= marginal ? "mid" : "low";
        return `<tr>
          <td>${esc(name)}</td>
          <td class="num">${st.n}</td>
          <td class="num">${money(st.amount)}</td>
          <td class="num">${money(st.net)}</td>
          <td class="num">${f1(st.netPerKm)}</td>
          <td class="num"><b class="v-${cls}">${money(ph)}</b></td>
          <td class="num">${Math.round(st.badPct)}%</td>
        </tr>`;
      })
      .join("");
    return `
      <div class="panel">
        <h3>${esc(title)}</h3>
        <table class="mini">
          <thead><tr><th>Група</th><th>К-сть</th><th>Виручка</th><th>Чистий</th><th>Чист/км</th><th>₴/год</th><th>Погані</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  };

  const dist = section("За дистанцією", [
    ["Коротка (<3 км)", rows.filter((r) => r.distance < 3)],
    ["Середня (3–7 км)", rows.filter((r) => r.distance >= 3 && r.distance < 7)],
    ["Довга (7–12 км)", rows.filter((r) => r.distance >= 7 && r.distance < 12)],
    ["Дуже довга (12+ км)", rows.filter((r) => r.distance >= 12)],
  ]);
  const zone = section("За зоною", [
    ["Місто", rows.filter((r) => r.zone === "Місто" && !r.longHaul)],
    ["Глухий кут", rows.filter((r) => r.zone === "Глухий кут" && !r.longHaul)],
    ["Дальняк (міжміс.)", rows.filter((r) => r.longHaul)],
  ]);
  const hour = section("За годиною", [
    ["до 17:00", rows.filter((r) => h(r) < 17)],
    ["17–19 (пік)", rows.filter((r) => h(r) >= 17 && h(r) < 19)],
    ["19–21 (вечір)", rows.filter((r) => h(r) >= 19 && h(r) < 21)],
    ["після 21", rows.filter((r) => h(r) >= 21)],
  ]);
  const pay = section("За оплатою", [
    ["Готівка", rows.filter((r) => r.payment === "Готівка")],
    ["Безготівка", rows.filter((r) => r.payment === "Безготівка")],
    ["Комбінована", rows.filter((r) => r.payment === "Комбінована")],
  ]);
  return `<div class="grid2">${dist}${zone}</div><div class="grid2">${hour}${pay}</div>`;
}

export function worstList(rows: Row[], s: Settings): string {
  const T = Math.round(baseTargetPh(s));
  // Сортуємо за ₴/год, а не ₴/км: рішення ухвалюється за вартістю часу.
  const worst = [...rows].sort((a, b) => a.netPerHour - b.netPerHour).slice(0, 8);
  const items = worst
    .map(
      (r) => `
      <li>
        <span class="w-npk">${Math.round(r.netPerHour)}</span>
        <span class="w-info">${esc(fmtShort(r.datetime, s))} · ${money(r.amount)} грн · ${f2(r.distance)} км
          · ${f1(r.netPerKm)} ₴/км
          ${r.zone === "Глухий кут" ? '<span class="tag tag-dead">тупик</span>' : ""}
          ${r.longHaul ? '<span class="tag tag-dead">дальняк</span>' : ""}</span>
        <span class="w-route">${esc(r.from)} → ${esc(r.to)}</span>
      </li>`,
    )
    .join("");
  return `
    <div class="panel">
      <h3>🚫 Найгірші 8 за ₴/год (кандидати відсікати)</h3>
      <p class="fx-intro fx-intro-sm">Велике число зліва — <b>чистими за годину</b>.
        Ціль — ${T} ₴/год. Це та сама метрика, за якою працюють слоти, тому список
        збігається з тим, що фільтр відсіює. Жодна з них не збиткова —
        вони просто <b>гірші за твій час</b>.</p>
      <ul class="worst">${items}</ul>
    </div>`;
}

