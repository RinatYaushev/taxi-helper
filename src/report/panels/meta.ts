// Панелі «Якість даних» і «Що змінилось з минулого запуску».
import type { Data, Row, Settings } from "../../types.ts";
import type { Snapshot } from "../../lib.ts";
import { shiftStats } from "../../lib.ts";
import { validateData } from "../../validate.ts";
import { shiftsOf } from "../../time.ts";
import { esc, f1, money } from "../format.ts";

/**
 * Самоперевірка вхідних даних. Логіка живе у `validate.ts` — той самий код
 * ганяє `npm run check`, тож звіт і CI не можуть розійтися в думках.
 */
export function dataQuality(data: Data, rows: Row[], s: Settings): string {
  const issues = validateData(data).map((i) => ({
    lvl: i.level,
    title: i.title,
    body: i.details.map(esc).join("<br>"),
  }));

  // Контекстні (не помилкові) спостереження — вони про повноту, не про поламаність.
  const withPickup = rows.filter((r) => r.pickup_km != null).length;
  issues.push({
    lvl: withPickup >= 20 ? "info" : "warn",
    title: `Подача (pickup_km): ${withPickup} з ${rows.length}`,
    body:
      withPickup >= 20
        ? "Достатньо для калібрування радіуса з факту."
        : "Радіус подачі у слотах — <b>розрахунок, а не факт</b>: перевірка подачі в бектесті пропускається. Найдешевше лікується журналом пропозицій.",
  });
  issues.push({
    lvl: (data.offers?.length ?? 0) >= 30 ? "info" : "warn",
    title: `Журнал пропозицій: ${data.offers?.length ?? 0} записів`,
    body:
      (data.offers?.length ?? 0) >= 30
        ? "Вибірка вже несе інформацію про відхилені замовлення."
        : "Без нього вибірка <b>цензурована</b>: ми оптимізуємо відсів, бачачи лише те, що вже прийняли.",
  });

  const shifts = shiftsOf(rows, (r) => r.datetime, s);
  const thin = shifts.filter((sh) => sh.items.length <= 3);
  if (thin.length) {
    issues.push({
      lvl: "info",
      title: `Зміни з 1–3 поїздками: ${thin.length}`,
      body: `${thin.map((x) => esc(x.label)).join(", ")} — стовпчики в «Динаміці по змінах» там шумні.`,
    });
  }
  const sh = shiftStats(rows, s);
  if (sh.utilization > 0.98) {
    issues.push({
      lvl: "warn",
      title: `Утилізація ${Math.round(sh.utilization * 100)}% — підозріло висока`,
      body: "Модель циклу майже дорівнює тривалості зміни. Або зміни рахуються надто вузько (<code>shift_gap_min</code>), або cycle_model перекалібрувати.",
    });
  }

  const body = issues
    .map(
      (i) => `<div class="dq-item dq-${i.lvl}">
        <div class="dq-title">${i.lvl === "err" ? "✖" : i.lvl === "warn" ? "▲" : "•"} ${i.title}</div>
        <div class="dq-body">${i.body}</div>
      </div>`,
    )
    .join("");
  const errs = issues.filter((i) => i.lvl === "err").length;
  return `
    <div class="panel">
      <h3>🧪 Якість даних ${errs ? `<span class="hint">— ${errs} потребує втручання</span>` : '<span class="hint">— критичних проблем немає</span>'}</h3>
      <div class="dq-grid">${body}</div>
    </div>`;
}

