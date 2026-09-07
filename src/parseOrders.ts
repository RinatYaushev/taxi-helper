// Парсер OCR-тексту архівних замовлень Uklon → нові поїздки в data.json.
//
// Використання:
//   swift ocr.swift ~/Desktop/screens > /tmp/ocr.txt   # спершу OCR тексту
//   node src/parseOrders.ts            # dry-run: показує, що додасться (нічого не пише)
//   node src/parseOrders.ts --write    # дописує НОВІ поїздки (дедуп за datetime) у data.json
//   node src/parseOrders.ts /шлях/ocr.txt [--write]
//
// Далі: `npm run update-pay` проставить тип оплати за кольором іконки.
//
// Якорі парсингу (надійні): дата "DD міс. HH:MM", сума перед "₴", дистанція "N,NN км".
// Адреси збираються злиттям перенесених рядків за балансом дужок; призначення (to) —
// остання адреса. Зона визначається автоматично через inArea(to, dead_end_areas).
import { existsSync, readFileSync } from "node:fs";
import { loadData, saveData, inArea } from "./lib.ts";
import { defaultYear, parseDT } from "./time.ts";
import type { Trip, Zone, Payment } from "./types.ts";

const MONTH: Record<string, string> = { січ: "01", лют: "02", бер: "03", квіт: "04", трав: "05", черв: "06", лип: "07", серп: "08", вер: "09", жовт: "10", лист: "11", груд: "12" };

const pad = (n: number): string => String(n).padStart(2, "0");

/** Правдоподібна сума: місто ≈ 40–1200 грн. Якщо OCR дав завелике число (шум
 *  від іконки оплати зліва, напр. "9111"), відкидаємо провідні цифри → "111". */
function normFare(n: number): number | null {
  if (n >= 40 && n <= 1200) return n;
  const s = String(n);
  for (let cut = 1; cut < s.length; cut++) {
    const v = Number(s.slice(cut));
    if (v >= 40 && v <= 1200) return v;
  }
  return null;
}

/** Парсить рядок розбивки оплати "Оплата замовлення" (детальний екран):
 *    "66 ₴ готівкою, 45 ₴ на баланс"  → { amount: 111, balance: 45, payment: "Комбінована" }
 *    "111 ₴ готівкою"                 → { amount: 111, balance: 0,  payment: "Готівка" }
 *    "111 ₴ на баланс"                → { amount: 111, balance: 111, payment: "Безготівка" }
 *  Це НАЙНАДІЙНІШЕ джерело суми: не залежить від шуму іконки оплати зліва
 *  (напр. "9111"→111), бо сума = арифметика частин. Заодно однозначно дає тип
 *  оплати **і розмір безготівкової частини** — саме з неї береться комісія за
 *  вивід (раніше ця частина губилась, і «Комбінована» рахувалась дешевшою). */
function parsePaymentBreakdown(
  lines: string[],
): { amount: number; balance: number; payment: Payment } | null {
  for (const ln of lines) {
    if (/Рух коштів|Транзакці/i.test(ln)) continue; // секція історії балансу — не оплата
    const hasCash = /готівк/i.test(ln);
    const hasBalance = /на баланс|безготів/i.test(ln);
    if (!hasCash && !hasBalance) continue;
    const nums = [...ln.matchAll(/(\d{2,4})\s*₴/g)].map((m) => +m[1]);
    if (nums.length < 1 || nums.length > 3) continue;
    const amount = nums.reduce((a, b) => a + b, 0);
    if (amount < 40 || amount > 2000) continue;
    const payment: Payment = hasCash && hasBalance ? "Комбінована" : hasCash ? "Готівка" : "Безготівка";
    // Порядок у рядку: спершу готівка, потім баланс — беремо останнє число.
    const balance =
      payment === "Комбінована" ? nums[nums.length - 1] : payment === "Безготівка" ? amount : 0;
    return { amount, balance, payment };
  }
  return null;
}

/** Чи рядок — точно НЕ адреса (UI-хром/мапа/статус-бар/сміття OCR).
 *  Раніше тут була позитивна перевірка (рядок мав збігтись з відомим
 *  ключовим словом — Вулиця/Шосе/ТЦ/...), і вона мовчки викидала легітимні
 *  рядки без ключових слів: голий номер будинку ("20", "15"), назви без
 *  розпізнаного типу вулиці ("Госпіталь Ветеранів Війни"), елементи
 *  доадресного тексту. Викинутий рядок не потрапляв у `joinAddrs`, і той
 *  зшивав докупи ДВІ РІЗНІ адреси через "хвіст-кому" — на виході лишалась
 *  ОДНА адреса замість двох, і блок ішов у «проблемні» (справжній інцидент:
 *  9 блоків 03/06.09.2026 через саме цей механізм). Тепер приймаємо все, що
 *  не є явним сміттям — позитивний список ключових слів більше не потрібен. */
