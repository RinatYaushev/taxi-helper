// Генератор гарного HTML-звіту (замість Excel)
import { writeFileSync } from "node:fs";
import {
  loadData,
  enrich,
  fuelPerKm,
  breakeven,
  minGrossPerKm,
  deriveModes,
  groupStats,
} from "./lib.ts";
import type { Row, Settings, Mode } from "./types.ts";

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
const money = (n: number): string => Math.round(n).toLocaleString("uk-UA");
const f1 = (n: number): string => n.toFixed(1);
const f2 = (n: number): string => n.toFixed(2);

function kpiCards(rows: Row[]): string {
  const amount = rows.reduce((a, r) => a + r.amount, 0);
  const gas = rows.reduce((a, r) => a + r.gas, 0);
  const comm = rows.reduce((a, r) => a + r.commission, 0);
  const net = rows.reduce((a, r) => a + r.net, 0);
  const km = rows.reduce((a, r) => a + r.distance, 0);
  const cards: [string, string, string][] = [
    ["Поїздок", String(rows.length), ""],
    ["Виручка", money(amount), "грн"],
    ["Чистий прибуток", money(net), "грн"],
    ["Чистий / км", f1(km ? net / km : 0), "грн/км"],
    ["Газ", f1((gas / amount) * 100), "% виручки"],
    ["Комісія", f1((comm / amount) * 100), "% виручки"],
  ];
  return cards
    .map(
      ([label, val, unit]) => `
      <div class="card">
        <div class="card-val">${val} <span class="card-unit">${unit}</span></div>
        <div class="card-label">${label}</div>
      </div>`,
    )
    .join("");
}

