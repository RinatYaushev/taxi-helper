// Панель «Фільтри Автопілота»: 3 постійні слоти — і більше нічого.
//
// ⚠️ Тут колись була друга вкладка «4 режими з перемиканням». Її прибрано
// свідомо: пороги режимів були афінними (`A + B×км`), а у формі Uklon такого
// поля немає — звіт показував «екв. ₴/км», але бектестив зовсім інше правило
// (33 розбіжності зі 164 поїздок). Усе, що не вводиться у форму, — не фільтр.
import type { Row, Settings, Slot } from "../../types.ts";
import {
  baseTargetPh,
  deriveSlots,
  goldenRule,
  npkOf,
  phOf,
  refillBreakeven,
  shiftStats,
  slotPass,
  slotsStats,
} from "../../lib.ts";
import { esc, f1, money } from "../format.ts";

/** Картка слота — дзеркало форми фільтра в застосунку Uklon. */
function slotFields(sl: Slot): string {
  const sec = (t: string): string => `<tr class="fx-sec"><td colspan="2">${esc(t)}</td></tr>`;
  const row = (k: string, v: string, dim = false): string =>
    `<tr${dim ? ' class="fx-dim"' : ""}><td>${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`;
  const sub = sl.price_km_suburb;
  // ⚠️ «Простий» і «Складний» — взаємовиключні вкладки. Тумблер «Лише по місту»
  // існує ТІЛЬКИ у Простому, а «Км у мінімалці» + ціна передмістя — ТІЛЬКИ у
  // Складному. Тому вкладка визначається слотом, а не хардкодиться: інакше
  // картка радила ввести поля, яких на обраній вкладці немає.
  const simple = sl.city_only;
  return `<table class="fx-fields fx-fields-last">
    ${row("Назва фільтра", sl.name)}
    ${sec("Звідки")}
    ${row("Відстань", `${sl.max_pickup_km} км`)}
    ${row("Сектори", "усі (не обмежувати)")}
    ${sec("Куди")}
    ${row("Сектори", "усі (не обмежувати)")}
    ${sec("Тариф")}
    ${row("Тип тарифу", simple ? "Простий" : "Складний")}
    ${row("Мін. вартість", `${sl.min_order} ₴`)}
    ${simple
      ? row("Лише по місту", "✅ увімк.")
      : row("Лише по місту", "— (немає у «Складному»)", true)}
    ${simple
      ? row("Мін. ціна ₴/км", `${sl.price_km} ₴`)
      : row("Мін. ціна ₴/км · місто", `${sl.price_km} ₴`)}
    ${simple
      ? row("Км у мінімалці", "— (немає у «Простому»)", true)
      : row("Км у мінімалці", `${sl.km_in_min} км`)}
    ${simple
      ? row("Мін. ціна ₴/км · передмістя", "— (немає у «Простому»)", true)
      : row("Мін. ціна ₴/км · передмістя", sub != null ? `${sub} ₴` : "— (поле неактивне)", sub == null)}
    ${sec("Тип оплати")}
    ${row("Способи оплати", "усі")}
  </table>`;
}

/**
 * Наскільки поріг слота — сигнал, а не випадковість вибірки.
 * Показуємо плато (де результат майже не змінюється) і згоду бутстрепів.
 */
function stabilityNote(sl: Slot): string {
  const st = sl.stability;
  if (!st) return "";
  const width = Math.max(1, st.plateauHi - st.plateauLo);
  const pos = ((sl.price_km - st.plateauLo) / width) * 100;
  const agreeCls = st.agreePct >= 70 ? "v-ok" : st.agreePct >= 45 ? "v-mid" : "v-low";
  return `
    <div class="fx-stab">
      Плато: <b>${st.plateauLo}–${st.plateauHi} ₴/км</b> — у цих межах результат
      відрізняється менш ніж на 2%. Обрано <b>${sl.price_km}</b> (найм'якший край:
      відхилених замовлень ми не бачимо, тож помилятись безпечніше в бік зайвого).
      <div class="fx-stab-bar">
        <div class="fx-stab-fill" style="left:0;width:100%"></div>
        <div class="fx-stab-dot" style="left:${Math.max(0, Math.min(99, pos))}%"></div>
      </div>
      Згода бутстрепів по змінах: <b class="${agreeCls}">${st.agreePct}%</b>
      ${st.agreePct < 45 ? " — поріг тримається слабо, не варто його доводити до копійки." : ""}
    </div>`;
}

