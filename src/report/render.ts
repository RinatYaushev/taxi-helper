// Складання HTML-звіту з панелей.
import type { Data } from "../types.ts";
import type { Snapshot } from "../lib.ts";
import { baseTargetPh, deriveSlots, enrich, marginalTargetPh } from "../lib.ts";
import { STYLES } from "./styles.ts";
import { CLIENT_JS } from "./client.ts";
import { esc } from "./format.ts";
import { decisionStrip, goldenBanner, insightsBox, kpiCards, shiftTrend } from "./panels/overview.ts";
import { breakdowns, tripsTable, worstList } from "./panels/trips.ts";
import { filtersSection } from "./panels/filters.ts";
import { offersPanel } from "./panels/offers.ts";
import { changesPanel, dataQuality, footerNote } from "./panels/meta.ts";

export function render(data: Data, prev: Snapshot | null, cur: Snapshot): string {
  const s = data.settings;
  const rows = enrich(data);
  const slots = deriveSlots(rows, s);
  const now = new Date().toLocaleString("uk-UA");
  // Дані слотів для клієнтського прев'ю (підсвітка pass/fail у таблиці).
  const slotsJson = JSON.stringify(slots).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Taxi Helper — звіт</title>
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>🚕 Taxi Helper — звіт прибутковості</h1>
    <div class="sub">Uklon · Вінниця · згенеровано ${esc(now)}</div>
  </header>
  ${kpiCards(rows, s)}
  ${goldenBanner(s)}
  ${filtersSection(rows, s, slots)}
  ${offersPanel(data, s, slots)}
  ${changesPanel(prev, cur)}
  <div class="grid2">${decisionStrip(rows)}${insightsBox(rows, s)}</div>
  ${shiftTrend(rows, s)}
  ${tripsTable(rows, s)}
  ${breakdowns(rows, s)}
  ${worstList(rows, s)}
  ${dataQuality(data, rows, s)}
  <footer>${footerNote(rows, s)} · ціль ${Math.round(baseTargetPh(s))} ₴/год,
    «думай» від ${Math.round(marginalTargetPh(s))}</footer>
</div>
<script>window.__SLOTS__=${slotsJson};</script>
<script>${CLIENT_JS}</script>
</body>
</html>`;
}