function isJunk(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  if (/^\*{2,}/.test(t)) return true;
  if (/\$/.test(t)) return true; // статус-бар "(40• $"
  if (/^\(?\d{1,3}\s*[•·*)]/.test(t)) return true; // "(38)•$", "(45 *"
  if (/tall|tatill|4G|3G|LTE|^H$|^T\b/.test(t)) return true;
  if (/^[•·.…\s]+$/.test(t)) return true;
  if (/^[A-Za-zА-Яа-яІЇЄҐіїєґ]{1,2}[-–—]?$/.test(t)) return true; // короткий OCR-артефакт типу "O-"
  if (/^Mi\s*9\s*SE$/.test(t)) return true;
  if (/Деталі замовлення|ID замовлення|Архівне|Рух коштів|Транзакці|Зміни|Активност|Google|Баланс|Оплата/.test(t)) return true;
  if (/\d+\s*₴/.test(t)) return true;
  if (/\d+[.,]\d+\s*км/i.test(t)) return true;
  if (/(серп|лип|черв|вер|січ|лют|бер|квіт|трав|жовт|лист|груд)\./.test(t)) return true;
  if (/^\d{1,2}:\d{2}/.test(t)) return true;
  return false;
}

/** Нормалізує адресу: прибирає зайві пробіли, кому в кінці й **лагодить дужки**.
 *  OCR регулярно губить одну з дужок, і тоді адреса виглядає як
 *  «Вулиця, 1)» або «Київська (Вінниця), 16 (Літинська», що ламає і читабельність,
 *  і `inArea` (яка дивиться саме на текст у дужках). */
function cleanAddr(t: string): string {
  let s = t.trim().replace(/\s+/g, " ");
  const count = (ch: string): number => (s.match(ch === "(" ? /\(/g : /\)/g) || []).length;
  // Зайва закриваюча в кінці — просто відрізаємо (початок фрази загубив OCR).
  while (count(")") > count("(") && /\)\s*$/.test(s)) s = s.replace(/\)\s*$/, "").trim();
  // Якщо закриваючих усе ще більше — прибираємо провідну, вона без пари.
  while (count(")") > count("(")) s = s.replace(/\)/, "").trim();
  // Бракує закриваючої — дописуємо, щоб локалітет у дужках лишився читаним.
  while (count("(") > count(")")) s += ")";
  return s.replace(/[,\s]+$/, "");
}

/** Скільки OCR-рядків максимум може займати одна адреса.
 *  Без цієї межі незакрита дужка зліплювала В УСІ наступні рядки — так
 *  народжувались поїздки з `from === to` (перевір панель «Якість даних»). */
const MAX_MERGE = 2;

/** Зливає перенесені адресні рядки (незбалансовані дужки / хвіст-кома /
 *  хвіст-«Вихід» / "(" на початку наступного). Хвіст-«Вихід» покриває типовий
 *  розрив Uklon «...Вихід» + «Центральний»/«На ... Шосе» на окремому рядку —
 *  без ключового слова в другій половині цей розрив нічим іншим не зловити. */
function joinAddrs(arr: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    let cur = arr[i].trim();
    let merged = 0;
    while (i + 1 < arr.length && merged < MAX_MERGE) {
      const next = arr[i + 1].trim();
      const opens = (cur.match(/\(/g) || []).length;
      const closes = (cur.match(/\)/g) || []).length;
      if (opens > closes || /,\s*$/.test(cur) || /Вихід\s*$/i.test(cur) || /^\(/.test(next)) { cur += " " + next; i++; merged++; }
      else break;
    }
    out.push(cleanAddr(cur));
  }
  return out.filter(Boolean);
}

interface Block { file: string; lines: string[] }

function readBlocks(ocrText: string): Block[] {
  const blocks: Block[] = [];
  let cur: Block | null = null;
  for (const ln of ocrText.split("\n")) {
    const m = ln.match(/^===== (.*) =====$/);
    if (m) { cur = { file: m[1], lines: [] }; blocks.push(cur); }
    else if (cur) cur.lines.push(ln);
  }
  return blocks;
}

interface Parsed { trip: Trip; file: string; ok: boolean; viaBreakdown: boolean }

