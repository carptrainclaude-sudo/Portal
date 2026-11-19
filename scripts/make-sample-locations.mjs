// Формує знеособлений довідник локацій data/locations.sample.xlsx («Локація 01…35»)
// для публічного репозиторію. Реальний data/locations.xlsx у репозиторій не потрапляє.
// Запуск: node scripts/make-sample-locations.mjs
import ExcelJS from 'exceljs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Локації');
ws.columns = [{ header: '№', key: 'n', width: 6 }, { header: 'Назва', key: 'name', width: 30 }];
for (let i = 1; i <= 35; i++) ws.addRow({ n: i, name: `Локація ${String(i).padStart(2, '0')}` });
ws.getRow(1).font = { bold: true };
await wb.xlsx.writeFile(path.join(root, 'data', 'locations.sample.xlsx'));
console.log('data/locations.sample.xlsx: 35 локацій');
