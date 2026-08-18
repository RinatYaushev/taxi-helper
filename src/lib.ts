// Спільні формули та завантаження даних
import { readFileSync, writeFileSync } from "node:fs";
import type { Data, Settings, Trip, Computed, Row } from "./types.ts";

export function loadData(path = "data.json"): Data {
  return JSON.parse(readFileSync(path, "utf8")) as Data;
}

export function saveData(data: Data, path = "data.json"): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/** Собівартість палива, грн/км */
export function fuelPerKm(s: Settings): number {
  return (s.gas_consumption_l_100km / 100) * s.gas_price_per_l;
}

/** Беззбитковість з урахуванням порожнього пробігу, грн/км */
export function breakeven(s: Settings): number {
  return fuelPerKm(s) * (1 + s.empty_run_coef);
}

/** Мін. валова ціна (золоте правило), грн/км */
export function minGrossPerKm(s: Settings): number {
  const cashRate = s.commission_uklon_pct / 100;
  return (s.threshold_net_per_km + breakeven(s)) / (1 - cashRate);
}

/** Порахувати газ, комісію, чистий, грн/км і рекомендацію для однієї поїздки */
export function compute(t: Trip, s: Settings): Computed {
  const amount = Number(t.amount);
  const dist = Number(t.distance);
  const fpk = fuelPerKm(s);
  const gas = dist * (1 + s.empty_run_coef) * fpk;
  let commission = (amount * s.commission_uklon_pct) / 100;
  if (t.payment === "Безготівка") {
    commission += (amount * s.commission_cashless_pct) / 100;
  }
  const net = amount - commission - gas;
  const grossPerKm = dist ? amount / dist : 0;
  const netPerKm = dist ? net / dist : 0;
  const rating: "OK" | "погана" =
    netPerKm >= s.threshold_net_per_km ? "OK" : "погана";
  const marginal = s.marginal_net_per_km ?? 10;
  const rec =
    netPerKm >= s.threshold_net_per_km
      ? "бери"
      : netPerKm >= marginal
        ? "думай"
        : "пропускай";
  return { gas, commission, net, grossPerKm, netPerKm, rating, rec };
}

export function enrich(data: Data): Row[] {
  return data.trips.map((t) => ({ ...t, ...compute(t, data.settings) }));
}

export function avg(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

export function round(n: number, d = 2): number {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