/** Чому поле «Куди → Сектори» лишається порожнім — перевірка на фактах. */
function sectorsNote(rows: Row[], s: Settings, slots: Slot[]): string {
  const T = Math.round(baseTargetPh(s));
  const passes = (r: Row): boolean => slots.some((sl) => slotPass(r, sl));
  const deads = rows.filter((r) => r.zone === "Глухий кут" && !r.longHaul);
  const dPass = deads.filter(passes);
  const dCut = deads.filter((r) => !passes(r));
  const goodDead = deads.filter((r) => r.netPerHour >= T);
  const caught = goodDead.filter(passes).length;
  const badPassed = dPass.filter((r) => r.netPerHour < T).length;
  const haul = rows.filter((r) => r.longHaul);
  const haulPass = haul.filter(passes).length;
  const subPrices = slots.map((sl) => (sl.price_km_suburb != null ? `${sl.price_km_suburb}` : "off")).join(" / ");
  const cityPrices = slots.map((sl) => `${sl.price_km}`).join(" / ");
  const clean = badPassed === 0 && caught === goodDead.length;
  return `
    <div class="fx-note fx-note-sectors">
      <div class="fx-note-t">Чому «Куди → Сектори» лишається порожнім</div>
      <p>Заборона районів — важіль <b>бінарний</b>: вимикає село цілком, разом із
        рідкісними дорогими замовленнями туди. <b>Мін. ціна ₴/км · передмістя</b>
        робить той самий відсів точніше: тупик проходить лише за суму, що покриває
        порожняк назад. Тому в слотах стоїть <b>${esc(subPrices)} ₴/км для передмістя</b>
        проти <b>${esc(cityPrices)}</b> у місті — це і є «фільтр по секторах», лише
        виражений ціною.</p>
      <div class="fx-note-grid">
        <div><span>Тупиків у базі</span><b>${deads.length}</b>
          <i>проходить ${dPass.length}, відсічено ${dCut.length}</i></div>
        <div><span>Прибуткові тупики (≥ ${T} ₴/год)</span>
          <b class="${caught === goodDead.length ? "v-ok" : "v-mid"}">${caught} з ${goodDead.length}</b>
          <i>спіймано ціною, без whitelist</i></div>
        <div><span>Збиткових просочилось</span>
          <b class="${badPassed ? "v-low" : "v-ok"}">${badPassed}</b>
          <i>відсічені тупики: ${Math.round(phOf(dCut))} ₴/год</i></div>
        <div><span>Дальняк</span>
          <b class="${haulPass ? "v-low" : "v-ok"}">${haulPass} з ${haul.length}</b>
          <i>не проходить і за ціною</i></div>
      </div>
      <p class="fx-note-sub">${
        clean
          ? `На наявних даних ціна класифікує тупики <b>без помилок</b>: усі
             ${goodDead.length} прибуткових пройшли, жоден збитковий — ні. Пройдені
             тупики дають <b>${Math.round(phOf(dPass))} ₴/год</b> проти <b>${Math.round(phOf(dCut))}</b> у відсічених.`
          : badPassed > 0
            ? `Ціна класифікує тупики <b>не ідеально</b>: просочилось
               <b>${badPassed}</b> збиткових. Це помилка <b>в бік ризику</b> —
               варто <b>підняти</b> ₴/км для передмістя або прибрати найгірші
               райони через сектори.`
            : `Ціна класифікує тупики <b>обережніше, ніж треба</b>: збиткових не
               просочилось <b>жодного</b>, але з ${goodDead.length} прибуткових
               спіймано лише <b>${caught}</b> — решту
               <b>${goodDead.length - caught}</b> поріг передмістя зрізав разом зі
               сміттям. Це помилка <b>в бік упущеної вигоди</b>, і лікується вона
               <b>зниженням</b> ₴/км для передмістя, а не підняттям.
               Сектори тут не допоможуть — вони вимкнуть ці замовлення остаточно.`
      }
        <b>Дальняк</b> Автопілот і так не бере автоматично, а за ціною міжміські
        в базі не проходять — подвійного запобіжника не треба.</p>
      <p class="fx-note-sub"><b>Коли сектори все ж знадобляться:</b> якщо почнуть
        пролазити збиткові тупики або якщо конкретний напрямок поганий не через
        гроші, а через дорогу — розбита ґрунтівка, шлагбаум, звідти ніколи немає
        зворотного замовлення. Ціна такого не бачить, а ти бачиш.</p>
    </div>`;
}

