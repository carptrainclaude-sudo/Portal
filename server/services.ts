import { all, get, run, tx, now, addEvent, type Row } from './db.ts';
import { normalizeName, searchTokens, similarity, tokenSimilarity } from './normalize.ts';
import { ITEM_STATUS, PHONE_RE, REQUEST_STATUS, UNITS, monthLabel, monthOptions } from '../shared/constants.ts';
import type { Notice } from './mail.ts';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type Role = 'buyer' | 'dispatcher' | 'customer';
export type CurrentUser = { email: string; role: Role; fullName: string };

// ---------- Користувачі ----------

export function resolveUser(emailRaw: string): CurrentUser | null {
  const email = String(emailRaw ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const staff = get('SELECT email, full_name, role FROM users WHERE lower(email) = ?', email);
  if (staff) return { email, role: staff.role as Role, fullName: staff.full_name };
  const prof = get('SELECT last_name, first_name, transport_name FROM customer_profiles WHERE email = ?', email);
  const name = prof ? (`${prof.last_name} ${prof.first_name}`.trim() || prof.transport_name) : '';
  return { email, role: 'customer', fullName: name || email };
}

export function staff(role: 'buyer' | 'dispatcher'): Row[] {
  return all('SELECT email, full_name AS fullName FROM users WHERE role = ? ORDER BY full_name', role);
}
export const buyers = () => staff('buyer');

export function staffName(email: string | null | undefined): string | null {
  if (!email) return null;
  return get('SELECT full_name FROM users WHERE email = ?', email)?.full_name ?? email;
}

export function requireRole(user: CurrentUser, role: Role) {
  if (user.role !== role) {
    const label = { buyer: 'закупівельнику', dispatcher: 'диспетчеру', customer: 'замовнику' }[role];
    throw new HttpError(403, `Доступно лише ${label}`);
  }
}

// ---------- Сповіщення ----------

export function notify(email: string, kind: 'purchase' | 'transport', requestId: number, text: string) {
  run('INSERT INTO notifications (user_email, kind, request_id, text, created_at) VALUES (?, ?, ?, ?, ?)', email, kind, requestId, text, now());
}
export function unreadSummary(email: string) {
  const rows = all('SELECT kind, COUNT(*) AS n FROM notifications WHERE user_email = ? AND read_at IS NULL GROUP BY kind', email);
  const purchase = Number(rows.find((r) => r.kind === 'purchase')?.n ?? 0);
  const transport = Number(rows.find((r) => r.kind === 'transport')?.n ?? 0);
  return { purchase, transport, total: purchase + transport };
}
export function unreadByRequest(email: string, kind: string): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  for (const r of all('SELECT request_id, text FROM notifications WHERE user_email = ? AND kind = ? AND read_at IS NULL ORDER BY id', email, kind)) {
    (out[r.request_id] ??= []).push(r.text);
  }
  return out;
}
export function markRead(email: string, kind: string, requestId: number) {
  run('UPDATE notifications SET read_at = ? WHERE user_email = ? AND kind = ? AND request_id = ? AND read_at IS NULL', now(), email, kind, requestId);
}

// ---------- Довідник ----------

export function searchProducts(q: string, categoryId: number, limit = 20): Row[] {
  const tokens = searchTokens(q);
  if (!tokens.length) return [];
  const rows = all('SELECT id, name, unit, user_added AS userAdded, norm FROM products WHERE category_id = ? ORDER BY name', categoryId);
  const first = tokens[0];
  return rows
    .filter((r) => tokens.every((t) => r.norm.includes(t)))
    .map((r) => ({ id: r.id as number, name: r.name as string, unit: r.unit as string, userAdded: r.userAdded as number, rank: r.norm.startsWith(first) ? 0 : 1 }))
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'uk'))
    .slice(0, limit)
    .map(({ rank, ...r }) => r);
}