export function changesPanel(prev: Snapshot | null, cur: Snapshot): string {
  if (!prev) {
    return `
    <div class="panel chg-panel">
      <h3>🔁 Що змінилось з минулого запуску</h3>
      <p class="chg-empty">Це перший знімок — базлайн збережено у <code>.report-state.json</code>.</p>
    </div>`;
  }
  const badge = (d: number, digits: number, goodWhenUp: boolean | null): string => {
    if (Math.abs(d) < (digits === 0 ? 0.5 : 0.005)) return "";
    const sign = d > 0 ? "+" : "";
    let cls = "chg-neutral";
    if (goodWhenUp === true) cls = d > 0 ? "chg-up" : "chg-down";
    else if (goodWhenUp === false) cls = d > 0 ? "chg-down" : "chg-up";
    return ` <i class="${cls}">${sign}${d.toFixed(digits)}</i>`;
  };
  const pair = (a: number, b: number, digits: number, goodWhenUp: boolean | null): string => {
    const val = a.toFixed(digits) === b.toFixed(digits) ? b.toFixed(digits) : `${a.toFixed(digits)} → ${b.toFixed(digits)}`;
    return `<b>${val}</b>${badge(b - a, digits, goodWhenUp)}`;
  };

  const sigChanged = JSON.stringify(prev.sig) !== JSON.stringify(cur.sig);
  const slotRows: string[] = [];
  for (const sl of cur.slots) {
    const p = prev.slots?.find((x) => x.id === sl.id);
    if (!p) continue;
    const diffs: string[] = [];
    if (p.price_km !== sl.price_km) diffs.push(`₴/км ${p.price_km} → <b>${sl.price_km}</b>`);
    if (p.price_km_suburb !== sl.price_km_suburb)
      diffs.push(`передмістя ${p.price_km_suburb ?? "off"} → <b>${sl.price_km_suburb ?? "off"}</b>`);
    if (p.km_in_min !== sl.km_in_min) diffs.push(`К ${p.km_in_min} → <b>${sl.km_in_min}</b>`);
    if (p.min_order !== sl.min_order) diffs.push(`мін. ${p.min_order} → <b>${sl.min_order}</b>`);
    if (p.max_pickup_km !== sl.max_pickup_km)
      diffs.push(`подача ${p.max_pickup_km} → <b>${sl.max_pickup_km}</b> км`);
    if (diffs.length) slotRows.push(`<li>${esc(sl.name)}: ${diffs.join(", ")}</li>`);
  }
  const slotNote = slotRows.length
    ? `<div class="chg-note chg-note-warn"><b>⚙️ Слоти змінились</b>
        (${sigChanged ? "змінились витрати або ціль" : "нові дані зрушили підбір"}):
        <ul>${slotRows.join("")}</ul>
        ${sigChanged ? "" : "<br>Якщо витрати ті самі, а пороги стрибнули — це ознака, що оптимум плоский: дивись «плато» на картках слотів."}</div>`
    : `<div class="chg-note"><b>Слоти без змін.</b> Їхні пороги залежать від <b>витрат</b>
        і цілі, а не від кількості поїздок — нові замовлення оновлюють лише бектест.</div>`;

  const items = `
    <div class="chg-item"><span>Поїздки</span>${pair(prev.trips, cur.trips, 0, null)}</div>
    <div class="chg-item"><span>Змін у вибірці</span>${pair(prev.shifts ?? 0, cur.shifts, 0, null)}</div>
    <div class="chg-item"><span>₴/год модель</span>${pair(prev.modelPh ?? 0, cur.modelPh, 0, true)}</div>
    <div class="chg-item"><span>₴/год факт</span>${pair(prev.realPh ?? 0, cur.realPh, 0, true)}</div>
    <div class="chg-item"><span>База ₴/км (чист)</span>${pair(prev.base, cur.base, 2, true)}</div>
    <div class="chg-item"><span>Чистий разом</span>${pair(prev.net, cur.net, 0, true)} грн</div>
    <div class="chg-item"><span>Слоти приймають</span>${pair(prev.slotStat?.pass ?? 0, cur.slotStat.pass, 0, null)}</div>
    <div class="chg-item"><span>Треба заповнити</span>${pair((prev.slotStat?.fill ?? 0) * 100, cur.slotStat.fill * 100, 0, false)}%</div>`;

  return `
    <div class="panel chg-panel">
      <h3>🔁 Що змінилось з минулого запуску</h3>
      <div class="chg-grid">${items}</div>
      ${slotNote}
      <p class="hint">Порівняння з попереднім <code>npm run generate</code> ·
        попередній стан від ${esc(new Date(prev.at).toLocaleString("uk-UA"))}.</p>
    </div>`;
}

/** Підвал зі зведенням масштабів — щоб цифри звіту мали контекст. */
export function footerNote(rows: Row[], s: Settings): string {
  const sh = shiftStats(rows, s);
  return `Дані: data.json · формули: src/lib.ts · рішення за ₴/год ·
    ${rows.length} поїздок за ${sh.count} змін · ${f1(sh.realH)} год на лінії ·
    ${money(rows.reduce((a, r) => a + r.net, 0))} ₴ чистими`;
}

