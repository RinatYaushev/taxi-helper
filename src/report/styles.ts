// CSS звіту. Один файл — щоб не шукати правило по шаблонних рядках.
//
// ⚠️ Пастка, на якій уже обпеклись: модифікатори (`-bottom`, `-top`, `-sm`)
// подекуди оголошені ВИЩЕ базових класів, і за однакової специфічності виграє
// те, що нижче. Тому модифікатори, які мусять перемагати, пишемо подвійним
// класом (`.fx-warn.fx-warn-bottom`). Перевіряти обчисленими стилями, не на око.
export const STYLES = `
:root{
  --accent:#2E5A88; --bg:#f4f6fb; --panel:#fff; --ink:#1f2937; --muted:#6b7280;
  --good:#16a34a; --good-bg:#dcfce7; --warn:#d97706; --warn-bg:#fef3c7;
  --bad:#dc2626; --bad-bg:#fee2e2; --line:#e5e7eb;
}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  background:var(--bg);color:var(--ink);line-height:1.45}
.wrap{max-width:1180px;margin:0 auto;padding:28px 20px 64px}
header h1{margin:0 0 2px;font-size:26px}
header .sub{color:var(--muted);font-size:13px;margin-bottom:24px}
.cards{display:grid;gap:14px;margin-bottom:14px}
.cards-metrics{grid-template-columns:repeat(6,1fr)}
.cards-rates{grid-template-columns:1fr 1fr;margin-bottom:20px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;box-shadow:0 1px 2px rgba(0,0,0,.03)}
.card-val{font-size:24px;font-weight:700;color:var(--accent)}
.card-unit{font-size:12px;font-weight:500;color:var(--muted)}
.card-label{font-size:12px;color:var(--muted);margin-top:2px}
.card-note{font-size:11px;color:var(--muted);margin-top:3px;line-height:1.35}
.card-dual{border-color:var(--accent)}
.golden{display:flex;gap:14px;align-items:flex-start;background:linear-gradient(135deg,#eef6ff,#e6fbef);
  border:1px solid #cfe6d8;border-radius:16px;padding:18px 22px;margin-bottom:20px}
.golden-icon{font-size:34px;color:#eab308;line-height:1}
.golden-title{font-weight:700;color:var(--accent);font-size:14px;text-transform:uppercase;letter-spacing:.04em}
.golden-body{font-size:15px}
.golden-body b{color:var(--good);font-size:17px}
.golden-note{font-size:12px;color:var(--muted);margin-top:6px;line-height:1.5}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px 20px;overflow:hidden;margin-bottom:16px}
.grid2 .panel{margin-bottom:0}
.panel h3{margin:0 0 14px;font-size:15px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:7px 9px;text-align:left;border-bottom:1px solid var(--line)}
th{color:var(--muted);font-weight:600;font-size:12px;white-space:nowrap;cursor:pointer;user-select:none}
th:hover{color:var(--accent)}
th .arrow{margin-left:4px;font-size:10px;color:var(--accent)}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.nowrap{white-space:nowrap}
.addr{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#374151;cursor:default}
.addr-tip{position:fixed;z-index:50;max-width:320px;background:var(--ink);color:#fff;font-size:12px;line-height:1.4;
  padding:6px 9px;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.18);pointer-events:none;white-space:normal;
  opacity:0;transform:translateY(4px);transition:opacity .12s,transform .12s}
.addr-tip.show{opacity:1;transform:translateY(0)}
.table-wrap{overflow:auto;max-height:640px;margin:0 -20px -18px;border-top:1px solid var(--line)}
.table-wrap table{min-width:900px}
.table-wrap thead th{position:sticky;top:0;background:#f9fafb;z-index:5}
#trips tbody tr:hover{background:#f8fafc}
.mini td,.mini th{padding:6px 8px}
.mini th{cursor:default}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600}
.badge-бери{background:var(--good-bg);color:var(--good)}
.badge-думай{background:var(--warn-bg);color:var(--warn)}
.badge-пропускай{background:var(--bad-bg);color:var(--bad)}
.tag{display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;margin:3px 4px 3px 0}
.tag-dead{background:#ffedd5;color:#c2410c}
.tag-live{background:#e0f2fe;color:#0369a1}
.tag-city{background:#f3f4f6;color:#4b5563}
.tag-haul{background:#ede9fe;color:#6d28d9}
.fx-tag-row{margin-top:8px;line-height:1.9}
.fx-tag-row:first-of-type{margin-top:12px}
.npk{position:relative;display:flex;align-items:center;justify-content:flex-end;gap:6px;isolation:isolate}
.npk-bar{position:absolute;left:0;top:50%;transform:translateY(-50%);height:16px;background:#dbeafe;border-radius:4px;z-index:0}
.npk span{position:relative;z-index:1}
.v-ok{color:var(--good)} .v-mid{color:var(--warn)} .v-low{color:var(--bad)}
.dim{color:var(--muted)}
.table-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px 16px;margin-bottom:14px}
.table-head h3{margin:0}
.filters{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.filters .search{margin-right:4px}
.fbtn{border:1px solid var(--line);background:#fff;border-radius:8px;padding:5px 11px;font-size:12px;cursor:pointer;color:var(--ink)}
.fbtn.active{background:var(--accent);color:#fff;border-color:var(--accent)}
/* Фільтри Автопілота */
.fx-hero{border:2px solid var(--accent);border-radius:18px;
  background:linear-gradient(180deg,#eef4fc 0,#fff 90px);
  box-shadow:0 6px 24px rgba(46,90,136,.14);margin-bottom:22px;padding:20px 22px}
.fx-hero-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:6px}
.fx-hero-head h3{margin:0;font-size:19px;color:var(--accent)}
.fx-switch-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
  color:var(--muted);margin:18px 0 10px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.grid3.fx-grid{margin-bottom:0}
.fx-intro{font-size:13.5px;margin:0 0 14px;color:var(--ink)}
.fx-grid{margin-bottom:0}
.fx-card{background:#f9fafb;border:1px solid var(--line);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column}
.fx-title{font-size:15px;font-weight:700;color:var(--accent);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.fx-badge{font-size:11px;font-weight:600;background:var(--accent);color:#fff;padding:2px 8px;border-radius:999px}
.fx-badge-on{background:var(--good)}
.fx-sub{font-size:12.5px;color:var(--muted);margin:4px 0 10px}
.fx-fields{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:10px}
.fx-fields td{padding:6px 8px;border-bottom:1px solid var(--line)}
.fx-fields td:first-child{color:var(--muted)}
.fx-fields td:last-child{text-align:right;white-space:nowrap;padding-left:14px}
.fx-fields tr.fx-sec td{padding:10px 8px 3px;font-size:10.5px;font-weight:700;
  text-transform:uppercase;letter-spacing:.05em;color:var(--accent);
  background:transparent;border-bottom:1px solid var(--line)}
.fx-fields tr.fx-dim td{color:#9ca3af}
.fx-fields tr.fx-dim td b{font-weight:500}
.fx-fields-last{margin-bottom:12px}
.fx-setups{margin:8px 0 6px;background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.fx-setups th{padding:7px 10px;cursor:default;background:#f9fafb}
.fx-setups td{padding:7px 10px;white-space:nowrap}
.fx-setups td:first-child{color:var(--ink);font-weight:600}
.fx-setups td.setup-note{white-space:normal;color:var(--muted);font-size:12px;text-align:left}
.fx-setups tr.setup-cur{background:#eef4fc}
.fx-setups tr.setup-cur td{font-weight:700;color:var(--accent)}
.fx-note-top{margin-top:0;border-top:none;padding-top:0}
.fx-warn.fx-warn-bottom{margin:18px 0 0;padding:14px 16px}
.fx-intro-sm{font-size:12.5px;color:var(--muted);margin:6px 0 0}
.fx-bt{background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:12.5px}
.fx-card > .fx-bt{margin-top:auto}
.fx-bt-row{display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:3px 0}
.fx-bt-wide{padding:6px 20px}
.fx-bt-wide .fx-bt-row{padding:10px 2px;border-bottom:1px solid var(--line)}
.fx-bt-wide .fx-bt-row:last-child{border-bottom:none}
.fx-bt-wide .fx-bt-row>b{flex:0 0 auto}
.fx-bt-wide .fx-delta{flex:0 0 auto;text-align:right;margin-left:32px}
.fx-bt-count{border-top:1px solid var(--line);margin-top:2px}
.fx-bt-row span:first-child{color:var(--muted)}
.fx-delta{color:var(--muted);font-weight:400}
.fx-note{margin-top:14px;font-size:12.5px;color:var(--ink);border-top:1px solid var(--line);padding-top:12px}
.fx-group-title{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:10px 0 3px}
.fx-group-title:first-child{margin-top:0}
.fx-warn{background:var(--warn-bg);border:1px solid #f4d58a;border-radius:10px;padding:9px 12px;font-size:12.5px;margin:0 0 14px;line-height:1.55}
.fx-preview{margin-top:10px;width:100%;border:1px solid var(--accent);background:#fff;color:var(--accent);border-radius:8px;padding:7px 10px;font-size:12px;font-weight:600;cursor:pointer}
.fx-preview:hover{background:#eef4fc}
.fx-preview.active{background:var(--accent);color:#fff}
.fx-rules{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:0 0 14px}
.fx-rule{background:#f9fafb;border:1px solid var(--line);border-radius:10px;padding:11px 13px}
.fx-rule-t{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;
  color:var(--accent);margin-bottom:6px}
.fx-rule-formula{font-size:12.5px;font-weight:600;background:#fff;border:1px solid var(--line);
  border-radius:8px;padding:7px 9px;margin-bottom:6px;line-height:1.5}
.fx-rule-note{font-size:12px;color:var(--muted);line-height:1.5}
.fx-rule-note b{color:var(--ink)}
.fx-note-sectors{margin:14px 0 0}
.fx-note-sectors p{margin:0 0 8px}
.fx-note-t{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;
  color:var(--accent);margin-bottom:6px}
.fx-note-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin:10px 0}
.fx-note-grid>div{background:#fff;border:1px solid var(--line);border-radius:8px;padding:8px 10px}
.fx-note-grid span{display:block;font-size:11px;color:var(--muted);line-height:1.35}
.fx-note-grid b{display:block;font-size:17px;margin:2px 0 1px}
.fx-note-grid i{font-style:normal;font-size:11px;color:var(--muted)}
.fx-note-sub{font-size:12px;color:var(--muted);line-height:1.55}
.fx-note-sub b{color:var(--ink)}
.fx-approach{background:linear-gradient(180deg,#f8fafc,#fff);border:1px solid var(--line);
  border-left:3px solid var(--accent);border-radius:10px;padding:14px 16px;margin-bottom:16px}
.fx-approach-head{display:flex;align-items:center;gap:11px;margin-bottom:9px}
.fx-approach-icon{font-size:26px;line-height:1}
.fx-approach-title{font-size:15px;font-weight:700;color:var(--accent)}
.fx-approach-tag{display:inline-block;font-size:10.5px;font-weight:700;text-transform:uppercase;
  letter-spacing:.04em;background:var(--good-bg);color:var(--good);padding:1px 8px;border-radius:999px;margin-top:2px}
.fx-approach-p{font-size:13px;margin:0 0 8px;line-height:1.55}
.fx-howto{background:#fff;border:1px solid var(--line);border-radius:9px;padding:10px 13px;margin-top:10px}
.fx-howto-title{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;
  color:var(--muted);margin-bottom:5px}
.fx-howto-list{margin:0;padding-left:19px;font-size:12.5px;line-height:1.6}
.fx-howto-list li{margin-bottom:3px}
/* Стабільність порогу */
.fx-stab{font-size:11.5px;color:var(--muted);margin:2px 0 8px;line-height:1.5}
.fx-stab b{color:var(--ink)}
.fx-stab-bar{position:relative;height:6px;border-radius:3px;background:var(--line);margin:5px 0 4px;overflow:hidden}
.fx-stab-fill{position:absolute;top:0;height:100%;background:#bfdbfe}
.fx-stab-dot{position:absolute;top:-2px;width:2px;height:10px;background:var(--accent)}
tr.slot-cut{opacity:.32}
tr.slot-pass{background:#f0fdf4}
tr.slot-pass td:first-child{box-shadow:inset 3px 0 0 var(--good)}
/* Якість даних */
.dq-grid{display:flex;flex-direction:column;gap:12px}
.dq-item{border-left:3px solid var(--line);padding:10px 14px;border-radius:0 6px 6px 0;background:rgba(255,255,255,.02)}
.dq-err{border-left-color:#e5484d;background:rgba(229,72,77,.07)}
.dq-warn{border-left-color:#f5a524;background:rgba(245,165,36,.06)}
.dq-info{border-left-color:#3b82f6;background:rgba(59,130,246,.05)}
.dq-title{font-weight:700;font-size:12.5px;margin-bottom:5px}
.dq-body{font-size:12px;color:var(--muted);line-height:1.85}
.dq-body code{font-size:11px}
.bar-thin{color:var(--muted);font-size:9px;opacity:.7}
/* Дифф-панель */
.chg-panel{border-left:4px solid var(--accent)}
.chg-empty{font-size:13px;color:var(--muted);margin:0}
.chg-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px}
.chg-item{background:#f9fafb;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:13px}
.chg-item span{display:block;color:var(--muted);font-size:11.5px;margin-bottom:3px}
.chg-item b{font-size:15px;color:var(--accent)}
.chg-item i{font-style:normal;font-size:12px;font-weight:700;margin-left:4px}
.chg-up{color:var(--good)} .chg-down{color:var(--bad)} .chg-neutral{color:var(--accent)}
.chg-note{font-size:13px;background:#f9fafb;border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:12px}
.chg-note-warn{background:var(--warn-bg);border-color:#f4d58a}
.chg-note ul{margin:6px 0 0;padding-left:18px}
.chg-bt th,.chg-bt td{white-space:nowrap}
.chg-bt td.num,.chg-bt th.num{text-align:right}
.worst{list-style:none;margin:0;padding:0}
.worst li{display:grid;grid-template-columns:52px 1fr;grid-template-areas:"npk info" "npk route";
  gap:4px 12px;padding:11px 0;border-bottom:1px solid var(--line)}
.w-npk{grid-area:npk;align-self:center;font-size:20px;font-weight:700;color:var(--bad);text-align:center}
.w-info{grid-area:info;font-size:13px}
.w-route{grid-area:route;font-size:12px;color:var(--muted)}
.ds-bar{display:flex;height:16px;border-radius:8px;overflow:hidden;margin-bottom:12px;background:var(--line)}
.ds-seg{height:100%}
.ds-бери{background:var(--good)} .ds-думай{background:var(--warn)} .ds-пропускай{background:var(--bad)}
.ds-legend{display:flex;flex-direction:column;gap:6px}
.ds-item{font-size:13px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.ds-dot{width:10px;height:10px;border-radius:50%;display:inline-block}
.ds-dot-бери{background:var(--good)} .ds-dot-думай{background:var(--warn)} .ds-dot-пропускай{background:var(--bad)}
.ds-net{font-weight:700;margin-left:auto} .ds-km{color:var(--muted);min-width:66px;text-align:right}
.insights{list-style:none;margin:0;padding:0}
.insights li{font-size:13.5px;padding:8px 0;border-bottom:1px solid var(--line)}
.insights li:last-child{border-bottom:none}
.hint{font-weight:400;font-size:11px;color:var(--muted)}
.chart{display:flex;align-items:flex-end;gap:10px;overflow-x:auto;padding-top:8px;min-height:170px}
.bar-col{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;min-width:46px;gap:3px}
.bar{width:26px;border-radius:6px 6px 0 0}
.bar-ok{background:var(--good)} .bar-mid{background:var(--warn)} .bar-low{background:var(--bad)}
.bar-val{font-size:11px;font-weight:600;color:var(--ink)}
.bar-lbl{font-size:11px;color:var(--muted);white-space:nowrap}
.bar-sub{font-size:12px;font-weight:700}
.search{border:1px solid var(--line);border-radius:8px;padding:5px 10px;font-size:12px;min-width:150px}
.fbtn.dl{border-color:var(--accent);color:var(--accent)}
.dropdown{position:relative;display:inline-block}
.dropdown .caret{font-size:10px}
.dropdown-menu{position:absolute;right:0;top:calc(100% + 4px);min-width:140px;background:#fff;
  border:1px solid var(--line);border-radius:10px;box-shadow:0 6px 18px rgba(0,0,0,.12);
  padding:5px;display:none;flex-direction:column;gap:2px;z-index:10}
.dropdown-menu.open{display:flex}
.dropdown-menu button{border:none;background:none;text-align:left;padding:8px 12px;border-radius:7px;
  font-size:13px;cursor:pointer;color:var(--ink);white-space:nowrap}
.dropdown-menu button:hover{background:#f3f4f6}
/* Журнал пропозицій */
.of-panel{border-left:4px solid #7c3aed}
.of-why{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:10px 0 14px}
.of-why>div{background:#faf5ff;border:1px solid #e9d5ff;border-radius:10px;padding:10px 12px}
.of-why-t{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#6d28d9;margin-bottom:4px}
.of-why-b{font-size:12.5px;color:var(--ink);line-height:1.5}
.of-how{background:#f9fafb;border:1px solid var(--line);border-radius:10px;padding:12px 14px;font-size:12.5px}
.of-how code,.of-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
.of-code{display:block;white-space:pre;background:#111827;color:#e5e7eb;border-radius:10px;
  padding:12px 14px;overflow:auto;margin:8px 0 0;line-height:1.5}
.of-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:8px 0 12px}
.of-grid>div{background:#f9fafb;border:1px solid var(--line);border-radius:10px;padding:9px 11px}
.of-grid span{display:block;font-size:11px;color:var(--muted)}
.of-grid b{display:block;font-size:18px;margin-top:2px}
.of-verdict{font-size:13px;background:#faf5ff;border:1px solid #e9d5ff;border-radius:10px;padding:11px 13px;margin-top:10px}
footer{margin-top:24px;text-align:center;color:var(--muted);font-size:12px}
@media(max-width:1080px){.cards-metrics{grid-template-columns:repeat(3,1fr)}}
@media(max-width:900px){.grid2{grid-template-columns:1fr}.grid3{grid-template-columns:1fr}
  .cards-rates{grid-template-columns:1fr}
  .fx-rules{grid-template-columns:1fr}
  .fx-note-grid{grid-template-columns:repeat(2,1fr)}
  .of-why{grid-template-columns:1fr}
  .of-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:560px){.cards-metrics{grid-template-columns:repeat(2,1fr)}}
@media print{
  body{background:#fff}
  .wrap{max-width:none;padding:0}
  .filters,footer{display:none!important}
  .panel,.card,.golden{box-shadow:none;break-inside:avoid}
  .table-wrap{max-height:none;overflow:visible;margin:0;border-top:none}
  .table-wrap table{min-width:0}
  .table-wrap thead th{position:static}
  .addr{max-width:none;white-space:normal;overflow:visible;text-overflow:clip}
}
`;
