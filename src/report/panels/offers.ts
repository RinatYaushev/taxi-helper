// Панель «Журнал пропозицій» — те, чого не бачать `trips`.
import type { Data, Settings, Slot } from "../../types.ts";
import { baseTargetPh } from "../../lib.ts";
import {
  MIN_OFFERS,
  enrichOffers,
  filterRuleEvidence,
  offerStats,
  pickupCoverage,
} from "../../offers.ts";
import { fmtShort } from "../../time.ts";
import { esc, f1, money } from "../format.ts";

const SAMPLE = `"offers": [
  { "datetime": "2026-08-30 19:12", "amount": 145, "distance": 5.1,
    "pickup_km": 1.8, "pickup_min": 6, "to": "Келецька, 100",
    "accepted": true,  "source": "Фільтр" },
  { "datetime": "2026-08-30 19:41", "amount": 210, "distance": 11.4,
    "pickup_km": 3.2, "to": "Зарічна (Стрижавка), 2",
    "accepted": false, "source": "Фільтр", "reason": "далеко і в тупик" }
]`;

function emptyState(): string {
  return `
    <div class="of-why">
      <div>
        <div class="of-why-t">Ціна відмови</div>
        <div class="of-why-b">Скільки простою купує вузький фільтр. Зараз «Треба
          заповнити 60%» — це <b>вимога</b>, а не вимір: відхилених замовлень ми
          не бачимо в принципі.</div>
      </div>
      <div>
        <div class="of-why-t">Радіус подачі</div>
        <div class="of-why-b">Зараз він <b>виводиться з ціни</b>, бо фактів немає.
          20–30 записів — і «2 чи 3 км» перестає бути інтуїцією.</div>
      </div>
      <div>
        <div class="of-why-t">Правило фільтра</div>
        <div class="of-why-b">Офіційний опис суперечить сам собі: <code>max</code>
          чи адитивна модель. Журнал розрізняє їх за кілька змін — не треба чекати
          рідкісного «240 ₴ на 10 км».</div>
      </div>
    </div>
    <div class="of-how">
      <b>Як вести.</b> Записуй <b>кожну показану пропозицію</b> — і прийняту, і
      відхилену. Досить п'яти полів: коли, сума, км, подача, взяв чи ні. Прийняті
      дублювати з <code>trips</code> не обов'язково, але з ними точніше.
      Формат — масив <code>offers</code> поруч із <code>trips</code> у
      <code>data.json</code>:
      <div class="of-code">${esc(SAMPLE)}</div>
      Перевірити: <code>npm run check</code> · зведення: <code>npm run offers</code>.
    </div>`;
}

