// Формує data/products.xlsx та data/locations.xlsx з вихідної таблиці data/source/Довідники.xlsx.
// Вихідний файл: рядки — товари, колонки B..G — локації з кількостями.
// Запуск: npm run dictionaries
import ExcelJS from 'exceljs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'data', 'source', 'Довідники.xlsx');

const cellText = (v) => {
  if (v == null) return '';
  if (typeof v === 'object' && 'richText' in v) return v.richText.map((r) => r.text).join('');
  if (typeof v === 'object' && 'result' in v) return String(v.result ?? '');
  return String(v);
};

function guessUnit(name) {
  const n = name.toLowerCase();
  if (/\(рулон\)/.test(n)) return 'рулон';
  if (/\bпара\b|, пара/.test(n) || /пара$/.test(n)) return 'пара';
  if (/\(упак\)|уп\)|\bуп\b|упак/.test(n)) return 'упак';
  if (/в мішку\s*\d+\s*кг/.test(n)) return 'мішок';
  if (/\d+\s*шт|\d+\s*аркуш/.test(n)) return 'упак';
  return 'шт';
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(src);
const ws = wb.worksheets[0];

const header = ws.getRow(1);
const realLocations = [];
for (let c = 2; c <= ws.columnCount; c++) {
  const t = cellText(header.getCell(c).value).trim();
  if (t) realLocations.push(t);
}

const products = [];
const seen = new Set();
ws.eachRow((row, i) => {
  if (i === 1) return;
  const name = cellText(row.getCell(1).value).replace(/\s+/g, ' ').trim();
  if (!name || seen.has(name.toLowerCase())) return;
  seen.add(name.toLowerCase());
  products.push({ name, unit: guessUnit(name), category: 'Господарство' });
});

// 35 локацій: реальні з вихідного файлу + тестові до повної кількості.
const locations = [...realLocations];
for (let i = locations.length + 1; locations.length < 35; i++) {
  locations.push(`Локація ${String(i).padStart(2, '0')}`);
}

const out1 = new ExcelJS.Workbook();
const s1 = out1.addWorksheet('Номенклатура');
s1.columns = [
  { header: 'Назва', key: 'name', width: 80 },
  { header: 'Одиниця виміру', key: 'unit', width: 16 },
  { header: 'Категорія', key: 'category', width: 18 },
];
products.forEach((p) => s1.addRow(p));
s1.getRow(1).font = { bold: true };
await out1.xlsx.writeFile(path.join(root, 'data', 'products.xlsx'));

const out2 = new ExcelJS.Workbook();
const s2 = out2.addWorksheet('Локації');
s2.columns = [
  { header: '№', key: 'n', width: 6 },
  { header: 'Назва', key: 'name', width: 30 },
];
locations.forEach((name, i) => s2.addRow({ n: i + 1, name }));
s2.getRow(1).font = { bold: true };
await out2.xlsx.writeFile(path.join(root, 'data', 'locations.xlsx'));

console.log(`products.xlsx: ${products.length} товарів; locations.xlsx: ${locations.length} локацій (${realLocations.length} з вихідного файлу)`);