/** Спільні правила механіки фільтра Uklon. */
function filtersCommon(rows: Row[], s: Settings): string {
  const base = npkOf(rows);
  const uf = s.uklon_fare ?? { base: 81, per_km: 16.4 };
  const g = goldenRule(s);
  const tags = (arr: string[], cls: string): string =>
    arr.map((a) => `<span class="tag ${cls}">${esc(a)}</span>`).join("");
  return `
    <div class="fx-rules">
      <div class="fx-rule">
        <div class="fx-rule-t">Як фільтр вирішує</div>
        <div class="fx-rule-formula">сума ≥ Мін.вартість <b>І</b><br>
          сума ≥ ₴/км × max(дистанція, Км&nbsp;у&nbsp;мінімалці)</div>
        <div class="fx-rule-note">Тому підняття <b>«Км у мінімалці»</b> б'є саме по
          коротких поїздках. <b>Максимальної дистанції у фільтрі немає</b> — довгі
          ріжуться лише непрямо, через ₴/км.
          <br><br>
          ⚠️ Це <b>інференс</b>, а не цитата: офіційний опис суперечить сам собі
          (адитивна vs мультиплікативна модель). Перевірка більше не чекає
          випадкового замовлення — її робить <b>журнал пропозицій</b> нижче.
        </div>
      </div>
      <div class="fx-rule">
        <div class="fx-rule-t">3 активні фільтри, об'єднані за АБО</div>
        <div class="fx-rule-note">Замовлення береться, якщо підходить під
          <b>будь-який</b> із увімкнених. Отже строгий фільтр нічого не блокує — він
          лише <b>додає</b>, і тримати його ввімкненим <b>безкоштовно</b>.
          Зворотний бік: АБО бере <b>мінімум</b> порогів, тож слоти мусять бути
          невкладеними — це дає лише радіус подачі.</div>
      </div>
      <div class="fx-rule">
        <div class="fx-rule-t">Звідки беруться числа</div>
        <div class="fx-rule-note">Тариф Uklon із твоїх даних:
          <b>${uf.base} + ${f1(uf.per_km)}×км</b>. Золоте правило —
          <b>${f1(g.city)} ₴/км</b> у місті, <b>${f1(g.dead)}</b> у тупик.
          База без фільтра — <b>${f1(base)} ₴/км</b> чистими на ${rows.length} поїздках.
          Усе перераховується з <code>settings</code>.</div>
      </div>
    </div>

    <div class="fx-note fx-note-top">
      <b>Сектори — запасний важіль, а не основний.</b> Відсів робить <b>ціна</b>
      (₴/км окремо для міста й передмістя), тому поля «Куди → Сектори» лишаються
      порожніми. Списки нижче — це <b>класифікатор зон для звіту</b>, а не те, що
      обов'язково вписувати у фільтр.<br>
      <b>🏙 Живі райони</b>: ${tags(s.live_areas, "tag-live")}<br>
      <b>🚧 Глухі кути</b>: ${tags(s.dead_end_areas, "tag-dead")}<br>
      <b>🚫 Дальняк</b>: ${tags(s.long_haul_areas ?? [], "tag-haul")}
    </div>`;
}

