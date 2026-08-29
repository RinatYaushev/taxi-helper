// Разова міграція data.json до канонічної схеми.
//
//   node src/migrate.ts            # показує, що зміниться
//   node src/migrate.ts --write    # застосовує (бекап у data.json.bak)
//
// Що робить:
//  1. `datetime` "DD.MM HH:MM" → "YYYY-MM-DD HH:MM". Без року ключ дня зливав
//     серпень різних років, а сортування давало випадковий порядок.
//  2. Прибирає `settings.modes` і `settings.time_model` — обидва мертві:
//     режими бектестились правилом, якого у формі Uklon немає, а time_model
//     замінена виміряною cycle_model.
//  3. Додає нові налаштування з безпечними значеннями за замовчуванням.
import { loadData, saveData } from "./lib.ts";
import { defaultYear, fmtISO, parseDT } from "./time.ts";

const write = process.argv.includes("--write");
const path = process.argv.find((a) => a.endsWith(".json")) ?? "data.json";

const data = loadData(path);
const s = data.settings as Record<string, unknown> & typeof data.settings;

// Рік беремо з settings, а якщо його ще немає — з поточної дати.
const year = defaultYear(s);
let converted = 0;
for (const t of data.trips) {
  if (/^\d{4}-/.test(t.datetime)) continue;
  const st = parseDT(t.datetime, { default_year: year });
  if (!st) {
    console.log(`  ⚠️ не розпізнано: «${t.datetime}» — лишаю як є`);
    continue;
  }
  const next = fmtISO(st);
  if (converted < 3) console.log(`  ${t.datetime} → ${next}`);
  t.datetime = next;
  converted++;
}
for (const o of data.offers ?? []) {
  if (/^\d{4}-/.test(o.datetime)) continue;
  const st = parseDT(o.datetime, { default_year: year });
  if (st) { o.datetime = fmtISO(st); converted++; }
}

const removed: string[] = [];
if ("modes" in s) { delete s.modes; removed.push("settings.modes (4 режими — правило, якого немає у формі)"); }
if ("time_model" in s) { delete s.time_model; removed.push("settings.time_model (замінена cycle_model)"); }

const added: string[] = [];
if (s.default_year == null) { s.default_year = year; added.push(`default_year=${year}`); }
if (s.shift_gap_min == null) { s.shift_gap_min = 240; added.push("shift_gap_min=240"); }
if (s.combined_balance_share == null) { s.combined_balance_share = 0.5; added.push("combined_balance_share=0.5"); }

console.log(`\nДат сконвертовано: ${converted}${converted > 3 ? " (показано перші 3)" : ""}`);
if (removed.length) console.log(`Видалено: \n  - ${removed.join("\n  - ")}`);
if (added.length) console.log(`Додано: ${added.join(", ")}`);

if (write) {
  saveData(data, path);
  console.log(`\n✅ Записано ${path} (бекап: ${path}.bak)`);
} else {
  console.log(`\ndry-run. Додай --write, щоб застосувати.`);
}