function parseBlock(b: Block, dead: string[], year: number): Parsed {
  const L = b.lines;
  let datetime: string | null = null;
  for (const ln of L) {
    const m = ln.match(/(\d{1,2})\s+(січ|лют|бер|квіт|трав|черв|лип|серп|вер|жовт|лист|груд)\.?\s+(\d{1,2}):(\d{2})/);
    // Канон — ISO з роком: без нього ключ дня зливає серпень різних років.
    if (m) { datetime = `${year}-${MONTH[m[2]]}-${pad(+m[1])} ${pad(+m[3])}:${m[4]}`; break; }
  }
  if (!datetime) {
    // Uklon не показує дату для замовлень "сьогодні" — лише час. Тоді дату
    // беремо з ІМЕНІ файлу скріна (macOS: "Screenshot YYYY-MM-DD at HH.MM.SS"),
    // а сам час замовлення шукаємо як "голий" рядок HH:MM. Статус-бар годинник
    // на скрінах завжди йде зі сміттям поруч ("23:440", "23:45 C", "23:45 0°"),
    // а справжній час замовлення — чистий рядок без жодних інших символів.
    const fileDate = b.file.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (fileDate) {
      for (const ln of L) {
        const m = ln.trim().match(/^(\d{1,2}):(\d{2})$/);
        if (m) { datetime = `${fileDate[1]}-${fileDate[2]}-${fileDate[3]} ${pad(+m[1])}:${m[2]}`; break; }
      }
    }
  }
  // дистанція (км без урахування регістру)
  let kmIdx = -1;
  let distance: number | null = null;
  for (let i = 0; i < L.length; i++) {
    const m = L[i].match(/(\d+)[.,](\d+)\s*км/i);
    if (m) { distance = parseFloat(`${m[1]}.${m[2]}`); kmIdx = i; break; }
  }
  if (distance == null) {
    for (let i = 0; i < L.length; i++) {
      const m = L[i].match(/(\d+)\s*км/i);
      if (m) { distance = parseFloat(m[1]); kmIdx = i; break; }
    }
  }
  // сума: два незалежні джерела зі своїми режимами відмови — узгоджуємо їх.
  //   • верхнє число біля ₴: страждає від шуму іконки зліва ("9111"→111 через normFare);
  //   • розбивка оплати: OCR інколи ОБРІЗАЄ частину ("260 готівкою" без "35 на баланс")
  //     або плутає число балансу — тоді сума занижена.
  const bd = parsePaymentBreakdown(L);
  let topRaw: number | null = null;
  if (kmIdx >= 0) {
    for (let i = kmIdx; i >= 0 && i >= kmIdx - 4; i--) {
      const m = L[i].match(/(\d{2,5})\s*₴/);
      if (m) { topRaw = +m[1]; break; }
    }
  }
  const topAmount = topRaw != null ? normFare(topRaw) : null;
  const topClean = topRaw != null && topRaw >= 40 && topRaw <= 1200; // не потребувало зрізання

  let amount: number | null = null;
  let payViaBreakdown = false; // чи розбивка достовірно пояснює ВСЮ суму (→ звідти й тип оплати)
  if (topAmount != null && bd) {
    if (topAmount === bd.amount) { amount = topAmount; payViaBreakdown = true; }      // збіг → впевнено
    else if (topClean) { amount = topAmount; }                                        // розбивку обрізало → віримо верху
    else { amount = bd.amount; payViaBreakdown = true; }                              // верх сильно зашумлений → віримо розбивці
  } else if (topAmount != null) {
    amount = topAmount;
  } else if (bd) {
    amount = bd.amount; payViaBreakdown = true;
  }
  if (amount == null && kmIdx >= 0) {
    // Ширший fallback: у вікні перед км беремо рядок БЕЗ літер і без "$"
    // (OCR інколи розбиває "210 ₴" → "210" + ") ₴", лишає zero-width символи).
    for (let i = kmIdx - 1; i >= 0 && i >= kmIdx - 8; i--) {
      const t = L[i].trim();
      if (!t || /\$/.test(t) || /[A-Za-zА-Яа-яІЇЄҐіїєґ]/.test(t)) continue;
      const m = t.match(/(\d{2,5})/);
      if (m) { const v = normFare(+m[1]); if (v != null) { amount = v; break; } }
    }
  }
  if (amount == null) {
    for (const ln of L) { const m = ln.match(/(\d{2,5})\s*₴/); if (m) { amount = normFare(+m[1]); break; } }
  }
  // адреси до km
  const limit = kmIdx >= 0 ? kmIdx : L.length;
  const addrLines: string[] = [];
  for (let i = 0; i < limit; i++) if (!isJunk(L[i])) addrLines.push(L[i]);
  const joined = joinAddrs(addrLines);
  // Екран замовлення завжди показує ДВІ адреси. Якщо ми витягли лише одну —
  // це збій розпізнавання, а не поїздка «сама в себе». Раніше тут стояло
  // `to = joined[0]`, і такі блоки мовчки писались у data.json з from === to,
  // а `zone` виводилась із випадкової адреси. Тепер блок іде в «проблемні».
  const from = joined[0] ?? "";
  const to = joined.length > 1 ? joined[joined.length - 1] : "";
  const zone: Zone = inArea(to, dead) ? "Глухий кут" : "Місто";

  const ok = !!datetime && amount != null && distance != null && !!to && from !== to;
  const payment: Payment = payViaBreakdown && bd ? bd.payment : "Безготівка";
  const trip: Trip = {
    datetime: datetime ?? "",
    // Тип оплати з розбивки лише коли вона достовірно пояснює всю суму (payViaBreakdown).
    // Інакше плейсхолдер; update-pay уточнить за кольором іконки.
    payment,
    amount: amount ?? 0,
    // Безготівкову частину зберігаємо саме тут: комісія за вивід береться з неї,
    // а не з усієї суми.
    ...(payViaBreakdown && bd && payment === "Комбінована" ? { amount_balance: bd.balance } : {}),
    distance: distance ?? 0,
    from,
    to,
    zone,
  };
  return { trip, file: b.file, ok, viaBreakdown: payViaBreakdown };
}