export function filtersSection(rows: Row[], s: Settings, slots: Slot[]): string {
  const st = slotsStats(rows, slots);
  const rb = refillBreakeven(rows, slots);
  const sh = shiftStats(rows, s);
  const allMin = rows.reduce((a, r) => a + r.timeMin, 0);
  const allNet = rows.reduce((a, r) => a + r.net, 0);
  const basePh = Math.round(phOf(rows));
  const T = Math.round(baseTargetPh(s));

  const cards = slots
    .map((sl) => {
      const ex = [2, 5, 10]
        .map((d) => `${d} км → ${Math.round(sl.price_km * Math.max(d, sl.km_in_min))} ₴`)
        .join(" · ");
      const own = slotsStats(rows, [sl]);
      const mine = rows.filter((r) => slotPass(r, sl));
      const others = slots.filter((o) => o.id !== sl.id);
      const uniq = mine.filter((r) => !others.some((o) => slotPass(r, o))).length;
      const avgKm = mine.length ? mine.reduce((a, r) => a + r.distance, 0) / mine.length : 0;
      return `
      <div class="fx-card">
        <div class="fx-title">${sl.icon} ${esc(sl.name)}
          <span class="fx-badge fx-badge-on">завжди увімкнено</span></div>
        <div class="fx-sub">${esc(sl.role)}</div>
        <div class="fx-group-title">⚙️ Поля фільтра — переписати як є</div>
        ${slotFields(sl)}
        ${stabilityNote(sl)}
        <div class="fx-bt">
          <div class="fx-bt-row"><span>Поріг суми</span><b>${esc(ex)}</b></div>
          <div class="fx-bt-row"><span>Ловить сам по собі</span>
            <b>${own.pass} з ${rows.length}</b></div>
          <div class="fx-bt-row"><span>Тільки цей слот (унікальні)</span>
            <b class="${uniq ? "v-ok" : "v-low"}">${uniq}</b></div>
          <div class="fx-bt-row"><span>Сер. дистанція · ₴/год</span>
            <b>${f1(avgKm)} км · ${own.phPass}</b></div>
        </div>
        <button class="fx-preview" data-slot="${esc(sl.id)}">🔎 Показати на історії</button>
      </div>`;
    })
    .join("");

  // Та сама механіка при різних цілях ₴/год.
  const targets = Array.from(new Set([T - 60, T - 30, T, T + 30].filter((x) => x >= 120))).sort((a, b) => a - b);
  const setupRows = targets
    .map((t) => {
      const sl = deriveSlots(rows, { ...s, target_net_per_hour: t });
      const ss = slotsStats(rows, sl);
      const rbt = refillBreakeven(rows, sl);
      const share = Math.round((ss.pass / (rows.length || 1)) * 100);
      const verdict =
        t < T ? "м'якше: менше простою, нижча ставка"
          : t > T ? "жорсткіше: висока ставка, лише за щільного попиту"
            : "поточна ціль (settings)";
      const fillCls = rbt.fill < 0.5 ? "v-ok" : rbt.fill < 0.7 ? "v-mid" : "v-low";
      return `<tr class="${t === T ? "setup-cur" : ""}">
        <td>${t} ₴/год${t === T ? " ←" : ""}</td>
        <td class="num">${sl.map((x) => x.price_km).join(" / ")}</td>
        <td class="num">${ss.pass} (${share}%)</td>
        <td class="num">${ss.phPass}</td>
        <td class="num">${ss.netPass}</td>
        <td class="num"><b class="${fillCls}">${Math.round(rbt.fill * 100)}%</b></td>
        <td class="setup-note">${esc(verdict)}</td>
      </tr>`;
    })
    .join("");

  const ladder = slots
    .map((x) => `${x.icon} ${x.name} — ${x.price_km} ₴/км, подача ≤ ${x.max_pickup_km} км`)
    .join(" · ");
  const withPickup = rows.filter((r) => r.pickup_km != null).length;

  return `
    <div class="panel fx-panel fx-hero">
      <div class="fx-hero-head">
        <h3>🎯 Фільтри Автопілота — 3 постійні слоти</h3>
        <span class="hint">⚙️ = поле у формі фільтра Uklon · 🔎 = підсвітити на історії</span>
      </div>
      ${filtersCommon(rows, s)}

      <div class="fx-approach">
        <div class="fx-approach-head">
          <span class="fx-approach-icon">🎰</span>
          <div>
            <div class="fx-approach-title">Налаштував один раз — і забув</div>
            <div class="fx-approach-tag">єдиний підхід</div>
          </div>
        </div>
        <p class="fx-approach-p">
          Три слоти вписуються у три активні фільтри Uklon і <b>лишаються ввімкненими
          назавжди</b>. Перемикати нічого не треба, і це не компроміс, а наслідок
          механіки: коли ти вже везеш клієнта, м'якший слот фізично не має шансу
          спрацювати — <b>твоя зайнятість сама грає роль «режиму»</b>.
        </p>
        <p class="fx-approach-p">
          Слоти не дублюють один одного, а ділять ринок за <b>радіусом подачі</b>:
          кожен наступний строгіший за ціною, але дозволяє їхати по клієнта далі.
        </p>
        <div class="fx-howto">
          <div class="fx-howto-title">Як користуватись</div>
          <ol class="fx-howto-list">
            <li>Створи в Автопілоті <b>три фільтри</b> й перепиши поля з карток
              один-в-один — назви збігаються з формою застосунку.</li>
            <li>У блоці «Тариф» обери <b>саме ту вкладку, що вказана в картці</b>.
              «Простий» і «Складний» <b>взаємовиключні</b>: тумблер «Лише по місту»
              є лише у Простому, а «Км у мінімалці» та ціна передмістя — лише у
              Складному. Поля з <b>чужої</b> вкладки <b>ігноруються мовчки</b>.</li>
            <li>Постав кожному режим <b>«Цикл»</b>, а не «Авто»: в «Авто» фільтр
              гасне після кожного замовлення.</li>
            <li>Увімкни <b>всі три одночасно</b> і більше не чіпай.</li>
            <li>Якщо пропустити <b>обов'язкове</b> замовлення — автофільтри
              <b>вимикаються</b>. Після такого перевір, чи вони ще активні.</li>
            <li>Веди <b>журнал пропозицій</b> (панель нижче) — без нього ми не бачимо
              ані ціни відмови, ані реального радіуса подачі.</li>
          </ol>
        </div>
      </div>

      <div class="grid3 fx-grid">${cards}</div>
      ${sectorsNote(rows, s, slots)}

      <div class="fx-switch-title">Як читати трійку і який сетап обрати</div>
      <div class="fx-note fx-note-top">
        Слоти — це <b>драбина за подачею</b>, а не три різні «настрої».
        Кожен наступний <b>строгіший за ціною, але дозволяє їхати далі</b> по клієнта.
        Поточна розкладка: <b>${esc(ladder)}</b>.
        ${withPickup < 20
          ? `<br><br>⚠️ Рядок <b>«тільки цей слот»</b> для другого й третього показує мало —
             і це <b>очікувано</b>: подача заповнена в <b>${withPickup} із ${rows.length}</b>
             поїздок, тож перевірка радіуса пропускається, і слоти виглядають вкладеними
             за ціною. Журнал пропозицій це лікує.`
          : ""}
      </div>

      <div class="fx-group-title">Бектест при різних цілях — ${rows.length} поїздок</div>
      <table class="fx-fields fx-setups">
        <thead><tr>
          <th>Ціль ₴/год</th><th class="num">₴/км слотів</th><th class="num">Приймає</th>
          <th class="num">₴/год</th><th class="num">Чистими, ₴</th>
          <th class="num">Треба заповнити</th><th>Що це означає</th>
        </tr></thead>
        <tbody>${setupRows}</tbody>
      </table>
      <p class="fx-intro fx-intro-sm"><b>«Треба заповнити»</b> — головна колонка.
        Фільтр завжди міняє гроші на час: ти віддаєш відсіяні замовлення в обмін на
        вільні години. Число показує, <b>яку частку цих годин мусиш зайняти новими
        замовленнями, щоб просто вийти в нуль</b>. До 50% — запас великий, вище 70% —
        ставка тримається тільки за щільного попиту.</p>

      <div class="fx-group-title">Бектест об'єднання на ${rows.length} поїздках</div>
      <div class="fx-bt fx-bt-wide">
        <div class="fx-bt-row"><span>Пройшло</span>
          <b class="v-ok">${st.pass} з ${rows.length}</b>
          <span class="fx-delta">${st.phPass} ₴/год · ${st.netPass} ₴ чистими</span></div>
        <div class="fx-bt-row"><span>Відсіяно</span>
          <b>${st.cut}</b>
          <span class="fx-delta">${st.phCut} ₴/год · ${st.netCut} ₴ чистими</span></div>
        <div class="fx-bt-row"><span>Якби брав усе підряд</span>
          <b>${basePh} ₴/год</b>
          <span class="fx-delta">${Math.round(allNet)} ₴ чистими</span></div>
        <div class="fx-bt-row fx-bt-count"><span>Тупиків пропущено</span>
          <b class="${st.deadEnds ? "v-mid" : "v-ok"}">${st.deadEnds}</b></div>
      </div>
      <div class="fx-warn fx-warn-bottom">
        ⚠️ <b>Головний компроміс.</b> Слоти підібрані під ціль <b>${T} ₴/год</b>: вони
        піднімають модельну ставку з ${basePh} до <b>${st.phPass} ₴/год</b>, але відсікають
        ${st.cut} замовлень на <b>${st.netCut} ₴</b> і звільняють <b>${f1(rb.freedH)} год</b>
        з ${f1(allMin / 60)}. Щоб вийти бодай у нуль, треба заповнити
        <b class="${rb.fill < 0.5 ? "v-ok" : rb.fill < 0.7 ? "v-mid" : "v-low"}">${Math.round(rb.fill * 100)}%</b>
        звільненого часу.
        <br><br>
        Тримай в голові масштаб: ${st.netCut} ₴ за ${sh.count} змін — це
        <b>${money(st.netCut / Math.max(1, sh.count))} ₴ на зміну</b>, якщо час
        <b>не</b> заповниться. І ще: у зміні вже зараз є <b>${f1(sh.idleH)} год</b>
        пауз (${money(sh.modelPh)} ₴/год за моделлю проти ${money(sh.realPh)} фактичних) —
        тобто вільний час не заповнюється й без усякого фільтра.
      </div>
    </div>`;
}




