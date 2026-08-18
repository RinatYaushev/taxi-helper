// Визначення типу оплати за кольором іконки біля суми (аналог detect_pay.py)
import { Jimp } from "jimp";
import type { Payment } from "./types.ts";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
} // нормалізовані координати Vision (origin — низ-ліво)

/** RGB → відтінок H (0..360), насиченість S (0..1), яскравість V (0..1) */
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}

/** Класифікація одного пікселя за кольором іконки оплати */
export function colorOf(r: number, g: number, b: number): Payment | null {
  const [h, s, v] = rgbToHsv(r, g, b);
  if (s < 0.5 || v < 0.4) return null;
  if (h >= 38 && h <= 62) return "Готівка"; // жовтий
  if (h >= 90 && h <= 165) return "Комбінована"; // зелений
  if (h >= 190 && h <= 255) return "Безготівка"; // синій
  return null;
}

/** Визначити тип оплати: сканує область ліворуч від суми */
export async function detect(path: string, box: Box): Promise<Payment | null> {
  const img = await Jimp.read(path);
  const { width: W, height: H, data } = img.bitmap;
  const px0 = Math.floor(box.x * W);
  const ytop = Math.floor((1 - (box.y + box.h)) * H);
  const ybot = Math.floor((1 - box.y) * H);
  const x0 = Math.max(0, px0 - Math.floor(0.11 * W));
  const x1 = px0 - 3;
  const counts: Record<string, number> = {};
  for (let yy = Math.max(0, ytop - 12); yy < Math.min(H, ybot + 12); yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const idx = (yy * W + xx) * 4;
      const c = colorOf(data[idx], data[idx + 1], data[idx + 2]);
      if (c) counts[c] = (counts[c] ?? 0) + 1;
    }
  }
  const entries = Object.entries(counts);
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0] as Payment;
}

