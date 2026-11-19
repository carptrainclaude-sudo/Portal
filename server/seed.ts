// Повне перестворення тестової БД: довідники з data/*.xlsx, користувачі, заявки на закупівлю та перевезення.
// Запуск: npm run seed
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.DB_PATH ?? path.join(root, 'data', 'portal.db');
for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(f, { force: true });

const { run, get, all, now } = await import('./db.ts');
const { normalizeName } = await import('./normalize.ts');
const svc = await import('./services.ts');
const tr = await import('./transport.ts');
const { localNow } = await import('../shared/constants.ts');

const cellText = (v: any): string => {
  if (v == null) return '';
  if (typeof v === 'object' && 'richText' in v) return v.richText.map((r: any) => r.text).join('');
  if (typeof v === 'object' && 'result' in v) return String(v.result ?? '');
  return String(v);
};

async function readSheet(file: string): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(root, 'data', file));
  const ws = wb.worksheets[0];
  const rows: string[][] = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const vals: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) vals.push(cellText(row.getCell(c).value).replace(/\s+/g, ' ').trim());
    rows.push(vals);
  });
  return rows;
}

// --- Довідники ---
run("INSERT INTO categories (id, name) VALUES (1, 'Господарство')");
let pCount = 0;
for (const [name, unit, category] of await readSheet('products.xlsx')) {
  if (!name) continue;
  let cat = get('SELECT id FROM categories WHERE name = ?', category || 'Господарство');
  if (!cat) cat = { id: Number(run('INSERT INTO categories (name) VALUES (?)', category).lastInsertRowid) };
  const norm = normalizeName(name);
  if (get('SELECT 1 FROM products WHERE category_id = ? AND norm = ?', cat.id, norm)) continue;
  run('INSERT INTO products (name, norm, unit, category_id, user_added, created_at) VALUES (?, ?, ?, ?, 0, ?)', name, norm, unit || 'шт', cat.id, now());
  pCount++;
}
// Реальні локації — data/locations.xlsx (не публікується в репозиторій); якщо його немає — знеособлений зразок.
const locationsFile = process.env.LOCATIONS_XLSX
  ?? (fs.existsSync(path.join(root, 'data', 'locations.xlsx')) ? 'locations.xlsx' : 'locations.sample.xlsx');
(await readSheet(locationsFile)).forEach(([n, name], i) => {
  if (name) run('INSERT INTO locations (name, sort) VALUES (?, ?)', name, Number(n) || i + 1);
});

// --- Користувачі: у таблиці users — закупівельники та диспетчери; решта — замовники ---
for (const [email, name, role] of [
  ['buyer1@test.ua', 'Коваленко Олена', 'buyer'], ['buyer2@test.ua', 'Мельник Андрій', 'buyer'],
  ['dispatcher1@test.ua', 'Ткаченко Сергій', 'dispatcher'], ['dispatcher2@test.ua', 'Гончаренко Марія', 'dispatcher'],
]) run('INSERT INTO users (email, full_name, role) VALUES (?, ?, ?)', email, name, role);

