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
  /** Похідне: цільові ₴/год для режиму (base target_net_per_hour × price_km_mult). */
  target_ph?: number;
  /** Похідне: афінний поріг мін.суми = fare_a + fare_b×км. A — фікс «за клопіт». */
  fare_a?: number;
  /** Похідне: нахил B для міста (грн/км). */
  fare_b_city?: number;
  /** Похідне: нахил B для тупиків (грн/км); undefined — тупики off. */
  fare_b_suburb?: number;
  /** Похідне: макс. дистанція в місті (перетин тарифу Uklon з афінним порогом). */
  max_km_city?: number;
  /** Похідне: макс. дистанція в тупики (той самий перетин для крутішого нахилу). */
  max_km_suburb?: number;
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
  /** Порожняк за зоною призначення (частка від пробігу). Місто → малий (наступне
   *  замовлення поруч), глухий кут → ~1.0 (повертаєшся порожнем). Якщо зони нема
   *  у мапі — береться empty_run_coef як типовий fallback. */
  empty_run_by_zone?: Partial<Record<Zone, number>>;
  commission_uklon_pct: number;
  commission_cashless_pct: number;
  threshold_net_per_km: number;
  marginal_net_per_km: number;
  /** Базова планка чистими за годину — основа афінного порогу мін.суми.
   *  Режим множить її на price_km_mult (пік вище, затишшя нижче). */
  target_net_per_hour?: number;
  /** Модель тарифу Uklon: сума ≈ base + per_km×км (калібрується з даних регресією).
   *  Використовується, щоб вивести max_km — де тариф перестає покривати наш поріг. */
  uklon_fare?: {
    base: number;
    per_km: number;
  };
  /** Модель часу для метрики ₴/год. Час = order_overhead_min +
   *  (подача + пробіг + порожняк назад)/швидкість. Крутилки, тюняться.
   *  @deprecated Замінена на cycle_model (виміряну з даних). Лишена як fallback. */
  time_model?: {
    /** Fallback-швидкість, якщо зони немає в avg_speed_by_zone. */
    avg_speed_kmh: number;
    /** Швидкість за зоною: місто повільніше (світлофори), села швидше. */
    avg_speed_by_zone?: Partial<Record<Zone, number>>;
    order_overhead_min: number;
  };
  /** ВИМІРЯНА модель циклу замовлення: `хв = base_min + per_km_min × км`.
   *  Калібрується з інтервалів між стартами сусідніх замовлень (`npm run calibrate`),
   *  тому вже враховує подачу, чекання, передачу і РЕАЛЬНЕ репозиціонування —
   *  порожняк назад окремо додавати НЕ можна (це подвійний рахунок: наступне
   *  замовлення зазвичай приходить туди, де ти висадив). */
  cycle_model?: {
    base_min: number;
    per_km_min: number;
    by_zone?: Partial<Record<Zone, { base_min: number; per_km_min: number }>>;
  };
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
  /** Оцінка тривалості замовлення (хв): ВИМІРЯНИЙ цикл (старт цього → старт
   *  наступного), тобто вже з подачею/чеканням/репозиціонуванням. */
  timeMin: number;
  /** Чистими за годину — головна метрика для водія (час дорожчий за газ на ГБО). */
  netPerHour: number;
  rating: "OK" | "погана";
  rec: Recommendation;
  /** Призначення в межах дальняку (long_haul_areas) — міжміський, окрема логіка. */
  longHaul: boolean;
}

export type Row = Trip & Computed;

/**
 * Один із 3 **постійних** слотів Автопілота — прямий переклад у поля фільтра Uklon.
 * Усі три ввімкнені завжди: фільтри об'єднуються за АБО, тож строгий слот нічого
 * не блокує (лише додає), а перемикання «пік/затишшя» робить за тебе сама
 * зайнятість — коли ти в дорозі, м'якший слот просто не має шансу спрацювати.
 */
export interface Slot {
  id: string;
  name: string;
  icon: string;
  /** Роль слота людською мовою. */
  role: string;
  /** «Мін. ціна ₴/км», місто. */
  price_km: number;
  /** «Мін. ціна ₴/км», передмістя. undefined → тумблер «Лише по місту». */
  price_km_suburb?: number;
  /** «Км у мінімалці» — головний важіль проти коротких: поріг рахується
   *  від max(дистанція, це число). */
  km_in_min: number;
  /** «Мін. вартість» замовлення. */
  min_order: number;
  /** «Звідки → Відстань»: максимальний радіус подачі, км. */
  max_pickup_km: number;
  city_only: boolean;
}

/** Результат бектесту набору слотів на історії. */
export interface SlotStat {
  pass: number;
  cut: number;
  /** ₴/год прийнятих (за виміряним циклом). */
  phPass: number;
  /** ₴/год відсіяних — скільки коштує відмова. */
  phCut: number;
  /** Чистими з прийнятих, грн. */
  netPass: number;
  /** Чистими з відсіяних, грн — це втрата, якщо звільнений час НЕ заповниться. */
  netCut: number;
  /** Прийнято поїздок у глухі кути. */
  deadEnds: number;
}

