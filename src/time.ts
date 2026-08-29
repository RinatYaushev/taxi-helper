// Час: розбір `datetime`, зміни (shifts), формати виводу.
//
// Навіщо окремий модуль:
//  • старий формат "DD.MM HH:MM" **без року** ламається на межі року — ключ дня
//    `MM-DD` зливає серпень 2026 з серпнем 2027, а сортування дає випадковий
//    порядок. Канон тепер "YYYY-MM-DD HH:MM", старий формат читається як legacy.
//  • «день» ≠ «зміна»: водій працює вечорами, і перша ж зміна через північ
//    розривалась календарною добою навпіл. Зміна визначається **розривом між
//    замовленнями**, а не датою.
import type { Settings } from "./types.ts";

export interface Stamp {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  /** Абсолютні хвилини (UTC-незалежні, лише для різниць і сортування). */
  abs: number;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;
const LEGACY_RE = /^(\d{2})\.(\d{2})(?:\.(\d{4}))?\s+(\d{2}):(\d{2})$/;

/** Рік за замовчуванням для legacy-рядків без року. */
export function defaultYear(s?: Pick<Settings, "default_year">): number {
  return s?.default_year ?? new Date().getFullYear();
}

/** Розібрати `datetime` обох форматів. `null` — рядок не розпізнано. */
export function parseDT(dt: string, s?: Pick<Settings, "default_year">): Stamp | null {
  const iso = ISO_RE.exec(dt);
  if (iso) return mk(+iso[1], +iso[2], +iso[3], +iso[4], +iso[5]);
  const leg = LEGACY_RE.exec(dt);
  if (leg) return mk(leg[3] ? +leg[3] : defaultYear(s), +leg[2], +leg[1], +leg[4], +leg[5]);
  return null;
}

function mk(y: number, mo: number, d: number, h: number, mi: number): Stamp {
  return { y, mo, d, h, mi, abs: Date.UTC(y, mo - 1, d, h, mi) / 60000 };
}

const p2 = (n: number): string => String(n).padStart(2, "0");

/** Канонічний запис у data.json. */
export function fmtISO(t: Stamp): string {
  return `${t.y}-${p2(t.mo)}-${p2(t.d)} ${p2(t.h)}:${p2(t.mi)}`;
}

/** Короткий вигляд для звіту — "DD.MM HH:MM" (рік у таблиці лише шумить). */
export function fmtShort(dt: string, s?: Pick<Settings, "default_year">): string {
  const t = parseDT(dt, s);
  return t ? `${p2(t.d)}.${p2(t.mo)} ${p2(t.h)}:${p2(t.mi)}` : dt;
}

/** Мітка дня для групувань, які справді про календар ("DD.MM"). */
export function dayLabel(dt: string, s?: Pick<Settings, "default_year">): string {
  const t = parseDT(dt, s);
  return t ? `${p2(t.d)}.${p2(t.mo)}` : dt;
}

/** Час доби у хвилинах від півночі (для профілю попиту за годинами). */
export function minuteOfDay(dt: string, s?: Pick<Settings, "default_year">): number {
  const t = parseDT(dt, s);
  return t ? t.h * 60 + t.mi : 0;
}

export function hourOf(dt: string, s?: Pick<Settings, "default_year">): number {
  const t = parseDT(dt, s);
  return t ? t.h : 0;
}

/** Розрив (хв), більший за який замовлення вважаються з різних змін. */
export function shiftGapMin(s?: Pick<Settings, "shift_gap_min">): number {
  return s?.shift_gap_min ?? 240;
}

export interface Shift<T> {
  /** "DD.MM" дати ПОЧАТКУ зміни — нічна зміна лишається однією. */
  label: string;
  items: T[];
  /** Абсолютна хвилина старту першого замовлення. */
  startAbs: number;
  /** Абсолютна хвилина старту останнього замовлення. */
  lastStartAbs: number;
  /** Від першого до останнього СТАРТУ, хв. Тривалість останнього замовлення
   *  сюди не входить — її додає той, хто знає модель часу. */
  spanMin: number;
}

/**
 * Порізати хронологію на зміни за розривом між сусідніми стартами.
 *
 * Саме так, а не за календарною добою: зміна 19:00–02:00 — одна зміна, а не
 * дві по половині. Календарний день лишається доречним хіба що для «динаміки
 * по днях», і навіть там мітка береться з ПОЧАТКУ зміни.
 */
export function shiftsOf<T>(
  items: T[],
  dtOf: (x: T) => string,
  s?: Pick<Settings, "default_year" | "shift_gap_min">,
): Array<Shift<T>> {
  const withTs = items
    .map((x) => ({ x, t: parseDT(dtOf(x), s) }))
    .filter((v): v is { x: T; t: Stamp } => v.t !== null)
    .sort((a, b) => a.t.abs - b.t.abs);
  const gap = shiftGapMin(s);
  const out: Array<Shift<T>> = [];
  for (const v of withTs) {
    const cur = out[out.length - 1];
    if (cur && v.t.abs - cur.lastStartAbs <= gap) {
      cur.items.push(v.x);
      cur.lastStartAbs = v.t.abs;
      cur.spanMin = cur.lastStartAbs - cur.startAbs;
    } else {
      out.push({
        label: `${p2(v.t.d)}.${p2(v.t.mo)}`,
        items: [v.x],
        startAbs: v.t.abs,
        lastStartAbs: v.t.abs,
        spanMin: 0,
      });
    }
  }
  return out;
}

/**
 * Інтервали між сусідніми замовленнями ВСЕРЕДИНІ зміни.
 * Це вхід для калібрування `cycle_model` і для чесного підрахунку простою.
 */
export function gapsWithinShifts<T>(
  items: T[],
  dtOf: (x: T) => string,
  s?: Pick<Settings, "default_year" | "shift_gap_min">,
): Array<{ from: T; to: T; gapMin: number }> {
  const out: Array<{ from: T; to: T; gapMin: number }> = [];
  for (const sh of shiftsOf(items, dtOf, s)) {
    for (let i = 0; i < sh.items.length - 1; i++) {
      const a = parseDT(dtOf(sh.items[i]), s)!;
      const b = parseDT(dtOf(sh.items[i + 1]), s)!;
      out.push({ from: sh.items[i], to: sh.items[i + 1], gapMin: b.abs - a.abs });
    }
  }
  return out;
}