export function offersPanel(data: Data, s: Settings, slots: Slot[]): string {
  const offers = data.offers ?? [];
  if (!offers.length) {
    return `
      <div class="panel of-panel">
        <h3>🎁 Журнал пропозицій <span class="hint">— порожній, і це найбільша діра в методиці</span></h3>
        <p class="fx-intro">Уся оптимізація фільтрів досі будувалась на
          <b>цензурованій вибірці</b>: у базі лише поїздки, які водій <b>уже</b>
          відібрав інтуїцією. Ми оптимізуємо відсів, не бачачи того, що відсівається.
          Журнал пропозицій — єдиний спосіб це закрити.</p>
        ${emptyState()}
      </div>`;
  }

  const rows = enrichOffers(offers, s, slots);
  const st = offerStats(rows, s);
  const ev = filterRuleEvidence(rows, slots);
  const T = Math.round(baseTargetPh(s));
  const thin = st.n < MIN_OFFERS;

  const cov = pickupCoverage(rows, slots[0]);
  const covRows = cov
    .map(
      (c) => `<tr${c.km === slots[0].max_pickup_km ? ' class="setup-cur"' : ""}>
        <td>${c.km} км</td>
        <td class="num">${Math.round(c.keptPct)}%</td>
        <td class="num">${money(c.lostSurplus)} ₴</td>
      </tr>`,
    )
    .join("");

  const ruleBadge =
    ev.verdict === "адитивне"
      ? `<b class="v-low">адитивне</b> — поріг для передмістя треба піднімати, whitelist секторів стає актуальним`
      : ev.verdict === "max"
        ? `<b class="v-ok">max (наша модель)</b> — конструкція слотів підтверджена`
        : `<b class="v-mid">поки невідомо</b> — потрібно більше пропозицій, де моделі розходяться`;

  return `
    <div class="panel of-panel">
      <h3>🎁 Журнал пропозицій <span class="hint">— ${st.n} записів${thin ? `, треба ≥ ${MIN_OFFERS}` : ""}</span></h3>
      <div class="of-grid">
        <div><span>Прийнято</span><b>${st.accepted} <span class="card-unit">(${Math.round(st.acceptRate * 100)}%)</span></b></div>
        <div><span>Відмов</span><b>${st.rejected}</b></div>
        <div><span>₴/год того, від чого відмовився</span>
          <b class="${st.rejectedPh >= T ? "v-low" : "v-ok"}">${money(st.rejectedPh)}</b></div>
        <div><span>Подача відома</span><b>${st.pickupKnown}</b></div>
      </div>

      <div class="fx-group-title">Згода «наші слоти × твоє рішення»</div>
      <div class="fx-bt fx-bt-wide">
        <div class="fx-bt-row"><span>Слоти беруть, ти взяв</span><b class="v-ok">${st.agree.bothYes}</b></div>
        <div class="fx-bt-row"><span>Слоти беруть, ти відмовився</span>
          <b class="${st.agree.ourYesHisNo ? "v-mid" : "v-ok"}">${st.agree.ourYesHisNo}</b>
          <span class="fx-delta">фільтр м'якший за тебе — подивись причини відмов</span></div>
        <div class="fx-bt-row"><span>Слоти ріжуть, ти взяв — і воно було ≥ ${T} ₴/год</span>
          <b class="${st.agree.ourNoHisYesGood ? "v-low" : "v-ok"}">${st.agree.ourNoHisYesGood}</b>
          <span class="fx-delta">це і є ціна звуження: ${money(st.surplusMissed)} ₴ надлишку</span></div>
        <div class="fx-bt-row"><span>Слоти ріжуть, ти взяв — і воно було гірше цілі</span>
          <b class="v-ok">${st.agree.ourNoHisYesBad}</b>
          <span class="fx-delta">тут фільтр рятує</span></div>
        <div class="fx-bt-row"><span>Обидва проти</span><b>${st.agree.bothNo}</b></div>
      </div>

      ${cov.length
        ? `<div class="fx-group-title">Скільки потоку коштує радіус подачі (слот «${esc(slots[0].name)}»)</div>
           <table class="fx-fields fx-setups">
             <thead><tr><th>Радіус</th><th class="num">Лишається потоку</th><th class="num">Втрачений надлишок</th></tr></thead>
             <tbody>${covRows}</tbody>
           </table>
           <p class="fx-intro fx-intro-sm">Перший рядок із факту, а не з формули
             <code>earnedPickupKm</code>. Середня подача ${f1(st.pickupAvg)} км,
             90-й перцентиль ${f1(st.pickupP90)} км.</p>`
        : `<div class="fx-warn">▲ У записах немає <code>pickup_km</code> — радіус
             досі виводиться з ціни. Це найдешевше поле для заповнення: Uklon показує
             його прямо в пропозиції.</div>`}

      <div class="of-verdict">
        <b>Правило фільтра:</b> ${ruleBadge}.
        Голосів за адитивне — <b>${ev.votesAdditive}</b>, за <code>max</code> —
        <b>${ev.votesMax}</b> (враховуються лише пропозиції з <code>source: "Фільтр"</code>,
        на яких дві моделі розходяться: ${ev.decisive.length} шт).
        ${ev.decisive.length
          ? `<br>Приклади: ${ev.decisive
              .slice(0, 3)
              .map((d) => `${esc(fmtShort(d.offer.datetime, s))} — ${money(d.offer.amount)} ₴ / ${f1(d.offer.distance)} км`)
              .join(" · ")}`
          : ""}
      </div>
      ${thin ? `<div class="fx-warn fx-warn-bottom">▲ Записів поки ${st.n} — числа орієнтовні. Від ${MIN_OFFERS} їм можна вірити.</div>` : ""}
    </div>`;
}