/** Точний збіг (без регістру/пробілів/латиниці-кирилиці) і схожі назви з довідника. */
export function findSimilarProducts(name: string, categoryId: number) {
  const norm = normalizeName(name);
  const rows = all('SELECT id, name, unit, norm FROM products WHERE category_id = ?', categoryId);
  const exact = rows.find((r) => r.norm === norm) ?? null;
  const similar = rows
    .filter((r) => r.norm !== norm)
    .map((r) => ({ id: r.id, name: r.name, unit: r.unit, score: Math.max(similarity(norm, r.norm), tokenSimilarity(name, r.name)) }))
    .filter((r) => r.score >= 0.5) // підказка, а не блокування: краще показати зайвий схожий товар, ніж пропустити
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  return { exact: exact ? { id: exact.id, name: exact.name, unit: exact.unit } : null, similar };
}

function exactProduct(name: string, categoryId: number): Row | undefined {
  return get('SELECT id, name, unit FROM products WHERE category_id = ? AND norm = ?', categoryId, normalizeName(name));
}

// ---------- Заявки на закупівлю ----------

type Line = { productId: number | null; newName: string | null; newUnit: string | null; quantities: { locationId: number; qty: number }[] };
type Payload = { lastName: string; firstName: string; phone: string; deliveryMonth: string; type: string; categoryId: number; items: Line[] };

function cleanName(s: unknown) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

function validatePayload(body: any, currentMonth?: string): Payload {
  const errors: string[] = [];
  const lastName = String(body?.lastName ?? '').trim();
  const firstName = String(body?.firstName ?? '').trim();
  const phone = String(body?.phone ?? '').replace(/[^\d+]/g, '');
  const deliveryMonth = String(body?.deliveryMonth ?? '');
  const type = String(body?.type ?? 'PLANNED');
  const categoryId = Number(body?.categoryId);
  if (!lastName) errors.push('Вкажіть прізвище');
  if (!firstName) errors.push("Вкажіть ім'я");
  if (!PHONE_RE.test(phone)) errors.push('Телефон має бути у форматі +380XXXXXXXXX');
  if (!monthOptions().some((m) => m.value === deliveryMonth) && deliveryMonth !== currentMonth) errors.push('Оберіть місяць поставки');
  if (type !== 'PLANNED') errors.push('Зараз доступні лише планові заявки');
  if (!get('SELECT id FROM categories WHERE id = ?', categoryId)) errors.push('Оберіть категорію');

  const items = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) errors.push('Додайте щонайменше один товар');
  const seen = new Set<string>();
  const out: Line[] = [];
  for (const it of items) {
    let productId: number | null = it?.productId ? Number(it.productId) : null;
    let newName: string | null = null;
    let newUnit: string | null = null;
    let label = '';
    if (productId) {
      const p = get('SELECT id, name, category_id FROM products WHERE id = ?', productId);
      if (!p) { errors.push('Невідомий товар у заявці'); continue; }
      if (p.category_id !== categoryId) errors.push(`Товар «${p.name}» не належить до обраної категорії`);
      label = p.name;
    } else {
      newName = cleanName(it?.newName);
      newUnit = String(it?.newUnit ?? '');
      label = newName;
      if (newName.length < 3) { errors.push('Назва нової позиції має містити щонайменше 3 символи'); continue; }
      if (!UNITS.includes(newUnit)) { errors.push(`«${newName}»: оберіть одиницю виміру`); continue; }
      // Такий товар уже є в довіднику — прив'язуємо до наявного запису.
      const ex = exactProduct(newName, categoryId);
      if (ex) { productId = ex.id; newName = null; newUnit = null; label = ex.name; }
    }
    const key = productId ? `p:${productId}` : `n:${normalizeName(newName!)}`;
    if (seen.has(key)) { errors.push(`Товар «${label}» додано двічі`); continue; }
    seen.add(key);
    const qs: { locationId: number; qty: number }[] = [];
    const seenLoc = new Set<number>();
    for (const q of Array.isArray(it?.quantities) ? it.quantities : []) {
      const locationId = Number(q?.locationId);
      const qty = Number(q?.qty);
      if (!get('SELECT id FROM locations WHERE id = ?', locationId)) { errors.push('Невідома локація'); continue; }
      if (!Number.isInteger(qty) || qty <= 0) { errors.push(`«${label}»: кількість має бути цілим числом більше 0`); continue; }
      if (seenLoc.has(locationId)) continue;
      seenLoc.add(locationId);
      qs.push({ locationId, qty });
    }
    if (!qs.length) errors.push(`«${label}»: вкажіть кількість щонайменше для однієї локації`);
    out.push({ productId, newName, newUnit, quantities: qs });
  }
  if (errors.length) throw new HttpError(400, [...new Set(errors)].join('; '));
  return { lastName, firstName, phone, deliveryMonth, type, categoryId, items: out };
}

