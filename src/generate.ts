// Генератор Excel-калькулятора (аналог generate.py) через exceljs
import ExcelJS from "exceljs";
import {
  loadData,
  compute,
  fuelPerKm,
  breakeven,
  minGrossPerKm,
  avg,
  round,
} from "./lib.ts";
import type { Row } from "./types.ts";

// ---------- стилі ----------
type Fill = ExcelJS.Fill;
const solid = (argb: string): Fill => ({
  type: "pattern",
  pattern: "solid",
  fgColor: { argb },
});
const HDR = solid("FF2E5A88");
const CFG = solid("FFFFF2CC");
const GOOD = solid("FFC6EFCE");
const BAD = solid("FFFFC7CE");
const SUBH = solid("FFDDEBF7");
const HDRF: Partial<ExcelJS.Font> = { color: { argb: "FFFFFFFF" }, bold: true };
const TITLE: Partial<ExcelJS.Font> = { bold: true, size: 14, color: { argb: "FF2E5A88" } };
const BOLD: Partial<ExcelJS.Font> = { bold: true };
const thin: ExcelJS.Border = { style: "thin", color: { argb: "FFBBBBBB" } };
const BORDER: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };
const CENTER: Partial<ExcelJS.Alignment> = { horizontal: "center", vertical: "middle" };