// ── main ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const write = args.includes("--write");
const ocrPath = args.find((a) => !a.startsWith("--")) ?? "/tmp/ocr.txt";

// Без цієї перевірки крок конвеєра падав сирим ENOENT-стектрейсом — а причина
// майже завжди одна: не зроблено крок OCR.
if (!existsSync(ocrPath)) {
  console.error(`❌ Немає файлу з OCR-текстом: ${ocrPath}`);
  console.error("   Спершу зроби OCR:  swift ocr.swift ~/Desktop/screens > /tmp/ocr.txt");
  console.error("   Або вкажи свій шлях:  node src/parseOrders.ts /шлях/ocr.txt");
  process.exit(1);
}

const data = loadData();
const dead = data.settings.dead_end_areas;
const year = defaultYear(data.settings);
// Дедуп за МОМЕНТОМ часу, а не за рядком: у базі можуть бути старі записи
// без року, а парсер тепер пише ISO.
const keyOf = (dt: string): string => String(parseDT(dt, data.settings)?.abs ?? dt);
const have = new Set(data.trips.map((t) => keyOf(t.datetime)));

const blocks = readBlocks(readFileSync(ocrPath, "utf8"));
const parsed = blocks.map((b) => parseBlock(b, dead, year));
const okRows = parsed.filter((p) => p.ok);
const bad = parsed.filter((p) => !p.ok);
const fresh = okRows.filter((p) => !have.has(keyOf(p.trip.datetime)));
const seen = new Set<string>();
const toAdd: Trip[] = [];
for (const p of fresh) {
  const k = keyOf(p.trip.datetime);
  if (seen.has(k)) continue; // внутрішні дублі
  seen.add(k);
  toAdd.push(p.trip);
}

console.log(`Блоків: ${blocks.length} | розпізнано: ${okRows.length} | проблемних: ${bad.length}`);
console.log(`  суму підтверджено розбивкою оплати: ${okRows.filter((p) => p.viaBreakdown).length} | лише з верхнього числа: ${okRows.filter((p) => !p.viaBreakdown).length}`);
console.log(`Уже в data.json: ${okRows.length - fresh.length} | нових до додавання: ${toAdd.length}`);
const deadN = toAdd.filter((t) => t.zone === "Глухий кут").length;
console.log(`  з них глухих кутів: ${deadN}, місто: ${toAdd.length - deadN}`);
for (const p of bad) {
  const why = !p.trip.datetime ? "немає дати"
    : !p.trip.amount ? "немає суми"
    : !p.trip.distance ? "немає дистанції"
    : !p.trip.to ? "розпізнано лише ОДНУ адресу"
    : p.trip.from === p.trip.to ? "from === to (злиплі адреси)"
    : "?";
  console.log(`  ⚠️ ${p.file}: ${why} — dt=${p.trip.datetime || "?"} amt=${p.trip.amount || "?"} dist=${p.trip.distance || "?"}`);
}

if (write && toAdd.length) {
  data.trips.push(...toAdd);
  saveData(data);
  console.log(`✅ Додано ${toAdd.length} → data.json (всього ${data.trips.length}). Запусти update-pay для оплати.`);
} else if (!write) {
  console.log("dry-run (нічого не записано). Додай --write, щоб дописати в data.json.");
}