function insertLines(requestId: number, items: Line[]) {
  run('DELETE FROM request_lines WHERE request_id = ?', requestId); // позиції видаляються каскадно
  items.forEach((it, order) => {
    const r = run(
      'INSERT INTO request_lines (request_id, line_order, product_id, new_name, new_unit, was_new) VALUES (?, ?, ?, ?, ?, ?)',
      requestId, order, it.productId, it.newName, it.newUnit, it.productId ? 0 : 1,
    );
    const lineId = Number(r.lastInsertRowid);
    for (const q of it.quantities) {
      run('INSERT INTO request_items (request_id, line_id, location_id, qty) VALUES (?, ?, ?, ?)', requestId, lineId, q.locationId, q.qty);
    }
  });
}

function saveProfile(email: string, p: { lastName: string; firstName: string; phone: string }) {
  run(
    `INSERT INTO customer_profiles (email, last_name, first_name, phone, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET last_name = excluded.last_name, first_name = excluded.first_name,
       phone = excluded.phone, updated_at = excluded.updated_at`,
    email, p.lastName, p.firstName, p.phone, now(),
  );
}

const newLinesCount = (id: number) =>
  Number(get('SELECT COUNT(*) AS n FROM request_lines WHERE request_id = ? AND product_id IS NULL AND removed = 0', id)!.n);

export function createRequest(user: CurrentUser, body: any, at = now()): number {
  requireRole(user, 'customer');
  const p = validatePayload(body);
  return tx(() => {
    const r = run(
      `INSERT INTO requests (type, category_id, status, customer_email, last_name, first_name, phone, delivery_month,
         created_at, updated_at, submitted_at) VALUES (?, ?, 'NEW', ?, ?, ?, ?, ?, ?, ?, ?)`,
      p.type, p.categoryId, user.email, p.lastName, p.firstName, p.phone, p.deliveryMonth, at, at, at,
    );
    const id = Number(r.lastInsertRowid);
    insertLines(id, p.items);
    saveProfile(user.email, p);
    const n = newLinesCount(id);
    addEvent(id, user.email, n ? `Заявку створено (нових позицій: ${n})` : 'Заявку створено', at);
    return id;
  });
}

export function updateRequest(user: CurrentUser, id: number, body: any) {
  const req = get('SELECT * FROM requests WHERE id = ?', id);
  if (!req || req.customer_email !== user.email) throw new HttpError(404, 'Заявку не знайдено');
  if (req.status !== 'NEW' && req.status !== 'REWORK') {
    throw new HttpError(409, `Заявку у статусі «${REQUEST_STATUS[req.status as keyof typeof REQUEST_STATUS]}» не можна редагувати`);
  }
  const p = validatePayload(body, req.delivery_month);
  tx(() => {
    const t = now();
    const resubmit = req.status === 'REWORK';
    const r = run(
      `UPDATE requests SET last_name = ?, first_name = ?, phone = ?, delivery_month = ?, category_id = ?, type = ?,
         status = 'NEW', rework_comment = NULL, updated_at = ?, submitted_at = CASE WHEN ? THEN ? ELSE submitted_at END
       WHERE id = ? AND status IN ('NEW', 'REWORK')`,
      p.lastName, p.firstName, p.phone, p.deliveryMonth, p.categoryId, p.type, t, resubmit ? 1 : 0, t, id,
    );
    if (!r.changes) throw new HttpError(409, 'Заявку щойно змінив закупівельник. Оновіть сторінку.');
    insertLines(id, p.items);
    saveProfile(user.email, p);
    addEvent(id, user.email, resubmit ? 'Заявку виправлено та повторно відправлено' : 'Заявку відредаговано');
  });
}

