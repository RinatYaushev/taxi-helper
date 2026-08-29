// CLI: перевірка data.json (`npm run check`). Той самий код, що й панель
// «Якість даних» у звіті, — щоб CI і звіт не розходились у думках.
import { loadData } from "./lib.ts";
import { hasErrors, validateData } from "./validate.ts";

const path = process.argv[2] ?? "data.json";
const data = loadData(path);
const issues = validateData(data);

if (!issues.length) {
  console.log(`✅ ${path}: проблем не знайдено (${data.trips.length} поїздок, ${data.offers?.length ?? 0} пропозицій)`);
  process.exit(0);
}

for (const i of issues) {
  const icon = i.level === "err" ? "✖" : i.level === "warn" ? "▲" : "•";
  console.log(`\n${icon} ${i.title}`);
  for (const d of i.details.slice(0, 15)) console.log(`    ${d}`);
  if (i.details.length > 15) console.log(`    … ще ${i.details.length - 15}`);
}

if (hasErrors(issues)) {
  console.log(`\n✖ Є помилки — вони тихо псують усі числа звіту.`);
  process.exit(1);
}
console.log(`\n▲ Лише попередження.`);

