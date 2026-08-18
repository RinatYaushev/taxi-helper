// Типи даних taxi-helper

export type Payment = "Готівка" | "Безготівка" | "Комбінована";
export type Zone = "Місто" | "Глухий кут";


/** Пресет фільтра «Автопілота» під певний рівень попиту. */
export interface Mode {
  id: string;
  name: string;
  icon: string;
  /** Завжди активний фоновий фільтр (короткі поруч). */
  always_on: boolean;
  /** Коли вмикати цей режим (людською мовою). */
  when: string;
  /** "Простий" | "Складний" */
  tariff: string;
  min_order: number;
  /** Множник до «золотого правила» (minGrossPerKm) для міста.
   *  Порогова ₴/км перераховується з формул: round(minGrossPerKm × price_km_mult). */
  price_km_mult: number;
  /** Множник для передмістя. Якщо відсутній — тупики off. */
  price_km_suburb_mult?: number;
  /** Обчислюється в deriveModes() з price_km_mult. */
  min_price_km_city?: number;
  /** Обчислюється в deriveModes() з price_km_suburb_mult; інакше тупики off. */
  min_price_km_suburb?: number;
  max_pickup_km: number;
  /** Верхня межа дистанції поїздки (для обігу в пік); 0/відсутнє — без межі. */
  max_km?: number;
  /** Км у «мінімалці» для складного тарифу. */
  min_km_in_minimum?: number;
  city_only: boolean;
}

export interface Settings {
  gas_consumption_l_100km: number;
  gas_price_per_l: number;
  empty_run_coef: number;
  commission_uklon_pct: number;
  commission_cashless_pct: number;
  threshold_net_per_km: number;
  marginal_net_per_km: number;
  modes: Mode[];
  dead_end_areas: string[];
  live_areas: string[];
  /** Далекі міста/смт (міжміський дальняк) — це НЕ глухий кут, окрема логіка. */
  long_haul_areas: string[];
}

export interface Trip {
  datetime: string; // "DD.MM HH:MM"
  payment: Payment;
  amount: number;
  distance: number;
  /** Відстань подачі (км) до клієнта. Опційно: старі поїздки без цих даних. */
  pickup_km?: number;
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
  /** Призначення в межах дальняку (long_haul_areas) — міжміський, окрема логіка. */
  longHaul: boolean;
}

export type Row = Trip & Computed;

