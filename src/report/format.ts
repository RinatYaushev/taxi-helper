// Форматери для HTML-звіту.
export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

export const money = (n: number): string => Math.round(n).toLocaleString("uk-UA");
export const f1 = (n: number): string => n.toFixed(1);
export const f2 = (n: number): string => n.toFixed(2);
export const pct = (x: number): string => `${Math.round(x * 100)}%`;

/** Клас кольору за ₴/год відносно цілі. */
export const phClass = (ph: number, target: number, marginal: number): string =>
  ph >= target ? "ok" : ph >= marginal ? "mid" : "low";