const c1 = { lastName: 'Шевченко', firstName: 'Ірина', phone: '+380671234567' };
const c2 = { lastName: 'Бондаренко', firstName: 'Петро', phone: '+380501112233' };
const U = (email: string) => svc.resolveUser(email)!;
const product = (prefix: string) => {
  const p = all('SELECT id, name FROM products').find((r) => r.name.startsWith(prefix));
  if (!p) throw new Error(`Seed: товар не знайдено: ${prefix}`);
  return p.id as number;
};
// Локації в seed — за порядковим номером (№ у data/locations.xlsx), без прив'язки до назв.
const loc = (no: string) => {
  const l = get('SELECT id FROM locations WHERE sort = ?', Number(no));
  if (!l) throw new Error(`Seed: локацію №${no} не знайдено`);
  return l.id as number;
};
const qty = (q: Record<string, number>) => Object.entries(q).map(([l, n]) => ({ locationId: loc(l), qty: n }));
const item = (prefix: string, q: Record<string, number>) => ({ productId: product(prefix), quantities: qty(q) });
const newItem = (name: string, unit: string, q: Record<string, number>) => ({ newName: name, newUnit: unit, quantities: qty(q) });
const daysAgo = (d: number, h = 10) => { const t = new Date(); t.setDate(t.getDate() - d); t.setHours(h, 15, 0, 0); return t.toISOString(); };
const ym = (o: number) => { const x = new Date(new Date().getFullYear(), new Date().getMonth() + o, 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; };
const ymd = (o: number, day: number) => { const x = new Date(new Date().getFullYear(), new Date().getMonth() + o, day); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const inDays = (d: number, h: number) => { const t = new Date(); t.setDate(t.getDate() + d); t.setHours(h, 0, 0, 0); return localNow(t); };
const base = { type: 'PLANNED', categoryId: 1 };
const itemIds = (rid: number, prefix?: string) =>
  all(`SELECT i.id, COALESCE(p.name, l.new_name) AS name FROM request_items i JOIN request_lines l ON l.id = i.line_id
       LEFT JOIN products p ON p.id = l.product_id WHERE i.request_id = ?`, rid)
    .filter((r) => !prefix || r.name.startsWith(prefix)).map((r) => r.id as number);

// ================= Закупівлі =================
// 1. Виконана (buyer2)
const r1 = svc.createRequest(U('customer1@test.ua'), { ...base, ...c1, deliveryMonth: ym(1), items: [
  item('Туалетний папір', { '1': 400, '2': 400, '4': 60 }),
  item('Засіб для миття посуду Fairy', { '1': 2, '2': 3, '5': 5 }),
] }, daysAgo(12));
svc.takeRequest(U('buyer2@test.ua'), r1, daysAgo(11));
svc.updateItems(U('buyer2@test.ua'), { ids: itemIds(r1), plannedDate: ymd(0, 25) });
svc.updateItems(U('buyer2@test.ua'), { ids: itemIds(r1), status: 'DONE' });

// 2. В роботі (buyer1), частина позицій в дорозі / виконано
const r2 = svc.createRequest(U('customer2@test.ua'), { ...base, ...c2, deliveryMonth: ym(1), items: [
  item('Рушники паперові целюлозні Selpak', { '1': 274, '2': 274, '5': 20, '6': 30 }),
  item('Мішки для сміття Pro Service 35 л', { '1': 10, '2': 10, '5': 5, '6': 10 }),
  item('Засіб для унітазу Duck', { '1': 3, '2': 5, '4': 3, '5': 6, '6': 10 }),
] }, daysAgo(9));
svc.takeRequest(U('buyer1@test.ua'), r2, daysAgo(8));
svc.updateItems(U('buyer1@test.ua'), { ids: itemIds(r2, 'Рушники'), status: 'IN_TRANSIT', plannedDate: ymd(1, 3) });
svc.updateItems(U('buyer1@test.ua'), { ids: itemIds(r2, 'Мішки'), status: 'DONE', plannedDate: ymd(0, 28) });
svc.updateItems(U('buyer1@test.ua'), { ids: itemIds(r2, 'Засіб для унітазу'), executorEmail: 'buyer2@test.ua' });

// 3. В роботі; була нова позиція — після «Взяти в роботу» вона вже в довіднику
const r3 = svc.createRequest(U('customer1@test.ua'), { ...base, ...c1, deliveryMonth: ym(2), items: [
  item('Крем-мило рідке Dove', { '1': 10, '2': 10, '3': 3, '4': 10, '5': 7, '6': 3, '7': 4, '12': 6 }),
  item('Мило Duru', { '1': 100, '2': 100, '4': 3, '5': 5, '6': 10 }),
  newItem('Дозатор для рідкого мила настінний 1 л', 'шт', { '1': 2, '2': 2 }),
] }, daysAgo(6));
svc.takeRequest(U('buyer1@test.ua'), r3, daysAgo(5));

// 4. На доопрацюванні (повернув buyer2)
const r4 = svc.createRequest(U('customer2@test.ua'), { ...base, ...c2, deliveryMonth: ym(2), items: [
  item('Кохавинка', { '1': 100, '2': 100, '5': 10, '6': 60, '3': 120 }),
  item('Серветки паперові, одношарові', { '1': 100, '2': 100, '5': 10 }),
] }, daysAgo(4));
svc.returnRequest(U('buyer2@test.ua'), r4, 'Уточніть, будь ласка, кількість рушників для локації №3 — 120 рулонів виглядає завищено (минулого разу було 20).');

// 5. Нова
svc.createRequest(U('customer1@test.ua'), { ...base, ...c1, deliveryMonth: ym(2), items: [
  item('Стакан паперовий, білий, мал. 175мл', { '1': 60, '2': 60, '3': 20, '6': 30 }),
  item('Палочка-мішалка', { '1': 1, '2': 1, '3': 1 }),
  item('Серветки «Ruta»', { '1': 50, '2': 50, '5': 5 }),
] }, daysAgo(2));

// 6. Нова, з новими позиціями (немає в довіднику)
const r6 = svc.createRequest(U('customer2@test.ua'), { ...base, ...c2, deliveryMonth: ym(3), items: [
  item('Антисептик', { '1': 2, '2': 2, '5': 1, '6': 10 }),
  newItem('Скребок для миття вікон телескопічний 1,5 м', 'шт', { '6': 2, '15': 1 }),
  newItem('Губка металева для посуду', 'упак', { '1': 5, '2': 5 }),
  newItem('Освіжувач повітря автоматичний Glade', 'шт', { '5': 3 }),
] }, daysAgo(1));

// 7. Скасована
const r7 = svc.createRequest(U('customer1@test.ua'), { ...base, ...c1, deliveryMonth: ym(1), items: [item('Віник сорго', { '1': 3, '2': 3 })] }, daysAgo(10));
svc.cancelRequest(U('customer1@test.ua'), r7);

// ================= Перевезення =================
const p1 = { fullName: 'Шевченко Ірина', phone: '+380671234567', position: 'Офіс-менеджер' };
const p2 = { fullName: 'Бондаренко Петро', phone: '+380501112233', position: 'Начальник складу' };
const T = (who: string, p: typeof p1, d: Record<string, unknown>) => tr.createTransport(U(who), { ...p, ...d });
const trip = (from: string, fromContact: [string, string], to: string, cargo: string, seal: 'yes' | 'no', loadDay: number, extra: Record<string, unknown> = {}) => ({
  loadAddress: from, loadContactName: fromContact[0], loadContactPhone: fromContact[1], loadAt: inDays(loadDay, 9),
  cargoDetails: cargo, seal, unloadAddress: to, unloadAt: inDays(loadDay + 1, 14), ...extra,
});
const D1 = U('dispatcher1@test.ua'), D2 = U('dispatcher2@test.ua');
const car = (n: string, model: string, driver: string, phone: string, loadDay: number) =>
  ({ carNumber: n, carModel: model, driverName: driver, driverPhone: phone, driverLicense: 'ВАА 123456', loadAt: inDays(loadDay, 9), deliveryAt: inDays(loadDay + 1, 14) });

const t1 = T('customer1@test.ua', p1, trip('м. Київ, вул. Промислова, 4, склад №2', ['Олег Савчук', '+380631110022'], 'м. Житомир, вул. Київська, 77',
  'Господарські товари: 6 палет, 850 кг, 4,5 м³, палети в стрейч-плівці.', 'yes', 2, { unloadContactName: 'Наталія Коваль', unloadContactPhone: '+380671230000', unloadCompany: 'ТОВ «Житомир-Трейд»' }));
const t2 = T('customer2@test.ua', p2, trip('м. Біла Церква, вул. Сквирське шосе, 210', ['Віктор Лисенко', '+380972223344'], 'м. Київ, просп. Перемоги, 67, офіс',
  'Офісні меблі: 12 місць, 420 кг, ~6 м³, коробки та плівка. Крихке: скляні дверцята шаф.', 'no', 3));
const t3 = T('customer1@test.ua', p1, trip('м. Київ, вул. Промислова, 4', ['Олег Савчук', '+380631110022'], 'м. Біла Церква, вул. Ярослава Мудрого, 40',
  'Миючі засоби, 3 палети.', 'no', 4));
tr.reworkTransport(D1, t3, 'Уточніть вагу та об\'єм вантажу і тип упаковки — від цього залежить вибір авто.');
const t4 = T('customer2@test.ua', p2, trip('м. Бровари, вул. Металургів, 15', ['Іван Дяченко', '+380933334455'], 'м. Київ, вул. Промислова, 4, склад №2',
  'Паперові рушники та туалетний папір: 10 палет, 1 200 кг, 14 м³.', 'yes', 2));
tr.takeTransport(D1, t4);
const t5 = T('customer1@test.ua', p1, trip('м. Київ, вул. Промислова, 4, склад №2', ['Олег Савчук', '+380631110022'], 'м. Фастів, вул. Соборна, 12',
  'Стелажі металеві розібрані: 8 місць, 300 кг, довжина до 2,5 м.', 'yes', 1));
tr.takeTransport(D2, t5);
tr.setCar(D2, t5, car('AA 1234 KX', 'Mercedes-Benz Sprinter', 'Петренко Микола', '+380671112233', 1));
const t6 = T('customer2@test.ua', p2, trip('м. Київ, вул. Промислова, 4', ['Олег Савчук', '+380631110022'], 'м. Обухів, вул. Київська, 140',
  'Господарські товари: 4 палети, 600 кг.', 'no', 1));
tr.takeTransport(D1, t6);
tr.setCar(D1, t6, car('AI 7788 BC', 'Renault Master', 'Сидоренко Андрій', '+380503334455', 1));
tr.markLoaded(U('customer2@test.ua'), t6);
const t7 = T('customer1@test.ua', p1, trip('м. Київ, вул. Промислова, 4', ['Олег Савчук', '+380631110022'], 'м. Житомир, вул. Київська, 77',
  'Миючі засоби: 5 палет, 700 кг.', 'yes', 1));
tr.takeTransport(D2, t7);
tr.setCar(D2, t7, car('AA 5566 OP', 'Iveco Daily', 'Кравчук Василь', '+380665556677', 1));
tr.markLoaded(D2, t7);
tr.completeTransport(D2, t7);
// Перенести виконану заявку в минуле (реалістичні дати).
run(`UPDATE transport_requests SET load_at = ?, unload_at = ?, car_load_at = ?, car_delivery_at = ?, completed_at = ?, created_at = ?, submitted_at = ? WHERE id = ?`,
  inDays(-6, 9), inDays(-5, 14), inDays(-6, 9), inDays(-5, 14), daysAgo(5, 15), daysAgo(9), daysAgo(9), t7);
const t8 = T('customer2@test.ua', p2, trip('м. Київ, вул. Промислова, 4', ['Олег Савчук', '+380631110022'], 'м. Васильків, вул. Декабристів, 3',
  'Канцтовари, 2 коробки, 15 кг.', 'no', 5));
tr.cancelTransport(U('customer2@test.ua'), t8, 'Відправимо разом із наступною поставкою.');

// Старі сповіщення (виконані/завершені заявки) вважаємо прочитаними — лишаються свіжі.
run("UPDATE notifications SET read_at = ? WHERE (kind = 'purchase' AND request_id IN (?, ?)) OR (kind = 'transport' AND request_id = ?)", now(), r1, r2, t7);

const s = get(`SELECT (SELECT COUNT(*) FROM products) AS products, (SELECT COUNT(*) FROM locations) AS locations,
  (SELECT COUNT(*) FROM requests) AS requests, (SELECT COUNT(*) FROM transport_requests) AS transport,
  (SELECT COUNT(*) FROM request_lines WHERE product_id IS NULL) AS newLines`)!;
console.log(`Seed готово: товарів ${s.products} (з xlsx: ${pCount}), локацій ${s.locations}, заявок на закупівлю ${s.requests} (нових позицій: ${s.newLines}), заявок на перевезення ${s.transport}.`);
