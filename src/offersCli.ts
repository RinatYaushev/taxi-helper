// CLI: зведення журналу пропозицій (`npm run offers`).
//
// Показує те, чого не видно у `trips`: що саме ми відкидаємо, скільки це
// коштує, і яке з двох прочитань правила фільтра підтверджується фактами.
import { baseTargetPh, deriveSlots, enrich, loadData } from "./lib.ts";
import { MIN_OFFERS, enrichOffers, filterRuleEvidence, offerStats, pickupCoverage } from "./offers.ts";
import { fmtShort } from "./time.ts";

const data = loadData();
const s = data.settings;
const offers = data.offers ?? [];

if (!offers.length) {
  console.log(`Журнал порожній. Додай масив "offers" у data.json — формат:`);
  console.log(`  { "datetime": "2026-08-30 19:12", "amount": 145, "distance": 5.1,`);
  console.log(`    "pickup_km": 1.8, "to": "Келецька, 100", "accepted": true, "source": "Фільтр" }`);
  console.log(`\nНавіщо: ціна відмови, реальний радіус подачі і перевірка правила фільтра.`);
  process.exit(0);
}

const rows = enrichOffers(offers, s, deriveSlots(enrich(data), s));
const slots = deriveSlots(enrich(data), s);
const st = offerStats(rows, s);
const T = Math.round(baseTargetPh(s));

console.log(`\n=== Журнал пропозицій: ${st.n} записів ===`);
console.log(`  прийнято ${st.accepted} (${Math.round(st.acceptRate * 100)}%), відмов ${st.rejected}`);
console.log(`  ₴/год прийнятих: ${Math.round(st.acceptedPh)} | відхилених: ${Math.round(st.rejectedPh)} (ціль ${T})`);
console.log(`  подача відома в ${st.pickupKnown}: сер. ${st.pickupAvg.toFixed(1)} км, p90 ${st.pickupP90.toFixed(1)} км`);

console.log(`\n=== Згода «слоти × водій» ===`);
console.log(`  обидва за:                       ${st.agree.bothYes}`);
console.log(`  слоти беруть, ти відмовився:     ${st.agree.ourYesHisNo}`);
console.log(`  слоти ріжуть, ти взяв (≥ цілі):  ${st.agree.ourNoHisYesGood}  ← ціна звуження`);
console.log(`  слоти ріжуть, ти взяв (< цілі):  ${st.agree.ourNoHisYesBad}  ← тут фільтр рятує`);
console.log(`  обидва проти:                    ${st.agree.bothNo}`);
console.log(`  надлишок, який слоти лишили б:   ${Math.round(st.surplusMissed)} ₴`);

const cov = pickupCoverage(rows, slots[0]);
if (cov.length) {
  console.log(`\n=== Радіус подачі (слот «${slots[0].name}», зараз ${slots[0].max_pickup_km} км) ===`);
  for (const c of cov) {
    console.log(`  ${String(c.km).padStart(4)} км → лишається ${Math.round(c.keptPct)
      .toString()
      .padStart(3)}% потоку, втрачено ${Math.round(c.lostSurplus)} ₴ надлишку`);
  }
}

const ev = filterRuleEvidence(rows, slots);
console.log(`\n=== Правило фільтра ===`);
console.log(`  розрізняльних пропозицій: ${ev.decisive.length}`);
console.log(`  голосів за адитивне: ${ev.votesAdditive} | за max (наша модель): ${ev.votesMax}`);
console.log(`  вердикт: ${ev.verdict}`);
for (const d of ev.decisive.slice(0, 5)) {
  console.log(
    `    ${fmtShort(d.offer.datetime, s)} ${d.offer.amount} ₴ / ${d.offer.distance} км — ` +
      `max:${d.maxSays ? "пройшло" : "ні"} адит.:${d.addSays ? "пройшло" : "ні"}`,
  );
}
if (st.n < MIN_OFFERS) console.log(`\n▲ Записів ${st.n} — від ${MIN_OFFERS} числам можна вірити.`);

