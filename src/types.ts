// Типи даних taxi-helper

export type Payment = "Готівка" | "Безготівка" | "Комбінована";
export type Zone = "Місто" | "Глухий кут";

export interface Filters {
  short_max_km: number;
  short_max_pickup_km: number;
  normal_max_km: number;
  normal_max_pickup_km: number;
  normal_price_km_mult: number;
  long_max_pickup_km: number;
  long_price_km_mult: number;
  autopilot_min_order: number;
}

export interface Settings {
  gas_consumption_l_100km: number;
  gas_price_per_l: number;
  empty_run_coef: number;
  commission_uklon_pct: number;
  commission_cashless_pct: number;
  threshold_net_per_km: number;
  marginal_net_per_km: number;
  filters: Filters;
  dead_end_areas: string[];
  live_areas: string[];
}

export interface Trip {
  datetime: string; // "DD.MM HH:MM"
  payment: Payment;
  amount: number;
  distance: number;
  from: string;
  to: string;
  zone: Zone;
}

export interface Data {
  settings: Settings;
  trips: Trip[];
}

export type Recommendation = "бери" | "думай" | "пропускай";

export interface Computed {
  gas: number;
  commission: number;
  net: number;
  grossPerKm: number;
  netPerKm: number;
  rating: "OK" | "погана";
  rec: Recommendation;
}

export type Row = Trip & Computed;

