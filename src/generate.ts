// CLI: data.json -> report.html
//
// Сам звіт зібраний із панелей у `src/report/` — колись цей файл був
// монолітом на 1568 рядків із HTML, CSS і клієнтським JS в одних шаблонних
// рядках, і саме там жили обидві «пастки середовища» (зникання емодзі й
// CSS-правила, оголошені раніше своїх базових класів).
import { writeFileSync } from "node:fs";
import { buildSnapshot, loadData, loadSnapshot, saveSnapshot } from "./lib.ts";
import { validateData } from "./validate.ts";
import { render } from "./report/render.ts";

const inPath = process.argv[2] ?? "data.json";
const outPath = process.argv[3] ?? "report.html";

const data = loadData(inPath);

// Звіт генеруємо завжди (панель «Якість даних» покаже деталі), але про помилки
// кричимо в консоль — інакше зіпсований рядок тихо псує всі числа.
const errs = validateData(data).filter((i) => i.level === "err");
if (errs.length) {
  console.error(`⚠️  ${errs.length} проблем(и) у даних — деталі: npm run check`);
  for (const e of errs) console.error(`   ✖ ${e.title}`);
}

const cur = buildSnapshot(data);
const prev = loadSnapshot();
writeFileSync(outPath, render(data, prev, cur), "utf8");
saveSnapshot(cur); // базлайн для наступного порівняння
console.log(`OK: ${data.trips.length} поїздок → ${outPath}`);