export function cancelRequest(user: CurrentUser, id: number) {
  const req = get('SELECT * FROM requests WHERE id = ?', id);
  if (!req || req.customer_email !== user.email) throw new HttpError(404, 'Заявку не знайдено');
  const r = run("UPDATE requests SET status = 'CANCELLED', updated_at = ? WHERE id = ? AND status IN ('NEW', 'REWORK')", now(), id);
  if (!r.changes) throw new HttpError(409, 'Скасувати можна лише заявку у статусі «Нова» або «На доопрацюванні»');
  addEvent(id, user.email, 'Заявку скасовано замовником');
}

function statusLabel(s: string) {
  return REQUEST_STATUS[s as keyof typeof REQUEST_STATUS] ?? s;
}

function notActionable(id: number, verb: string): never {
  const cur = get('SELECT status, assignee_email FROM requests WHERE id = ?', id);
  if (!cur) throw new HttpError(404, 'Заявку не знайдено');
  if (cur.assignee_email) throw new HttpError(409, `Заявку вже взяв у роботу ${staffName(cur.assignee_email)}`);
  throw new HttpError(409, `Заявка має статус «${statusLabel(cur.status)}» — ${verb} неможливо`);
}

export function takeRequest(user: CurrentUser, id: number, at = now()) {
  requireRole(user, 'buyer');
  return tx(() => {
    const req = get('SELECT * FROM requests WHERE id = ?', id);
    if (!req) throw new HttpError(404, 'Заявку не знайдено');
    if (req.status === 'NEW') {
      const active = Number(get('SELECT COUNT(*) AS n FROM request_lines WHERE request_id = ? AND removed = 0', id)!.n);
      if (!active) throw new HttpError(409, 'З заявки видалено всі позиції — взяти її в роботу неможливо. Поверніть заявку на доопрацювання.');
    }
    // Атомарно: оновлюємо лише якщо заявка досі «Нова».
    const r = run(
      "UPDATE requests SET status = 'IN_PROGRESS', assignee_email = ?, taken_at = ?, updated_at = ? WHERE id = ? AND status = 'NEW'",
      user.email, at, at, id,
    );
    if (!r.changes) {
      if (req.assignee_email === user.email) throw new HttpError(409, 'Ви вже взяли цю заявку в роботу');
      notActionable(id, 'взяти в роботу');
    }
    // Нові позиції → у довідник (або прив'язка до наявного товару).
    const added: string[] = [];
    const linked: string[] = [];
    for (const l of all('SELECT * FROM request_lines WHERE request_id = ? AND product_id IS NULL AND removed = 0', id)) {
      const ex = exactProduct(l.new_name, req.category_id);
      let productId: number;
      if (ex) { productId = ex.id; linked.push(ex.name); }
      else {
        productId = Number(run(
          `INSERT INTO products (name, norm, unit, category_id, user_added, source_request_id, created_by, created_at)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
          l.new_name, normalizeName(l.new_name), l.new_unit, req.category_id, id, req.customer_email, at,
        ).lastInsertRowid);
        added.push(l.new_name);
      }
      run('UPDATE request_lines SET product_id = ? WHERE id = ?', productId, l.id);
    }
    run("UPDATE request_items SET executor_email = ?, status = 'IN_PROGRESS' WHERE request_id = ?", user.email, id);
    addEvent(id, user.email, `Заявку взято в роботу (${user.fullName})`, at);
    if (added.length) addEvent(id, user.email, `До довідника додано нові позиції: ${added.join('; ')}`, at);
    if (linked.length) addEvent(id, user.email, `Позиції прив'язано до наявних товарів довідника: ${linked.join('; ')}`, at);
    notify(req.customer_email, 'purchase', id, 'Заявку взято в роботу');
    return { added, linked };
  });
}

export function returnRequest(user: CurrentUser, id: number, commentRaw: string): Notice {
  requireRole(user, 'buyer');
  const comment = String(commentRaw ?? '').trim();
  if (comment.length < 3) throw new HttpError(400, 'Вкажіть коментар для замовника');
  return tx(() => {
    const r = run("UPDATE requests SET status = 'REWORK', rework_comment = ?, updated_at = ? WHERE id = ? AND status = 'NEW'", comment, now(), id);
    if (!r.changes) notActionable(id, 'повернути');
    addEvent(id, user.email, `Повернуто на доопрацювання: ${comment}`);
    const q = get('SELECT * FROM requests WHERE id = ?', id)!;
    notify(q.customer_email, 'purchase', id, 'Заявку повернуто на доопрацювання');
    return {
      to: q.customer_email, subject: `Заявка №${id} повернута на доопрацювання`, greeting: `${q.first_name} ${q.last_name}`,
      lines: [`Вашу заявку №${id} на закупівлю повернуто на доопрацювання.`],
      quoteLabel: `Коментар закупівельника (${user.fullName})`, quote: comment,
      linkPath: `/requests/${id}`, linkLabel: `Відкрити заявку №${id}`,
    };
  });
}

function loadNewLine(user: CurrentUser, requestId: number, lineId: number) {
  requireRole(user, 'buyer');
  const req = get('SELECT * FROM requests WHERE id = ?', requestId);
  if (!req) throw new HttpError(404, 'Заявку не знайдено');
  if (req.status !== 'NEW') throw new HttpError(409, `Нові позиції можна змінювати лише в заявці зі статусом «Нова» (зараз «${statusLabel(req.status)}»)`);
  const line = get('SELECT * FROM request_lines WHERE id = ? AND request_id = ?', lineId, requestId);
  if (!line || line.removed) throw new HttpError(404, 'Позицію не знайдено');
  if (line.product_id) throw new HttpError(409, 'Ця позиція вже є в довіднику');
  return { req, line };
}

/** «Виправити» нову позицію: назва й одиниця. Якщо такий товар уже є в довіднику — прив'язуємо до нього. */
export function fixLine(user: CurrentUser, requestId: number, lineId: number, body: any) {
  return tx(() => {
    const { req, line } = loadNewLine(user, requestId, lineId);
    const name = cleanName(body?.name);
    const unit = String(body?.unit ?? '');
    if (name.length < 3) throw new HttpError(400, 'Назва має містити щонайменше 3 символи');
    if (!UNITS.includes(unit)) throw new HttpError(400, 'Оберіть одиницю виміру');
    const ex = exactProduct(name, req.category_id);
    const dupNorm = normalizeName(name);
    for (const other of all('SELECT * FROM request_lines WHERE request_id = ? AND id != ? AND removed = 0', requestId, lineId)) {
      if ((ex && other.product_id === ex.id) || (!other.product_id && normalizeName(other.new_name) === dupNorm)) {
        throw new HttpError(409, 'Такий товар уже є в цій заявці');
      }
    }
    const was = `${line.new_name} (${line.new_unit})`;
    if (ex) {
      run('UPDATE request_lines SET product_id = ?, new_name = ?, new_unit = ? WHERE id = ?', ex.id, line.new_name, line.new_unit, lineId);
      addEvent(requestId, user.email, `Нову позицію «${was}» прив'язано до товару довідника «${ex.name}»`);
      return { linked: true, product: ex };
    }
    run('UPDATE request_lines SET new_name = ?, new_unit = ? WHERE id = ?', name, unit, lineId);
    addEvent(requestId, user.email, `Нову позицію виправлено: «${was}» → «${name} (${unit})»`);
    return { linked: false };
  });
}

/** «Видалити з заявки» нову позицію з обов'язковим коментарем: сповіщення + лист замовнику. */
export function removeLine(user: CurrentUser, requestId: number, lineId: number, commentRaw: string): Notice {
  const comment = String(commentRaw ?? '').trim();
  if (comment.length < 3) throw new HttpError(400, 'Вкажіть коментар: чому позицію видалено');
  return tx(() => {
    const { req, line } = loadNewLine(user, requestId, lineId);
    const qty = Number(get('SELECT COALESCE(SUM(qty), 0) AS n FROM request_items WHERE line_id = ?', lineId)!.n);
    run('DELETE FROM request_items WHERE line_id = ?', lineId);
    run('UPDATE request_lines SET removed = 1, removed_comment = ?, removed_by = ?, removed_at = ?, removed_qty = ? WHERE id = ?',
      comment, user.email, now(), qty, lineId);
    run('UPDATE requests SET updated_at = ? WHERE id = ?', now(), requestId);
    addEvent(requestId, user.email, `Позицію «${line.new_name}» видалено з заявки: ${comment}`);
    notify(req.customer_email, 'purchase', requestId, `Позицію «${line.new_name}» видалено з заявки`);
    return {
      to: req.customer_email, subject: `Заявка №${requestId}: позицію видалено`, greeting: `${req.first_name} ${req.last_name}`,
      lines: [`Із вашої заявки №${requestId} видалено позицію «${line.new_name}» (${qty} ${line.new_unit}).`],
      quoteLabel: `Коментар закупівельника (${user.fullName})`, quote: comment,
      linkPath: `/requests/${requestId}`, linkLabel: `Відкрити заявку №${requestId}`,
    };
  });
}

const LIST_FIELDS = `r.id, r.created_at AS createdAt, r.submitted_at AS submittedAt, r.delivery_month AS deliveryMonth, r.status, r.type,
  r.rework_comment AS reworkComment, r.last_name AS lastName, r.first_name AS firstName, r.assignee_email AS assigneeEmail, c.name AS category,
  (SELECT COUNT(*) FROM request_lines l WHERE l.request_id = r.id AND l.removed = 0) AS productCount,
  (SELECT COUNT(*) FROM request_lines l WHERE l.request_id = r.id AND l.removed = 0 AND l.product_id IS NULL) AS newCount,
  (SELECT COUNT(*) FROM request_lines l WHERE l.request_id = r.id AND l.removed = 1) AS removedCount,
  (SELECT COUNT(*) FROM request_items i WHERE i.request_id = r.id) AS itemCount,
  (SELECT COUNT(*) FROM request_items i WHERE i.request_id = r.id AND i.status = 'DONE') AS doneCount,
  (SELECT COUNT(*) FROM request_items i WHERE i.request_id = r.id AND i.status = 'IN_TRANSIT') AS transitCount`;

export function listMyRequests(user: CurrentUser): Row[] {
  const unread = unreadByRequest(user.email, 'purchase');
  return all(`SELECT ${LIST_FIELDS} FROM requests r JOIN categories c ON c.id = r.category_id WHERE r.customer_email = ? ORDER BY r.id DESC`, user.email)
    .map((r) => ({ ...r, unread: unread[r.id] ?? [] }));
}

/** Усі заявки для закупівельника (фільтрує інтерфейс; за замовчуванням — «Нова»). */
export function buyerRequests(): Row[] {
  return all(`SELECT ${LIST_FIELDS}, (SELECT full_name FROM users u WHERE u.email = r.assignee_email) AS assigneeName
    FROM requests r JOIN categories c ON c.id = r.category_id
    ORDER BY CASE WHEN r.status = 'NEW' THEN 0 ELSE 1 END, r.submitted_at DESC, r.id DESC`);
}

export function inboxCount(): number {
  return Number(get("SELECT COUNT(*) AS n FROM requests WHERE status = 'NEW'")!.n);
}

export function getRequest(user: CurrentUser, id: number) {
  const r = get('SELECT r.*, c.name AS category FROM requests r JOIN categories c ON c.id = r.category_id WHERE r.id = ?', id);
  const allowed = r && (user.role === 'buyer' || (user.role === 'customer' && r.customer_email === user.email));
  if (!allowed) throw new HttpError(404, 'Заявку не знайдено');
  if (user.role === 'customer') markRead(user.email, 'purchase', id);
  const lines = all(
    `SELECT l.id, l.line_order AS lineOrder, l.product_id AS productId, COALESCE(p.name, l.new_name) AS name,
            COALESCE(p.unit, l.new_unit) AS unit, CASE WHEN l.product_id IS NULL THEN 1 ELSE 0 END AS isNew, l.was_new AS wasNew,
            l.new_name AS newName, l.new_unit AS newUnit, p.source_request_id AS sourceRequestId, p.user_added AS userAdded,
            l.removed, l.removed_comment AS removedComment, l.removed_at AS removedAt, l.removed_qty AS removedQty,
            (SELECT full_name FROM users u WHERE u.email = l.removed_by) AS removedByName
       FROM request_lines l LEFT JOIN products p ON p.id = l.product_id
      WHERE l.request_id = ? ORDER BY l.line_order`,
    id,
  );
  const items = all(
    `SELECT i.id, i.line_id AS lineId, i.location_id AS locationId, l.name AS locationName, i.qty, i.status,
            i.planned_date AS plannedDate, i.executor_email AS executorEmail, u.full_name AS executorName
       FROM request_items i JOIN locations l ON l.id = i.location_id LEFT JOIN users u ON u.email = i.executor_email
      WHERE i.request_id = ? ORDER BY l.sort`,
    id,
  );
  const events = all(
    `SELECT e.at, e.actor_email AS actorEmail, COALESCE(u.full_name, NULLIF(TRIM(cp.last_name || ' ' || cp.first_name), ''), e.actor_email) AS actorName, e.text
       FROM request_events e LEFT JOIN users u ON u.email = e.actor_email LEFT JOIN customer_profiles cp ON cp.email = e.actor_email
      WHERE e.request_id = ? ORDER BY e.id`,
    id,
  );
  return {
    id: r.id, type: r.type, status: r.status, categoryId: r.category_id, category: r.category,
    customerEmail: r.customer_email, lastName: r.last_name, firstName: r.first_name, phone: r.phone,
    deliveryMonth: r.delivery_month, assigneeEmail: r.assignee_email, assigneeName: staffName(r.assignee_email),
    takenAt: r.taken_at, reworkComment: r.rework_comment, createdAt: r.created_at, updatedAt: r.updated_at,
    submittedAt: r.submitted_at, lines, items, events,
  };
}

// ---------- Зведена потреба ----------

export type SummaryFilters = { categoryId: number; month?: string; executor?: string; status?: string; locationId?: number; productId?: number };

export function parseFilters(q: any): SummaryFilters {
  const num = (v: any) => (v === undefined || v === '' ? undefined : Number(v));
  const str = (v: any) => (v === undefined || v === '' ? undefined : String(v));
  return { categoryId: Number(q.categoryId), month: str(q.month), executor: str(q.executor), status: str(q.status), locationId: num(q.locationId), productId: num(q.productId) };
}

const SUMMARY_FROM = `FROM request_items i
  JOIN requests r ON r.id = i.request_id
  JOIN request_lines rl ON rl.id = i.line_id
  LEFT JOIN products p ON p.id = rl.product_id
  JOIN locations l ON l.id = i.location_id`;

export function summaryRows(f: SummaryFilters): Row[] {
  const where = ["r.status IN ('IN_PROGRESS', 'DONE')", 'r.category_id = ?'];
  const params: any[] = [f.categoryId];
  if (f.month) { where.push('r.delivery_month = ?'); params.push(f.month); }
  if (f.executor) {
    if (f.executor === '__none__') where.push('i.executor_email IS NULL');
    else { where.push('i.executor_email = ?'); params.push(f.executor); }
  }
  if (f.status) { where.push('i.status = ?'); params.push(f.status); }
  if (f.locationId) { where.push('i.location_id = ?'); params.push(f.locationId); }
  if (f.productId) { where.push('rl.product_id = ?'); params.push(f.productId); }
  return all(
    `SELECT i.id, r.id AS requestId, r.last_name || ' ' || r.first_name AS customerName, r.delivery_month AS deliveryMonth,
            i.executor_email AS executorEmail, u.full_name AS executorName, i.planned_date AS plannedDate,
            rl.product_id AS productId, COALESCE(p.name, rl.new_name) AS productName, COALESCE(p.unit, rl.new_unit) AS unit,
            l.id AS locationId, l.name AS locationName, i.qty, i.status
       ${SUMMARY_FROM} LEFT JOIN users u ON u.email = i.executor_email
      WHERE ${where.join(' AND ')}
      ORDER BY r.delivery_month ASC, r.id DESC, rl.line_order, l.sort`,
    ...params,
  );
}

export function summaryOptions(categoryId: number) {
  const base = `${SUMMARY_FROM} WHERE r.status IN ('IN_PROGRESS','DONE') AND r.category_id = ?`;
  return {
    months: all(`SELECT DISTINCT r.delivery_month AS value ${base} ORDER BY 1`, categoryId).map((m) => ({ value: m.value, label: monthLabel(m.value) })),
    locations: all(`SELECT DISTINCT l.id, l.name, l.sort ${base} ORDER BY l.sort`, categoryId),
    products: all(`SELECT DISTINCT p.id, p.name ${base} AND p.id IS NOT NULL ORDER BY p.name`, categoryId),
  };
}

export function updateItems(user: CurrentUser, body: any): { updated: number; autoDone: number[]; mails: Notice[] } {
  requireRole(user, 'buyer');
  const ids: number[] = (Array.isArray(body?.ids) ? body.ids : []).map(Number).filter(Number.isInteger);
  if (!ids.length) throw new HttpError(400, 'Не вибрано жодної позиції');
  const sets: string[] = [];
  const params: any[] = [];
  const changes: string[] = [];
  if (body.status !== undefined) {
    if (!(body.status in ITEM_STATUS)) throw new HttpError(400, 'Невідомий статус позиції');
    sets.push('status = ?'); params.push(body.status);
    changes.push(`статус «${ITEM_STATUS[body.status as keyof typeof ITEM_STATUS]}»`);
  }
  if (body.plannedDate !== undefined) {
    const d = body.plannedDate ? String(body.plannedDate) : null;
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new HttpError(400, 'Невірна дата');
    sets.push('planned_date = ?'); params.push(d);
    changes.push(d ? `планова дата ${d.split('-').reverse().join('.')}` : 'планову дату очищено');
  }
  if (body.executorEmail !== undefined) {
    const e = body.executorEmail ? String(body.executorEmail) : null;
    if (e && !get("SELECT 1 FROM users WHERE email = ? AND role = 'buyer'", e)) throw new HttpError(400, 'Невідомий виконавець');
    sets.push('executor_email = ?'); params.push(e);
    changes.push(e ? `виконавець ${staffName(e)}` : 'виконавця знято');
  }
  if (!sets.length) throw new HttpError(400, 'Немає змін');

  return tx(() => {
    const valid = all(
      `SELECT i.id, i.request_id FROM request_items i JOIN requests r ON r.id = i.request_id
        WHERE i.id IN (${ids.map(() => '?').join(',')}) AND r.status IN ('IN_PROGRESS','DONE')`,
      ...ids,
    );
    if (!valid.length) throw new HttpError(400, 'Позиції не знайдено');
    const validIds = valid.map((v) => v.id);
    run(`UPDATE request_items SET ${sets.join(', ')} WHERE id IN (${validIds.map(() => '?').join(',')})`, ...params, ...validIds);

    const autoDone: number[] = [];
    const mails: Notice[] = [];
    for (const rid of [...new Set(valid.map((v) => v.request_id as number))]) {
      addEvent(rid, user.email, `Оновлено позицій: ${valid.filter((v) => v.request_id === rid).length} — ${changes.join(', ')}`);
      const s = get("SELECT COUNT(*) AS total, SUM(status = 'DONE') AS done FROM request_items WHERE request_id = ?", rid)!;
      const req = get('SELECT * FROM requests WHERE id = ?', rid)!;
      const allDone = Number(s.total) > 0 && Number(s.total) === Number(s.done);
      if (allDone && req.status !== 'DONE') {
        run("UPDATE requests SET status = 'DONE', updated_at = ? WHERE id = ?", now(), rid);
        addEvent(rid, 'system', 'Усі позиції виконано — заявка автоматично отримала статус «Виконано»');
        notify(req.customer_email, 'purchase', rid, 'Заявку виконано');
        mails.push({
          to: req.customer_email, subject: `Заявку №${rid} виконано`, greeting: `${req.first_name} ${req.last_name}`,
          lines: [`Усі позиції вашої заявки №${rid} на закупівлю виконано.`],
          linkPath: `/requests/${rid}`, linkLabel: `Відкрити заявку №${rid}`,
        });
        autoDone.push(rid);
      } else if (!allDone && req.status === 'DONE') {
        run("UPDATE requests SET status = 'IN_PROGRESS', updated_at = ? WHERE id = ?", now(), rid);
        addEvent(rid, 'system', 'Не всі позиції виконано — заявку повернуто у статус «В роботі»');
        notify(req.customer_email, 'purchase', rid, 'Заявку повернуто у статус «В роботі»');
      } else {
        run('UPDATE requests SET updated_at = ? WHERE id = ?', now(), rid);
      }
    }
    return { updated: validIds.length, autoDone, mails };
  });
}
