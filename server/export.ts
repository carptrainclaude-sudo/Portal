import ExcelJS from 'exceljs';
import { createRequire } from 'node:module';
import { ITEM_STATUS, monthLabel } from '../shared/constants.ts';
import type { Row } from './db.ts';

const require = createRequire(import.meta.url);
const PdfPrinter = require('pdfmake');
const vfs: Record<string, string> = require('pdfmake/build/vfs_fonts.js');

const fontBuf = (n: string) => Buffer.from(vfs[n], 'base64');
// Roboto з пакета pdfmake містить кирилицю.
const printer = new PdfPrinter({
  Roboto: {
    normal: fontBuf('Roboto-Regular.ttf'),
    bold: fontBuf('Roboto-Medium.ttf'),
    italics: fontBuf('Roboto-Italic.ttf'),
    bolditalics: fontBuf('Roboto-MediumItalic.ttf'),
  },
});

const fmtDate = (d: string | null) => (d ? d.split('-').reverse().join('.') : '');
const statusLabel = (s: string) => ITEM_STATUS[s as keyof typeof ITEM_STATUS] ?? s;

const HEADERS = [
  'ID заявки', 'ПІБ замовника', 'Місяць поставки', 'Виконавець', 'Планова дата',
  'Товар', 'Од. виміру', 'Локація', 'Кількість', 'Статус позиції',
];

function rowValues(r: Row) {
  return [
    r.requestId, r.customerName, monthLabel(r.deliveryMonth), r.executorName ?? '', fmtDate(r.plannedDate),
    r.productName, r.unit, r.locationName, r.qty, statusLabel(r.status),
  ];
}

export async function buildXlsx(rows: Row[], filterText: string, category: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Портал закупівель';
  const ws = wb.addWorksheet('Зведена потреба', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  ws.addRow([`Зведена потреба — ${category}`]).font = { bold: true, size: 14 };
  ws.addRow([`Сформовано: ${new Date().toLocaleString('uk-UA')}${filterText ? ` · Фільтри: ${filterText}` : ''}`]).font = { color: { argb: 'FF626F86' } };
  ws.addRow([]);
  const header = ws.addRow(HEADERS);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0C66E4' } };
    c.alignment = { vertical: 'middle', wrapText: true };
  });
  for (const r of rows) ws.addRow(rowValues(r));
  const widths = [10, 26, 16, 22, 13, 60, 10, 18, 10, 14];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.getColumn(6).alignment = { wrapText: true, vertical: 'top' };
  ws.views = [{ state: 'frozen', ySplit: 4 }];
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + rows.length, column: HEADERS.length } };
  const total = rows.reduce((s, r) => s + Number(r.qty), 0);
  const tr = ws.addRow(['Разом позицій: ' + rows.length, '', '', '', '', '', '', '', total, '']);
  tr.font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function buildPdf(rows: Row[], filterText: string, category: string): Promise<Buffer> {
  const body: any[] = [HEADERS.map((h) => ({ text: h, style: 'th' }))];
  let lastMonth = '';
  for (const r of rows) {
    if (r.deliveryMonth !== lastMonth) {
      lastMonth = r.deliveryMonth;
      body.push([{ text: monthLabel(r.deliveryMonth), colSpan: HEADERS.length, style: 'group' }, ...Array(HEADERS.length - 1).fill('')]);
    }
    body.push(rowValues(r).map((v, i) => ({ text: String(v ?? ''), alignment: i === 0 || i === 8 ? 'right' : 'left' })));
  }
  const doc = {
    pageOrientation: 'landscape',
    pageSize: 'A4',
    pageMargins: [24, 40, 24, 32],
    defaultStyle: { font: 'Roboto', fontSize: 7.5 },
    header: { text: `Зведена потреба — ${category}`, margin: [24, 16, 24, 0], bold: true, fontSize: 11 },
    footer: (page: number, pages: number) => ({
      columns: [
        { text: `Сформовано: ${new Date().toLocaleString('uk-UA')}`, color: '#626f86' },
        { text: `Сторінка ${page} з ${pages}`, alignment: 'right', color: '#626f86' },
      ],
      margin: [24, 8, 24, 0],
      fontSize: 7,
    }),
    content: [
      filterText ? { text: `Фільтри: ${filterText}`, margin: [0, 0, 0, 6], color: '#44546f' } : '',
      {
        table: { headerRows: 1, widths: [34, 70, 52, 64, 44, '*', 34, 64, 40, 50], body },
        layout: {
          fillColor: (i: number, node: any) => (i === 0 ? '#0c66e4' : node.table.body[i][0].style === 'group' ? '#e9f2ff' : i % 2 ? null : '#f7f8f9'),
          hLineColor: () => '#dfe1e6',
          vLineColor: () => '#dfe1e6',
        },
      },
      { text: `Разом позицій: ${rows.length} · Загальна кількість: ${rows.reduce((s, r) => s + Number(r.qty), 0)}`, margin: [0, 8, 0, 0], bold: true },
    ],
    styles: {
      th: { bold: true, color: '#ffffff' },
      group: { bold: true, color: '#0055cc', fontSize: 8.5 },
    },
  };
  return new Promise((resolve, reject) => {
    const pdf = printer.createPdfKitDocument(doc);
    const chunks: Buffer[] = [];
    pdf.on('data', (c: Buffer) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    pdf.end();
  });
}