function todayName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-result.xlsx`;
}

async function build(inPath: string, outPath: string): Promise<[number, number]> {
  const data = loadData(inPath);
  const s = data.settings;
  const rows: Row[] = data.trips.map((t) => ({ ...t, ...compute(t, s) }));

  const wb = new ExcelJS.Workbook();

  // ---------------- Налаштування ----------------
  const ws = wb.addWorksheet("Налаштування");
  ws.getCell("A1").value = "Налаштування (джерело — data.json)";
  ws.getCell("A1").font = TITLE;
  const cfgRows: [string, string | number, string][] = [
    ["Параметр", "Значення", "Одиниці / коментар"],
    ["Витрата ГБО (газ)", s.gas_consumption_l_100km, "л/100 км"],
    ["Ціна газу", s.gas_price_per_l, "грн/л"],
    ["Коеф. порожнього пробігу", s.empty_run_coef, "частка порожняку від корисного км"],
    ["Комісія Uklon", s.commission_uklon_pct, "%"],
    ["Комісія за вивід безготівки", s.commission_cashless_pct, "%, лише для безготівки"],
    ["Поріг 'хорошої' поїздки", s.threshold_net_per_km, "грн/км чистими"],
  ];
  cfgRows.forEach((r, i) => {
    const row = i + 3;
    ws.getCell(row, 1).value = r[0];
    ws.getCell(row, 2).value = r[1];
    ws.getCell(row, 3).value = r[2];
    if (row === 3) {
      for (let c = 1; c <= 3; c++) {
        ws.getCell(row, c).fill = HDR;
        ws.getCell(row, c).font = HDRF;
      }
    } else {
      ws.getCell(row, 2).fill = CFG;
      ws.getCell(row, 2).font = BOLD;
    }
    for (let c = 1; c <= 3; c++) ws.getCell(row, c).border = BORDER;
  });
  ws.getCell("A11").value = "Собівартість палива, грн/км";
  ws.getCell("B11").value = round(fuelPerKm(s));
  ws.getCell("A12").value = "Собівартість з порожняком, грн/км";
  ws.getCell("B12").value = round(breakeven(s));
  for (const r of [11, 12]) {
    ws.getCell(r, 1).font = BOLD;
    ws.getCell(r, 2).font = BOLD;
  }
  ws.getCell("A14").value =
    "⚠ Ці значення генеруються з data.json. Прав JSON і перезапусти generate.";
  ws.getCell("A14").font = { italic: true, color: { argb: "FFB00000" } };
  ws.getColumn(1).width = 36;
  ws.getColumn(2).width = 14;
  ws.getColumn(3).width = 40;

  // ---------------- Поїздки ----------------
  const t = wb.addWorksheet("Поїздки");
  const headers = [
    "Дата/час", "Оплата", "Сума, грн", "Відстань, км", "Подача",
    "Призначення", "Зона", "Газ, грн", "Комісія, грн", "Чистий, грн",
    "грн/км", "Чистий грн/км", "Оцінка", "Рекоменд.",
  ];
  headers.forEach((h, j) => {
    const cell = t.getCell(1, j + 1);
    cell.value = h;
    cell.fill = HDR;
    cell.font = HDRF;
    cell.alignment = CENTER;
    cell.border = BORDER;
  });
  rows.forEach((r, i) => {
    const row = i + 2;
    const vals = [
      r.datetime, r.payment, round(r.amount), round(r.distance), r.from,
      r.to, r.zone, round(r.gas), round(r.commission), round(r.net),
      round(r.grossPerKm), round(r.netPerKm), r.rating, r.rec,
    ];
    vals.forEach((v, j) => (t.getCell(row, j + 1).value = v));
  });
  const last = rows.length + 1;
  for (let i = 2; i <= last; i++) {
    for (let j = 1; j <= 14; j++) {
      const cell = t.getCell(i, j);
      cell.border = BORDER;
      if ([2, 3, 4, 7, 8, 9, 10, 11, 12, 13, 14].includes(j)) cell.alignment = CENTER;
      if ([3, 4, 8, 9, 10, 11, 12].includes(j)) cell.numFmt = "0.00";
    }
  }
  if (last >= 2) {
    t.addConditionalFormatting({
      ref: `M2:M${last}`,
      rules: [
        { type: "cellIs", operator: "equal", formulae: ['"OK"'], style: { fill: GOOD }, priority: 1 },
        { type: "cellIs", operator: "equal", formulae: ['"погана"'], style: { fill: BAD }, priority: 2 },
      ],
    });
    t.addConditionalFormatting({
      ref: `N2:N${last}`,
      rules: [
        { type: "cellIs", operator: "equal", formulae: ['"бери"'], style: { fill: GOOD }, priority: 1 },
        { type: "cellIs", operator: "equal", formulae: ['"думай"'], style: { fill: CFG }, priority: 2 },
        { type: "cellIs", operator: "equal", formulae: ['"пропускай"'], style: { fill: BAD }, priority: 3 },
      ],
    });
  }
  [13, 12, 10, 12, 30, 30, 12, 10, 11, 11, 9, 13, 10, 11].forEach(
    (w, j) => (t.getColumn(j + 1).width = w),
  );
  t.views = [{ state: "frozen", ySplit: 1 }];

  // ---------------- Аналіз ----------------
  const a = wb.addWorksheet("Аналіз");
  a.getCell("A1").value = "Аналіз поїздок";
  a.getCell("A1").font = TITLE;
  const by = (pred: (r: Row) => boolean) => rows.filter(pred);
  const totalAmount = rows.reduce((x, r) => x + r.amount, 0);
  const totalGas = rows.reduce((x, r) => x + r.gas, 0);
  const totalComm = rows.reduce((x, r) => x + r.commission, 0);
  const totalNet = rows.reduce((x, r) => x + r.net, 0);
  const totalKm = rows.reduce((x, r) => x + r.distance, 0);
  const cash = by((r) => r.payment === "Готівка");
  const cashless = by((r) => r.payment === "Безготівка");
  const combo = by((r) => r.payment === "Комбінована");
  const city = by((r) => r.zone === "Місто");
  const dead = by((r) => r.zone === "Глухий кут");
  const bad = by((r) => r.rating === "погана");
  const ok = by((r) => r.rating === "OK");
  const npk = (arr: Row[]) => round(avg(arr.map((r) => r.netPerKm)));

  const blocks: [string, number | null][] = [
    ["ЗАГАЛЬНЕ", null],
    ["К-сть поїздок", rows.length],
    ["Сума валова, грн", round(totalAmount)],
    ["Комісія всього, грн", round(totalComm)],
    ["Витрати на газ, грн", round(totalGas)],
    ["ЧИСТИЙ прибуток, грн", round(totalNet)],
    ["Пробіг клієнтів, км", round(totalKm)],
    ["Середній ЧИСТИЙ грн/км", npk(rows)],
    ["Чистий грн/км (загальний)", totalKm ? round(totalNet / totalKm) : 0],
    ["Середній чистий за поїздку, грн", round(avg(rows.map((r) => r.net)))],
    ["Частка газу у виручці, %", totalAmount ? round((totalGas / totalAmount) * 100, 1) : 0],
    ["Частка комісії у виручці, %", totalAmount ? round((totalComm / totalAmount) * 100, 1) : 0],
    ["", null],
    ["ЗА ОПЛАТОЮ (сер. чистий грн/км)", null],
    ["Готівка", npk(cash)],
    ["Безготівка", npk(cashless)],
    ["Комбінована", npk(combo)],
    ["", null],
    ["ЗА ЗОНОЮ", null],
    ["Місто — к-сть", city.length],
    ["Місто — сер. чистий грн/км", npk(city)],
    ["Глухий кут — к-сть", dead.length],
    ["Глухий кут — сер. чистий грн/км", npk(dead)],
    ["", null],
    ["ЯКІСТЬ ПОТОКУ", null],
    ["OK поїздок", ok.length],
    ["Поганих (нижче порогу)", bad.length],
    ["Частка поганих, %", rows.length ? round((bad.length / rows.length) * 100, 1) : 0],
  ];
  blocks.forEach(([label, value], i) => {
    const row = i + 3;
    a.getCell(row, 1).value = label;
    if (value === null) {
      a.getCell(row, 1).font = BOLD;
      a.getCell(row, 1).fill = SUBH;
    } else {
      a.getCell(row, 2).value = value;
      a.getCell(row, 2).font = BOLD;
    }
  });
  a.getColumn(1).width = 34;
  a.getColumn(2).width = 14;

  // ---------------- Фільтри ----------------
  const f = wb.addWorksheet("Фільтри");
  f.getCell("A1").value = "Фільтри для Автопілота Uklon";
  f.getCell("A1").font = TITLE;
  const flt = s.filters;
  const be = breakeven(s);
  f.getCell("A3").value = "Собівартість палива, грн/км";
  f.getCell("B3").value = round(fuelPerKm(s));
  f.getCell("A4").value = "Собівартість з порожняком (беззбитковість), грн/км";
  f.getCell("B4").value = round(be);
  for (const r of [3, 4]) {
    f.getCell(r, 1).font = BOLD;
    f.getCell(r, 2).font = BOLD;
    f.getCell(r, 2).fill = CFG;
  }
  f.getCell("A5").value = "★ ЗОЛОТЕ ПРАВИЛО: мін. валова ціна, грн/км";
  f.getCell("B5").value = round(minGrossPerKm(s), 1);
  f.getCell("A5").font = { bold: true, size: 12, color: { argb: "FFB00000" } };
  f.getCell("B5").font = { bold: true, size: 12, color: { argb: "FFB00000" } };
  f.getCell("B5").fill = GOOD;
  f.getCell("C5").value = "= сума ÷ км. Нижче — не бери!";
  f.getCell("C5").font = { italic: true };

  f.getCell("A6").value = "Три профілі рішення (приймати/пропускати)";
  f.getCell("A6").font = BOLD;
  f.getCell("A6").fill = SUBH;
  const profHdr = ["Тип", "Довжина, км", "Макс. подача, км", "Мін. грн/км", "Кінцева точка"];
  profHdr.forEach((h, j) => {
    const c = f.getCell(7, j + 1);
    c.value = h;
    c.fill = HDR;
    c.font = HDRF;
    c.alignment = CENTER;
    c.border = BORDER;
  });
  const nMin = round(be * flt.normal_price_km_mult, 1);
  const lMin = round(be * flt.long_price_km_mult, 1);
  const profRows: string[][] = [
    ["Коротка", `до ${flt.short_max_km}`, `≤ ${flt.short_max_pickup_km}`, "висока (базовий тариф)", "будь-яка в місті"],
    ["Звичайна", `${flt.short_max_km}–${flt.normal_max_km}`, `≤ ${flt.normal_max_pickup_km}`, `≥ ${nMin}`, "НЕ глухий кут"],
    ["Довга", `${flt.normal_max_km}+`, `≤ ${flt.long_max_pickup_km}`, `≥ ${lMin}`, "НЕ село / тупик"],
  ];
  profRows.forEach((pr, i) => {
    pr.forEach((val, j) => {
      const c = f.getCell(i + 8, j + 1);
      c.value = val;
      c.border = BORDER;
      if (j !== 0 && j !== 4) c.alignment = CENTER;
    });
  });

  f.getCell("A12").value = "Що виставити в Автопілоті";
  f.getCell("A12").font = BOLD;
  f.getCell("A12").fill = SUBH;
  const ap: [string, string | number][] = [
    ["Мінімальна вартість замовлення, грн", flt.autopilot_min_order],
    ["Макс. відстань подачі, км", flt.normal_max_pickup_km],
    ["Готівка + Безготівка", "приймати обидві"],
    ["Фільтр 'Мені по дорозі'", "тримати на кінець зміни (уникати тупиків)"],
  ];
  ap.forEach(([label, val], i) => {
    const row = i + 13;
    f.getCell(row, 1).value = label;
    f.getCell(row, 2).value = val;
    f.getCell(row, 2).font = BOLD;
    f.getCell(row, 2).fill = CFG;
  });

  f.getCell("A18").value = "Глухі кути (обережно з довгими туди):";
  f.getCell("A18").font = BOLD;
  f.getCell("B18").value = s.dead_end_areas.join(", ");
  f.getCell("A19").value = "Живі зони (гарне повернення):";
  f.getCell("A19").font = BOLD;
  f.getCell("B19").value = s.live_areas.join(", ");
  f.getCell("A21").value =
    "Правило: довгу поїздку (10+ км) береш тільки якщо кінцева — жива зона або грн/км явно вище порогу.";
  f.getCell("A21").font = { italic: true, color: { argb: "FFB00000" } };
  f.getColumn(1).width = 42;
  for (const col of [2, 3, 4, 5]) f.getColumn(col).width = 20;

  // ---------------- Інструкція ----------------
  const h = wb.addWorksheet("Інструкція");
  h.getCell("A1").value = "Як користуватись";
  h.getCell("A1").font = TITLE;
  const lines = [
    "1. Усі дані — у файлі data.json (налаштування + список поїздок).",
    "2. Додаєш нову поїздку — вписуєш об'єкт у масив 'trips':",
    '   {"datetime":"17.08 19:30","payment":"Готівка","amount":150,',
    '    "distance":5.2,"from":"...","to":"...","zone":"Місто"}',
    "   payment: Готівка | Безготівка | Комбінована",
    "   zone:    Місто | Глухий кут",
    "3. Запускаєш: npm run generate",
    "4. Відкриваєш свіжий *-result.xlsx.",
    "",
    "Щоб змінити ставки/поріг — прав секцію 'settings' у data.json.",
    "Глухий кут = напрямок, звідки важко взяти зворотне замовлення.",
  ];
  lines.forEach((ln, i) => (h.getCell(i + 3, 1).value = ln));
  h.getColumn(1).width = 80;

  await wb.xlsx.writeFile(outPath);
  return [rows.length, totalNet];
}

const inPath = process.argv[2] ?? "data.json";
const outPath = process.argv[3] ?? todayName();
const [n, net] = await build(inPath, outPath);
console.log(`OK: ${n} поїздок → ${outPath} | чистий прибуток: ${net.toFixed(2)} грн`);