function decisionStrip(rows: Row[]): string {
  const recs: ["бери" | "думай" | "пропускай", string][] = [
    ["бери", "good"],
    ["думай", "warn"],
    ["пропускай", "bad"],
  ];
  const total = rows.length || 1;
  const segments = recs
    .map(([rec]) => {
      const g = rows.filter((r) => r.rec === rec);
      const pct = (g.length / total) * 100;
      return `<div class="ds-seg ds-${rec}" style="width:${pct}%" title="${rec}: ${g.length}"></div>`;
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

function insightsBox(rows: Row[], s: Settings): string {
  const npk = (rs: Row[]): number => {
    const km = rs.reduce((a, r) => a + r.distance, 0);
    const net = rs.reduce((a, r) => a + r.net, 0);
    return km ? net / km : 0;
  };
  const short = rows.filter((r) => r.distance < 7);
  const long = rows.filter((r) => r.distance >= 12);
  const city = rows.filter((r) => r.zone === "Місто");
  const dead = rows.filter((r) => r.zone === "Глухий кут");
  const cash = rows.filter((r) => r.payment === "Готівка");
  const cashless = rows.filter((r) => r.payment === "Безготівка");
  const belowThr = rows.filter((r) => r.netPerKm < s.threshold_net_per_km);
  const lostNet = rows
    .filter((r) => r.rec === "пропускай")
    .reduce((a, r) => a + r.net, 0);

  const hourOf = (r: Row) => Number(r.datetime.split(" ")[1].split(":")[0]);
  const hb = (name: string, g: Row[]): [string, Row[]] => [name, g];
  const hourBuckets: [string, Row[]][] = [
    hb("до 17:00", rows.filter((r) => hourOf(r) < 17)),
    hb("17–19", rows.filter((r) => hourOf(r) >= 17 && hourOf(r) < 19)),
    hb("19–21", rows.filter((r) => hourOf(r) >= 19 && hourOf(r) < 21)),
    hb("після 21", rows.filter((r) => hourOf(r) >= 21)),
  ].filter(([, g]) => g.length);
  const bestHour = [...hourBuckets].sort((a, b) => npk(b[1]) - npk(a[1]))[0];

  const items: string[] = [];
  items.push(
    `📏 Короткі (&lt;7 км) дають <b class="v-ok">${f1(npk(short))}</b> грн/км, а довгі (12+ км) — <b class="v-low">${f1(npk(long))}</b> грн/км. Прибуток обернено залежить від дистанції.`,
  );
  items.push(
    `🏘️ Місто: <b class="v-ok">${f1(npk(city))}</b> грн/км проти глухих кутів <b class="v-low">${f1(npk(dead))}</b> грн/км (${dead.length} поїздок у тупики).`,
  );
  items.push(
    `💳 Готівка <b>${f1(npk(cash))}</b> vs безготівка <b>${f1(npk(cashless))}</b> грн/км — тип оплати майже не вирішує.`,
  );
  if (bestHour) {
    items.push(
      `⏰ Найкраща година: <b>${bestHour[0]}</b> — ${f1(npk(bestHour[1]))} грн/км.`,
    );
  }
  items.push(
    `⚠️ Нижче порогу (${s.threshold_net_per_km} грн/км): <b class="v-low">${belowThr.length}</b> з ${rows.length} (${Math.round((belowThr.length / (rows.length || 1)) * 100)}%). На «пропускай» злито <b class="v-low">${money(lostNet)} грн</b> чистого.`,
  );
  return `
    <div class="panel">
      <h3>💡 Авто-інсайти</h3>
      <ul class="insights">${items.map((i) => `<li>${i}</li>`).join("")}</ul>
    </div>`;
}

function dailyTrend(rows: Row[]): string {
  const byDay = new Map<string, Row[]>();
  for (const r of rows) {
    const day = r.datetime.split(" ")[0];
    (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(r);
  }
  const days = [...byDay.entries()].sort((a, b) => {
    const [ad, am] = a[0].split(".").map(Number);
    const [bd, bm] = b[0].split(".").map(Number);
    return am - bm || ad - bd;
  });
  const maxNet = Math.max(...days.map(([, g]) => g.reduce((a, r) => a + r.net, 0)), 1);
  const bars = days
    .map(([day, g]) => {
      const net = g.reduce((a, r) => a + r.net, 0);
      const km = g.reduce((a, r) => a + r.distance, 0);
      const dnpk = km ? net / km : 0;
      const h = Math.max(4, (net / maxNet) * 120);
      const cls = dnpk >= 14 ? "ok" : dnpk >= 10 ? "mid" : "low";
      return `<div class="bar-col" title="${day}: ${money(net)} грн, ${f1(dnpk)} грн/км, ${g.length} поїздок">
        <div class="bar-val">${money(net)}</div>
        <div class="bar bar-${cls}" style="height:${h}px"></div>
        <div class="bar-lbl">${day}</div>
        <div class="bar-sub v-${cls}">${f1(dnpk)}</div>
      </div>`;
    })
    .join("");
  return `
    <div class="panel">
      <h3>Динаміка по днях <span class="hint">(висота — чистий грн, число знизу — чист/км)</span></h3>
      <div class="chart">${bars}</div>
    </div>`;
}

function goldenBanner(s: Settings): string {
  return `
    <div class="golden">
      <div class="golden-icon">★</div>
      <div>
        <div class="golden-title">Золоте правило</div>
        <div class="golden-body">Бери замовлення, якщо
          <b>сума&nbsp;÷&nbsp;км&nbsp;≥&nbsp;${f1(minGrossPerKm(s))}&nbsp;грн/км</b>.
          Беззбитковість палива з порожняком — ${f1(breakeven(s))} грн/км
          (паливо ${f2(fuelPerKm(s))} грн/км).</div>
      </div>
    </div>`;
}


function tripsTable(rows: Row[]): string {
  const maxNpk = Math.max(...rows.map((r) => r.netPerKm), 1);
  const body = rows
    .map((r) => {
      const barW = Math.max(0, Math.min(100, (r.netPerKm / maxNpk) * 100));
      const zoneTag =
        r.zone === "Глухий кут"
          ? `<span class="tag tag-dead">Глухий кут</span>`
          : `<span class="tag tag-city">Місто</span>`;
      return `
      <tr data-rec="${r.rec}" data-amount="${r.amount}" data-dist="${r.distance}" data-gross="${f1(r.grossPerKm)}" data-zone="${esc(r.zone)}"${r.pickup_km != null ? ` data-pickup="${r.pickup_km}"` : ""}>
        <td class="nowrap">${esc(r.datetime)}</td>
        <td>${esc(r.payment)}</td>
        <td class="num">${money(r.amount)}</td>
        <td class="num">${f2(r.distance)}</td>
        <td class="addr">${esc(r.from)}</td>
        <td class="addr">${esc(r.to)}</td>
        <td>${zoneTag}</td>
        <td class="num">${money(r.gas)}</td>
        <td class="num">${money(r.net)}</td>
        <td class="num">${f1(r.grossPerKm)}</td>
        <td class="num">
          <div class="npk"><div class="npk-bar" style="width:${barW}%"></div><span>${f1(r.netPerKm)}</span></div>
        </td>
        <td><span class="badge badge-${r.rec}">${r.rec}</span></td>
      </tr>`;
    })
    .join("");
  const headers = [
    "Дата/час", "Оплата", "Сума", "Км", "Подача", "Призначення",
    "Зона", "Газ", "Чистий", "грн/км", "Чист/км", "Дія",
  ];
  const numeric = new Set([2, 3, 7, 8, 9, 10]);
  const ths = headers
    .map(
      (h, i) =>
        `<th data-col="${i}" data-num="${numeric.has(i) ? 1 : 0}">${h}<span class="arrow"></span></th>`,
    )
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

function breakdowns(rows: Row[], thr: number): string {
  const hourOf = (r: Row) => Number(r.datetime.split(" ")[1].split(":")[0]);
  const section = (title: string, groups: [string, Row[]][]): string => {
    const body = groups
      .filter(([, g]) => g.length)
      .map(([name, g]) => {
        const st = groupStats(g, thr);
        const cls = st.netPerKm >= thr ? "ok" : st.netPerKm >= thr * 0.7 ? "mid" : "low";
        return `<tr>
          <td>${name}</td>
          <td class="num">${st.n}</td>
          <td class="num">${money(st.amount)}</td>
          <td class="num">${money(st.net)}</td>
          <td class="num"><b class="v-${cls}">${f1(st.netPerKm)}</b></td>
          <td class="num">${Math.round(st.badPct)}%</td>
        </tr>`;
      })
      .join("");
    return `
      <div class="panel">
        <h3>${title}</h3>
        <table class="mini">
          <thead><tr><th>Група</th><th>К-сть</th><th>Виручка</th><th>Чистий</th><th>Чист/км</th><th>Погані</th></tr></thead>
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
    ["Місто", rows.filter((r) => r.zone === "Місто")],
    ["Глухий кут", rows.filter((r) => r.zone === "Глухий кут")],
  ]);
  const hour = section("За годиною", [
    ["до 17:00", rows.filter((r) => hourOf(r) < 17)],
    ["17–19 (пік)", rows.filter((r) => hourOf(r) >= 17 && hourOf(r) < 19)],
    ["19–21 (вечір)", rows.filter((r) => hourOf(r) >= 19 && hourOf(r) < 21)],
    ["після 21", rows.filter((r) => hourOf(r) >= 21)],
  ]);
  const pay = section("За оплатою", [
    ["Готівка", rows.filter((r) => r.payment === "Готівка")],
    ["Безготівка", rows.filter((r) => r.payment === "Безготівка")],
    ["Комбінована", rows.filter((r) => r.payment === "Комбінована")],
  ]);
  return `<div class="grid2">${dist}${zone}</div><div class="grid2">${hour}${pay}</div>`;
}

function worstList(rows: Row[]): string {
  const worst = [...rows].sort((a, b) => a.netPerKm - b.netPerKm).slice(0, 8);
  const items = worst
    .map(
      (r) => `
      <li>
        <span class="w-npk">${f1(r.netPerKm)}</span>
        <span class="w-info">${esc(r.datetime)} · ${money(r.amount)} грн · ${f2(r.distance)} км
          ${r.zone === "Глухий кут" ? '<span class="tag tag-dead">тупик</span>' : ""}</span>
        <span class="w-route">${esc(r.from)} → ${esc(r.to)}</span>
      </li>`,
    )
    .join("");
  return `
    <div class="panel">
      <h3>🚫 Найгірші 8 (кандидати відсікати)</h3>
      <ul class="worst">${items}</ul>
    </div>`;
}

function npkOf(rs: Row[]): number {
  const km = rs.reduce((a, r) => a + r.distance, 0);
  return km ? rs.reduce((a, r) => a + r.net, 0) / km : 0;
}

// Предикат «пройде замовлення крізь режим?». Подача перевіряється лише коли
// вона відома (pickup_km); суму, дистанцію, зону й ₴/км (grossPerKm) — завжди.
function modePass(r: Row, m: Mode): boolean {
  if (r.amount < m.min_order) return false;
  if (m.max_km && r.distance > m.max_km) return false;
  if (r.pickup_km != null && r.pickup_km > m.max_pickup_km) return false;
  if (r.zone === "Місто") return r.grossPerKm >= (m.min_price_km_city ?? Infinity);
  // Глухий кут:
  if (m.city_only || m.min_price_km_suburb == null) return false;
  return r.grossPerKm >= m.min_price_km_suburb;
}

function modeBacktest(rows: Row[], m: Mode, base: number, thr: number): string {
  const pass = rows.filter((r) => modePass(r, m));
  const cut = rows.filter((r) => !modePass(r, m));
  const below = pass.filter((r) => r.netPerKm < thr).length;
  const missedGood = cut.filter((r) => r.netPerKm >= thr).length;
  const delta = npkOf(pass) - base;
  return `<div class="fx-bt">
    <div class="fx-bt-row"><span>Пройшло на історії</span>
      <b>${pass.length}/${rows.length}</b></div>
    <div class="fx-bt-row"><span>Чист/км після фільтра</span>
      <b class="v-ok">${f1(npkOf(pass))}</b>
      <span class="fx-delta">(база ${f1(base)}, ${delta >= 0 ? "+" : ""}${f1(delta)})</span></div>
    <div class="fx-bt-row"><span>Відсічено</span>
      <b>${cut.length}</b>
      <span class="fx-delta">сер. <b class="v-low">${f1(npkOf(cut))}</b> ₴/км</span></div>
    <div class="fx-bt-row"><span>❗ Прибуткових відсічено (ризик простою)</span>
      <b class="${missedGood ? "v-low" : "v-ok"}">${missedGood}</b></div>
    <div class="fx-bt-row"><span>З пройдених нижче порогу (${thr})</span>
      <b class="${below ? "v-low" : "v-ok"}">${below}</b></div>
  </div>`;
}

function modeFields(m: Mode): string {
  const row = (label: string, value: string): string =>
    `<tr><td>${label}</td><td><b>${value}</b></td></tr>`;
  // Група 1 — конкретні налаштування, які реально вписуються в Автопілот Uklon.
  const auto: string[] = [];
  auto.push(row("Тариф", m.tariff));
  auto.push(row("Мін. вартість замовлення", `${m.min_order} грн`));
  auto.push(row("Відстань подачі", `≤ ${f1(m.max_pickup_km)} км`));
  auto.push(
    row(
      "Сектори призначення",
      m.city_only ? "лише місто (без сіл)" : "місто + передмістя за ₴/км",
    ),
  );
  if (m.max_km) auto.push(row("Не брати довші", `> ${m.max_km} км`));
  if (m.tariff === "Складний" && m.min_km_in_minimum != null) {
    auto.push(row("Км у мінімалці", String(m.min_km_in_minimum)));
  }
  // Група 2 — евристика ручного рішення (в Uklon немає фільтра «₴/км»).
  const manual: string[] = [];
  manual.push(row("Місто", `≥ ${m.min_price_km_city ?? "—"} грн/км`));
  manual.push(
    row(
      "Передмістя / тупики",
      m.min_price_km_suburb != null
        ? `≥ ${m.min_price_km_suburb} грн/км`
        : "❌ не брати",
    ),
  );
  return `
    <div class="fx-group-title">⚙️ Вписати в Автопілот</div>
    <table class="fx-fields">${auto.join("")}</table>
    <div class="fx-group-title">✋ Брати вручну, якщо сума÷км ≥</div>
    <table class="fx-fields">${manual.join("")}</table>`;
}

// Головна секція: режими фільтрів «Автопілота» під рівень попиту.
function autopilotModes(rows: Row[], s: Settings): string {
  const base = npkOf(rows);
  const thr = s.threshold_net_per_km;
  const modes = deriveModes(s); // пороги ₴/км перераховані зі свіжих формул
  const always = modes.filter((m) => m.always_on);
  const switchable = modes.filter((m) => !m.always_on);

  const alwaysCards = always
    .map(
      (m) => `
      <div class="fx-card fx-always" data-mode="${m.id}">
        <div class="fx-title">${m.icon} ${esc(m.name)}
          <span class="fx-badge fx-badge-on">завжди активний</span></div>
        <div class="fx-sub">${esc(m.when)}</div>
        ${modeFields(m)}
        ${modeBacktest(rows, m, base, thr)}
        <button class="fx-preview" data-mode="${m.id}">🔎 Показати на історії</button>
      </div>`,
    )
    .join("");

  const switchCards = switchable
    .map(
      (m) => `
      <div class="fx-card" data-mode="${m.id}">
        <div class="fx-title">${m.icon} ${esc(m.name)}
          <span class="fx-badge">${esc(m.tariff)}</span></div>
        <div class="fx-sub">${esc(m.when)}</div>
        ${modeFields(m)}
        ${modeBacktest(rows, m, base, thr)}
        <button class="fx-preview" data-mode="${m.id}">🔎 Показати на історії</button>
      </div>`,
    )
    .join("");

  const deadTags = s.dead_end_areas
    .map((a) => `<span class="tag tag-dead">${esc(a)}</span>`)
    .join("");
  const liveTags = s.live_areas
    .map((a) => `<span class="tag tag-live">${esc(a)}</span>`)
    .join("");

  const days = new Set(rows.map((r) => r.datetime.split(" ")[0])).size;
  const smallSample = rows.length < 100 || days < 4;
  const disclaimer = smallSample
    ? `<div class="fx-warn">⚠️ Вибірка ще мала (<b>${rows.length}</b> поїздок за <b>${days}</b> дн.) —
        числа бектесту орієнтовні й уточнюватимуться з накопиченням даних.</div>`
    : "";

  // Дані режимів для клієнтського прев'ю (підсвітка pass/fail у таблиці поїздок).
  const modesJson = JSON.stringify(modes).replace(/</g, "\\u003c");

  return `
    <div class="panel fx-panel fx-hero">
      <div class="fx-hero-head">
        <h3>🎯 Готові фільтри для Автопілота</h3>
        <span class="hint">⚙️ = вписати в Автопілот · ✋ = евристика ручного рішення · 🔎 = підсвітити на історії</span>
      </div>
      <p class="fx-intro">Ідея: <b>мінімум простою</b>. Один фільтр працює <b>завжди</b>,
        а решту <b>перемикаєш сам</b> під попит — у пік жорсткіше й коротше (обіг),
        у затишшя нижча планка й довша подача (аби не стояти).
        Пороги ₴/км рахуються із «золотого правила» (ціна газу + комісія) і
        <b>перераховуються автоматично</b>: зміниш ціну газу — оновляться пороги,
        додаси поїздки — оновиться бектест. Зараз база без фільтра —
        <b>${f1(base)}</b> ₴/км чистими на ${rows.length} поїздках.</p>
      ${disclaimer}
      <div class="fx-always-wrap">${alwaysCards}</div>
      <div class="fx-switch-title">Перемикай під попит:</div>
      <div class="grid3 fx-grid">${switchCards}</div>
      <div class="fx-note">
        <b>Сектори призначення (whitelist):</b> додавай живі райони — ${liveTags}<br>
        <b>НЕ додавай</b> глухі кути (єдине, що реально збиткове): ${deadTags}
      </div>
      <script>window.__MODES__=${modesJson};</script>
    </div>`;
}

function render(inPath: string): string {
  const data = loadData(inPath);
  const s = data.settings;
  const rows = enrich(data);
  const thr = s.threshold_net_per_km;
  const now = new Date().toLocaleString("uk-UA");

  return `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Taxi Helper — звіт</title>
<style>
:root{
  --accent:#2E5A88; --bg:#f4f6fb; --panel:#fff; --ink:#1f2937; --muted:#6b7280;
  --good:#16a34a; --good-bg:#dcfce7; --warn:#d97706; --warn-bg:#fef3c7;
  --bad:#dc2626; --bad-bg:#fee2e2; --line:#e5e7eb;
}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  background:var(--bg);color:var(--ink);line-height:1.45}
.wrap{max-width:1180px;margin:0 auto;padding:28px 20px 64px}
header h1{margin:0 0 2px;font-size:26px}
header .sub{color:var(--muted);font-size:13px;margin-bottom:24px}
.cards{display:grid;grid-template-columns:repeat(6,1fr);gap:14px;margin-bottom:20px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;box-shadow:0 1px 2px rgba(0,0,0,.03)}
.card-val{font-size:24px;font-weight:700;color:var(--accent)}
.card-unit{font-size:12px;font-weight:500;color:var(--muted)}
.card-label{font-size:12px;color:var(--muted);margin-top:2px}
.golden{display:flex;gap:14px;align-items:center;background:linear-gradient(135deg,#eef6ff,#e6fbef);
  border:1px solid #cfe6d8;border-radius:16px;padding:18px 22px;margin-bottom:20px}
.golden-icon{font-size:34px;color:#eab308}
.golden-title{font-weight:700;color:var(--accent);font-size:14px;text-transform:uppercase;letter-spacing:.04em}
.golden-body{font-size:15px}
.golden-body b{color:var(--good);font-size:17px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px 20px;overflow:hidden;margin-bottom:16px}
.grid2 .panel{margin-bottom:0}
.panel h3{margin:0 0 14px;font-size:15px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:7px 9px;text-align:left;border-bottom:1px solid var(--line)}
th{color:var(--muted);font-weight:600;font-size:12px;white-space:nowrap;cursor:pointer;user-select:none}
th .arrow{margin-left:4px;font-size:10px;color:var(--accent)}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.nowrap{white-space:nowrap}
.addr{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#374151}
.table-wrap{overflow:auto;max-height:640px;margin:0 -20px -18px;border-top:1px solid var(--line)}
.table-wrap table{min-width:900px}
.table-wrap thead th{position:sticky;top:0;background:#f9fafb;z-index:1}
#trips tbody tr:hover{background:#f8fafc}
.mini td,.mini th{padding:6px 8px}
.mini th{cursor:default}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600}
.badge-бери{background:var(--good-bg);color:var(--good)}
.badge-думай{background:var(--warn-bg);color:var(--warn)}
.badge-пропускай{background:var(--bad-bg);color:var(--bad)}
.tag{display:inline-block;padding:1px 8px;border-radius:6px;font-size:11px;font-weight:600;margin:2px 3px 2px 0}
.tag-dead{background:#ffedd5;color:#c2410c}
.tag-live{background:#e0f2fe;color:#0369a1}
.tag-city{background:#f3f4f6;color:#4b5563}
.npk{position:relative;display:flex;align-items:center;justify-content:flex-end;gap:6px}
.npk-bar{position:absolute;left:0;top:50%;transform:translateY(-50%);height:16px;background:#dbeafe;border-radius:4px;z-index:0}
.npk span{position:relative;z-index:1}
.v-ok{color:var(--good)} .v-mid{color:var(--warn)} .v-low{color:var(--bad)}
.table-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px 16px;margin-bottom:14px}
.table-head h3{margin:0}
.filters{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.filters .search{margin-right:4px}
.fbtn{border:1px solid var(--line);background:#fff;border-radius:8px;padding:5px 11px;font-size:12px;cursor:pointer;color:var(--ink)}
.fbtn.active{background:var(--accent);color:#fff;border-color:var(--accent)}
.settings-list{list-style:none;margin:0;padding:0}
.settings-list li{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line);font-size:13px}
.settings-list span{color:var(--muted)}
.tags{margin-top:10px}
.tags-title{font-size:12px;color:var(--muted);margin-bottom:4px}
/* Готові фільтри */
.fx-hero{border:2px solid var(--accent);border-radius:18px;
  background:linear-gradient(180deg,#eef4fc 0,#fff 90px);
  box-shadow:0 6px 24px rgba(46,90,136,.14);margin-bottom:22px;padding:20px 22px}
.fx-hero-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:6px}
.fx-hero-head h3{margin:0;font-size:19px;color:var(--accent)}
.fx-always-wrap{margin-bottom:14px}
.fx-always{border:2px solid var(--good);background:linear-gradient(135deg,#ecfdf3,#f7fee7)}
.fx-badge-on{background:var(--good)}
.fx-switch-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
  color:var(--muted);margin:4px 0 10px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.grid3.fx-grid{margin-bottom:0}
.fx-intro{font-size:13.5px;margin:0 0 14px;color:var(--ink)}
.fx-grid{margin-bottom:0}
.fx-card{background:#f9fafb;border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.fx-title{font-size:15px;font-weight:700;color:var(--accent);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.fx-badge{font-size:11px;font-weight:600;background:var(--accent);color:#fff;padding:2px 8px;border-radius:999px}
.fx-sub{font-size:12.5px;color:var(--muted);margin:4px 0 10px}
.fx-fields{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:10px}
.fx-fields td{padding:6px 8px;border-bottom:1px solid var(--line)}
.fx-fields td:first-child{color:var(--muted)}
.fx-fields td:last-child{text-align:right;white-space:nowrap}
.fx-bt{background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:12.5px}
.fx-bt-row{display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:3px 0}
.fx-bt-row span:first-child{color:var(--muted)}
.fx-delta{color:var(--muted);font-weight:400}
.fx-note{margin-top:14px;font-size:12.5px;color:var(--ink);border-top:1px solid var(--line);padding-top:12px}
.fx-group-title{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:10px 0 3px}
.fx-group-title:first-child{margin-top:0}
.fx-warn{background:var(--warn-bg);border:1px solid #f4d58a;border-radius:10px;padding:9px 12px;font-size:12.5px;margin:0 0 14px}
.fx-preview{margin-top:10px;width:100%;border:1px solid var(--accent);background:#fff;color:var(--accent);border-radius:8px;padding:7px 10px;font-size:12px;font-weight:600;cursor:pointer}
.fx-preview:hover{background:#eef4fc}
.fx-preview.active{background:var(--accent);color:#fff}
.fx-now{display:inline-block;font-size:10.5px;font-weight:700;background:var(--warn-bg);color:#92600a;border:1px solid #f4d58a;padding:2px 8px;border-radius:999px;margin-left:4px}
tr.mode-cut{opacity:.32}
tr.mode-pass{background:#f0fdf4}
tr.mode-pass td:first-child{box-shadow:inset 3px 0 0 var(--good)}
.worst{list-style:none;margin:0;padding:0}
.worst li{display:grid;grid-template-columns:52px 1fr;grid-template-areas:"npk info" "npk route";
  gap:2px 12px;padding:9px 0;border-bottom:1px solid var(--line)}
.w-npk{grid-area:npk;align-self:center;font-size:20px;font-weight:700;color:var(--bad);text-align:center}
.w-info{grid-area:info;font-size:13px}
.w-route{grid-area:route;font-size:12px;color:var(--muted)}
/* Розподіл рішень */
.ds-bar{display:flex;height:16px;border-radius:8px;overflow:hidden;margin-bottom:12px;background:var(--line)}
.ds-seg{height:100%}
.ds-бери{background:var(--good)} .ds-думай{background:var(--warn)} .ds-пропускай{background:var(--bad)}
.ds-legend{display:flex;flex-direction:column;gap:6px}
.ds-item{font-size:13px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.ds-dot{width:10px;height:10px;border-radius:50%;display:inline-block}
.ds-dot-бери{background:var(--good)} .ds-dot-думай{background:var(--warn)} .ds-dot-пропускай{background:var(--bad)}
.ds-net{font-weight:700;margin-left:auto} .ds-km{color:var(--muted);min-width:66px;text-align:right}
/* Інсайти */
.insights{list-style:none;margin:0;padding:0}
.insights li{font-size:13.5px;padding:8px 0;border-bottom:1px solid var(--line)}
.insights li:last-child{border-bottom:none}
/* Бар-чарт по днях */
.hint{font-weight:400;font-size:11px;color:var(--muted)}
.chart{display:flex;align-items:flex-end;gap:10px;overflow-x:auto;padding-top:8px;min-height:170px}
.bar-col{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;min-width:46px;gap:3px}
.bar{width:26px;border-radius:6px 6px 0 0}
.bar-ok{background:var(--good)} .bar-mid{background:var(--warn)} .bar-low{background:var(--bad)}
.bar-val{font-size:11px;font-weight:600;color:var(--ink)}
.bar-lbl{font-size:11px;color:var(--muted);white-space:nowrap}
.bar-sub{font-size:12px;font-weight:700}
/* Пошук / CSV */
.search{border:1px solid var(--line);border-radius:8px;padding:5px 10px;font-size:12px;min-width:150px}
.fbtn.dl{border-color:var(--accent);color:var(--accent)}
.dropdown{position:relative;display:inline-block}
.dropdown .caret{font-size:10px}
.dropdown-menu{position:absolute;right:0;top:calc(100% + 4px);min-width:140px;background:#fff;
  border:1px solid var(--line);border-radius:10px;box-shadow:0 6px 18px rgba(0,0,0,.12);
  padding:5px;display:none;flex-direction:column;gap:2px;z-index:10}
.dropdown-menu.open{display:flex}
.dropdown-menu button{border:none;background:none;text-align:left;padding:8px 12px;border-radius:7px;
  font-size:13px;cursor:pointer;color:var(--ink);white-space:nowrap}
.dropdown-menu button:hover{background:#f3f4f6}
footer{margin-top:24px;text-align:center;color:var(--muted);font-size:12px}
@media(max-width:900px){.cards{grid-template-columns:repeat(3,1fr)}.grid2{grid-template-columns:1fr}.grid3{grid-template-columns:1fr}}
@media print{
  body{background:#fff}
  .wrap{max-width:none;padding:0}
  .filters,footer{display:none!important}
  .panel,.card,.golden{box-shadow:none;break-inside:avoid}
  .table-wrap{max-height:none;overflow:visible;margin:0;border-top:none}
  .table-wrap table{min-width:0}
  .table-wrap thead th{position:static}
}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>🚕 Taxi Helper — звіт прибутковості</h1>
    <div class="sub">Uklon · Вінниця · згенеровано ${esc(now)}</div>
  </header>
  <div class="cards">${kpiCards(rows)}</div>
  ${goldenBanner(s)}
  ${autopilotModes(rows, s)}
  <div class="grid2">${decisionStrip(rows)}${insightsBox(rows, s)}</div>
  ${dailyTrend(rows)}
  ${tripsTable(rows)}
  ${breakdowns(rows, thr)}
  ${worstList(rows)}
  <footer>Дані: data.json · формули: src/lib.ts · поріг ${thr} грн/км чистими</footer>
</div>
<script>
var curRec="all";
function applyFilters(){
  var q=(document.getElementById("search").value||"").trim().toLowerCase();
  document.querySelectorAll("#trips tbody tr").forEach(function(tr){
    var okRec=(curRec==="all"||tr.dataset.rec===curRec);
    var okQ=!q||tr.innerText.toLowerCase().indexOf(q)>-1;
    tr.style.display=(okRec&&okQ)?"":"none";
  });
}
document.querySelectorAll(".fbtn[data-f]").forEach(function(b){
  b.addEventListener("click",function(){
    document.querySelectorAll(".fbtn[data-f]").forEach(function(x){x.classList.remove("active")});
    b.classList.add("active");
    curRec=b.dataset.f;
    applyFilters();
  });
});
document.getElementById("search").addEventListener("input",applyFilters);
function downloadCSV(){
  var head=[].slice.call(document.querySelectorAll("#trips thead th"))
    .map(function(th){return th.textContent.replace(/[▲▼]/g,"").trim();});
  var lines=[head.join(";")];
  document.querySelectorAll("#trips tbody tr").forEach(function(tr){
    if(tr.style.display==="none")return;
    var cells=[].slice.call(tr.children).map(function(td){
      var t=td.innerText.replace(/\\s+/g," ").trim();
      return /[;"\\n]/.test(t)?'"'+t.replace(/"/g,'""')+'"':t;
    });
    lines.push(cells.join(";"));
  });
  var blob=new Blob(["\\ufeff"+lines.join("\\n")],{type:"text/csv;charset=utf-8"});
  var a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="trips.csv"; a.click();
  URL.revokeObjectURL(a.href);
}
function downloadPDF(){ window.print(); }
(function(){
  var btn=document.getElementById("dlBtn"), menu=document.getElementById("dlMenu");
  function close(){menu.classList.remove("open");btn.setAttribute("aria-expanded","false");}
  btn.addEventListener("click",function(e){
    e.stopPropagation();
    var open=menu.classList.toggle("open");
    btn.setAttribute("aria-expanded",open?"true":"false");
  });
  menu.querySelectorAll("[data-dl]").forEach(function(item){
    item.addEventListener("click",function(){
      if(item.dataset.dl==="csv")downloadCSV(); else downloadPDF();
      close();
    });
  });
  document.addEventListener("click",close);
  document.addEventListener("keydown",function(e){if(e.key==="Escape")close();});
})();
document.querySelectorAll("#trips thead th").forEach(function(th){
  th.addEventListener("click",function(){
    var tb=document.querySelector("#trips tbody");
    var idx=+th.dataset.col, num=th.dataset.num==="1";
    var dir=th.dataset.dir==="asc"?-1:1; th.dataset.dir=dir===1?"asc":"desc";
    document.querySelectorAll("#trips thead th .arrow").forEach(function(a){a.textContent=""});
    th.querySelector(".arrow").textContent=dir===1?"▲":"▼";
    var rows=[].slice.call(tb.querySelectorAll("tr"));
    rows.sort(function(a,b){
      var x=a.children[idx].innerText.trim(), y=b.children[idx].innerText.trim();
      if(num){return (parseFloat(x.replace(/\\s/g,""))-parseFloat(y.replace(/\\s/g,"")))*dir;}
      return x.localeCompare(y,"uk")*dir;
    });
    rows.forEach(function(r){tb.appendChild(r)});
  });
});
// --- Режими фільтрів: підказка за часом + прев'ю на історії ---
(function(){
  var modes=window.__MODES__||[];
  var byId={}; modes.forEach(function(m){byId[m.id]=m;});
  // Підказка режиму за поточним часом/днем (короткі поруч — завжди активні).
  var now=new Date(), day=now.getDay(), h=now.getHours(), weekend=(day===0||day===6);
  var sug, why;
  if(!weekend&&h>=17&&h<20){sug="rush";why="будній вечірній пік";}
  else if(h>=20&&h<23){sug="normal";why="вечірній трафік";}
  else if(weekend&&h>=11&&h<23){sug="normal";why="активні вихідні";}
  else{sug="calm";why="низький попит";}
  var sCard=document.querySelector('.fx-card[data-mode="'+sug+'"] .fx-title');
  if(sCard){var badge=document.createElement("span");badge.className="fx-now";
    badge.textContent="🔔 зараз радимо · "+why;sCard.appendChild(badge);}
  // Прев'ю: підсвітити, які історичні поїздки цей режим узяв би / відсік.
  function jsPass(m,tr){
    var amount=+tr.dataset.amount, dist=+tr.dataset.dist, gross=+tr.dataset.gross,
        zone=tr.dataset.zone, pickup=tr.dataset.pickup;
    if(amount<m.min_order)return false;
    if(m.max_km&&dist>m.max_km)return false;
    if(pickup!=null&&pickup!==""&&(+pickup)>m.max_pickup_km)return false;
    if(zone==="Місто")return gross>=(m.min_price_km_city!=null?m.min_price_km_city:Infinity);
    if(m.city_only||m.min_price_km_suburb==null)return false;
    return gross>=m.min_price_km_suburb;
  }
  var active=null;
  function clearPreview(){
    document.querySelectorAll("#trips tbody tr").forEach(function(tr){
      tr.classList.remove("mode-pass","mode-cut");});
    document.querySelectorAll(".fx-preview").forEach(function(b){b.classList.remove("active");});
    active=null;
  }
  document.querySelectorAll(".fx-preview").forEach(function(btn){
    btn.addEventListener("click",function(){
      var id=btn.dataset.mode, m=byId[id];
      if(active===id||!m){clearPreview();return;}
      clearPreview(); active=id; btn.classList.add("active");
      document.querySelectorAll("#trips tbody tr").forEach(function(tr){
        tr.classList.add(jsPass(m,tr)?"mode-pass":"mode-cut");});
      document.getElementById("trips").scrollIntoView({behavior:"smooth",block:"start"});
    });
  });
})();
</script>
</body>
</html>`;
}

const inPath = process.argv[2] ?? "data.json";
const outPath = process.argv[3] ?? "report.html";
writeFileSync(outPath, render(inPath), "utf8");
const n = loadData(inPath).trips.length;
console.log(`OK: ${n} поїздок → ${outPath}`);

