// Блок «Доставка та логістика»: заявки на перевезення, диспетчер, історія статусів.
import { all, get, run, tx, now, type Row } from './db.ts';
import { HttpError, notify, markRead, requireRole, staffName, unreadByRequest, type CurrentUser } from './services.ts';
import { PHONE_RE, TRANSPORT_STATUS, formatLocalDateTime, localNow } from '../shared/constants.ts';
import type { Notice } from './mail.ts';

type TStatus = keyof typeof TRANSPORT_STATUS;
const label = (s: string) => TRANSPORT_STATUS[s as TStatus] ?? s;
const DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const str = (v: unknown) => String(v ?? '').trim();
const phone = (v: unknown) => String(v ?? '').replace(/[^\d+]/g, '');

function addTEvent(id: number, actor: string, from: string | null, to: string | null, text: string, comment?: string | null) {
  run('INSERT INTO transport_events (request_id, at, actor_email, status_from, status_to, comment, text) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, now(), actor, from, to, comment ?? null, text);
}

function load(id: number): Row {
  const r = get('SELECT * FROM transport_requests WHERE id = ?', id);
  if (!r) throw new HttpError(404, 'Заявку на перевезення не знайдено');
  return r;
}

function validate(body: any, opts: { allowPastLoad?: string } = {}) {
  const e: string[] = [];
  const v = {
    fullName: str(body?.fullName), phone: phone(body?.phone), position: str(body?.position),
    loadAddress: str(body?.loadAddress), loadContactName: str(body?.loadContactName), loadContactPhone: phone(body?.loadContactPhone),
    loadAt: str(body?.loadAt), cargoDetails: str(body?.cargoDetails), seal: str(body?.seal),
    unloadAddress: str(body?.unloadAddress), unloadContactName: str(body?.unloadContactName), unloadContactPhone: phone(body?.unloadContactPhone),
    unloadCompany: str(body?.unloadCompany), unloadAt: str(body?.unloadAt),
  };
  if (!v.fullName) e.push("Вкажіть прізвище та ім'я");
  if (!PHONE_RE.test(v.phone)) e.push('Контактний телефон: формат +380XXXXXXXXX');
  if (!v.position) e.push('Вкажіть посаду');
  if (!v.loadAddress) e.push('Вкажіть адресу завантаження');
  if (!v.loadContactName) e.push("Вкажіть ім'я контактної особи на завантаженні");
  if (!PHONE_RE.test(v.loadContactPhone)) e.push('Телефон контактної особи на завантаженні: формат +380XXXXXXXXX');
  if (!DT_RE.test(v.loadAt)) e.push('Вкажіть бажану дату та час завантаження');
  else if (v.loadAt < localNow() && v.loadAt !== opts.allowPastLoad) e.push('Дата завантаження не може бути в минулому');
  if (!v.cargoDetails) e.push('Опишіть вантаж');
  if (v.seal !== 'yes' && v.seal !== 'no') e.push('Оберіть потребу в печатці: «Так» або «Ні»');
  if (!v.unloadAddress) e.push('Вкажіть адресу вивантаження');
  if (v.unloadContactPhone && !PHONE_RE.test(v.unloadContactPhone)) e.push('Телефон на вивантаженні: формат +380XXXXXXXXX');
  if (!DT_RE.test(v.unloadAt)) e.push('Вкажіть бажану дату та час вивантаження');
  else if (DT_RE.test(v.loadAt) && v.unloadAt < v.loadAt) e.push('Дата вивантаження не може бути раніше дати завантаження');
  if (e.length) throw new HttpError(400, e.join('; '));
  return v;
}

function saveProfile(email: string, v: { fullName: string; phone: string; position: string }) {
  run(
    `INSERT INTO customer_profiles (email, phone, transport_name, position, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET transport_name = excluded.transport_name, position = excluded.position,
       phone = excluded.phone, updated_at = excluded.updated_at`,
    email, v.phone, v.fullName, v.position, now(),
  );
}

export function createTransport(user: CurrentUser, body: any, at = now()): number {
  requireRole(user, 'customer');
  const v = validate(body);
  return tx(() => {
    const id = Number(run(
      `INSERT INTO transport_requests (status, customer_email, full_name, phone, position, load_address, load_contact_name, load_contact_phone,
         load_at, cargo_details, seal_required, unload_address, unload_contact_name, unload_contact_phone, unload_company, unload_at,
         created_at, updated_at, submitted_at)
       VALUES ('NEW', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      user.email, v.fullName, v.phone, v.position, v.loadAddress, v.loadContactName, v.loadContactPhone, v.loadAt, v.cargoDetails,
      v.seal === 'yes' ? 1 : 0, v.unloadAddress, v.unloadContactName || null, v.unloadContactPhone || null, v.unloadCompany || null, v.unloadAt,
      at, at, at,
    ).lastInsertRowid);
    run('INSERT INTO transport_events (request_id, at, actor_email, status_from, status_to, text) VALUES (?, ?, ?, NULL, ?, ?)', id, at, user.email, 'NEW', 'Заявку створено');
    saveProfile(user.email, v);
    return id;
  });
}

export function updateTransport(user: CurrentUser, id: number, body: any) {
  const r = load(id);
  if (r.customer_email !== user.email) throw new HttpError(404, 'Заявку на перевезення не знайдено');
  if (r.status !== 'NEW' && r.status !== 'REWORK') throw new HttpError(409, `Заявку у статусі «${label(r.status)}» не можна редагувати`);
  const v = validate(body, { allowPastLoad: r.load_at });
  tx(() => {
    const t = now();
    const resubmit = r.status === 'REWORK';
    const res = run(
      `UPDATE transport_requests SET full_name = ?, phone = ?, position = ?, load_address = ?, load_contact_name = ?, load_contact_phone = ?,
         load_at = ?, cargo_details = ?, seal_required = ?, unload_address = ?, unload_contact_name = ?, unload_contact_phone = ?,
         unload_company = ?, unload_at = ?, status = 'NEW', rework_comment = NULL, updated_at = ?,
         submitted_at = CASE WHEN ? THEN ? ELSE submitted_at END
       WHERE id = ? AND status IN ('NEW', 'REWORK')`,
      v.fullName, v.phone, v.position, v.loadAddress, v.loadContactName, v.loadContactPhone, v.loadAt, v.cargoDetails, v.seal === 'yes' ? 1 : 0,
      v.unloadAddress, v.unloadContactName || null, v.unloadContactPhone || null, v.unloadCompany || null, v.unloadAt, t, resubmit ? 1 : 0, t, id,
    );
    if (!res.changes) throw new HttpError(409, 'Заявку щойно змінив диспетчер. Оновіть сторінку.');
    addTEvent(id, user.email, r.status, 'NEW', resubmit ? 'Заявку виправлено та повторно відправлено' : 'Заявку відредаговано');
    saveProfile(user.email, v);
  });
}

export function cancelTransport(user: CurrentUser, id: number, commentRaw: unknown) {
  const r = load(id);
  if (r.customer_email !== user.email) throw new HttpError(404, 'Заявку на перевезення не знайдено');
  const comment = str(commentRaw);
  if (comment.length < 3) throw new HttpError(400, 'Вкажіть причину скасування');
  const res = run("UPDATE transport_requests SET status = 'CANCELLED', cancel_comment = ?, updated_at = ? WHERE id = ? AND status IN ('NEW', 'REWORK')", comment, now(), id);
  if (!res.changes) throw new HttpError(409, 'Скасувати можна лише заявку у статусі «Нова» або «На доопрацюванні»');
  addTEvent(id, user.email, r.status, 'CANCELLED', 'Заявку скасовано замовником', comment);
}

function busy(id: number, verb: string): never {
  const cur = load(id);
  if (cur.dispatcher_email && cur.status !== 'NEW') throw new HttpError(409, `Заявку вже взяв у роботу ${staffName(cur.dispatcher_email)}`);
  throw new HttpError(409, `Заявка має статус «${label(cur.status)}» — ${verb} неможливо`);
}

export function takeTransport(user: CurrentUser, id: number) {
  requireRole(user, 'dispatcher');
  return tx(() => {
    const t = now();
    const res = run("UPDATE transport_requests SET status = 'IN_PROGRESS', dispatcher_email = ?, taken_at = ?, updated_at = ? WHERE id = ? AND status = 'NEW'", user.email, t, t, id);
    if (!res.changes) busy(id, 'взяти в роботу');
    const r = load(id);
    addTEvent(id, user.email, 'NEW', 'IN_PROGRESS', `Заявку взято в роботу (${user.fullName})`);
    notify(r.customer_email, 'transport', id, 'Заявку взято в роботу');
  });
}

export function reworkTransport(user: CurrentUser, id: number, commentRaw: unknown): Notice {
  requireRole(user, 'dispatcher');
  const comment = str(commentRaw);
  if (comment.length < 3) throw new HttpError(400, 'Вкажіть коментар для замовника');
  return tx(() => {
    const res = run("UPDATE transport_requests SET status = 'REWORK', rework_comment = ?, updated_at = ? WHERE id = ? AND status = 'NEW'", comment, now(), id);
    if (!res.changes) busy(id, 'відправити на доопрацювання');
    const r = load(id);
    addTEvent(id, user.email, 'NEW', 'REWORK', 'Відправлено на доопрацювання', comment);
    notify(r.customer_email, 'transport', id, 'Заявку повернуто на доопрацювання');
    return {
      to: r.customer_email, subject: `Заявка на перевезення №${id} повернута на доопрацювання`, greeting: r.full_name,
      lines: [`Вашу заявку на перевезення №${id} (${r.load_address} → ${r.unload_address}) повернуто на доопрацювання.`],
      quoteLabel: `Коментар диспетчера (${user.fullName})`, quote: comment,
      linkPath: `/transport/${id}`, linkLabel: `Відкрити заявку №${id}`,
    };
  });
}

export function setCar(user: CurrentUser, id: number, body: any): Notice {
  requireRole(user, 'dispatcher');
  const c = {
    driverName: str(body?.driverName), driverPhone: phone(body?.driverPhone), carModel: str(body?.carModel), carNumber: str(body?.carNumber).toUpperCase(),
    driverLicense: str(body?.driverLicense), loadAt: str(body?.loadAt), deliveryAt: str(body?.deliveryAt),
  };
  const e: string[] = [];
  if (!c.driverName) e.push("Вкажіть прізвище та ім'я водія");
  if (!PHONE_RE.test(c.driverPhone)) e.push('Телефон водія: формат +380XXXXXXXXX');
  if (!c.carNumber) e.push('Вкажіть номер авто');
  if (!DT_RE.test(c.loadAt)) e.push('Вкажіть дату завантаження');
  if (!DT_RE.test(c.deliveryAt)) e.push('Вкажіть дату доставки');
  else if (DT_RE.test(c.loadAt) && c.deliveryAt < c.loadAt) e.push('Дата доставки не може бути раніше дати завантаження');
  if (e.length) throw new HttpError(400, e.join('; '));
  return tx(() => {
    const r = load(id);
    if (!['IN_PROGRESS', 'CAR_ASSIGNED', 'LOADED'].includes(r.status)) throw new HttpError(409, `Дані авто можна внести лише в заявці «В роботі» або пізніше (зараз «${label(r.status)}»)`);
    const first = r.status === 'IN_PROGRESS';
    const newStatus = first ? 'CAR_ASSIGNED' : r.status;
    run(
      `UPDATE transport_requests SET driver_name = ?, driver_phone = ?, car_model = ?, car_number = ?, driver_license = ?, car_load_at = ?,
         car_delivery_at = ?, status = ?, dispatcher_email = COALESCE(dispatcher_email, ?), updated_at = ? WHERE id = ?`,
      c.driverName, c.driverPhone, c.carModel || null, c.carNumber, c.driverLicense || null, c.loadAt, c.deliveryAt, newStatus, user.email, now(), id,
    );
    const summary = `${c.carNumber}${c.carModel ? ` (${c.carModel})` : ''}, водій ${c.driverName}`;
    addTEvent(id, user.email, r.status, newStatus, first ? `Авто призначено: ${summary}` : `Дані авто змінено: ${summary}`);
    notify(r.customer_email, 'transport', id, first ? 'Авто призначено' : 'Дані авто змінено');
    return {
      to: r.customer_email, subject: first ? `Заявка №${id}: авто призначено` : `Заявка №${id}: дані авто змінено`, greeting: r.full_name,
      lines: [first ? `На вашу заявку на перевезення №${id} призначено авто.` : `У заявці на перевезення №${id} змінено дані авто.`,
        `Маршрут: ${r.load_address} → ${r.unload_address}.`],
      details: [
        ['Номер авто', c.carNumber], ...(c.carModel ? [['Марка та модель', c.carModel] as [string, string]] : []),
        ['Водій', c.driverName], ['Телефон водія', c.driverPhone],
        ['Дата завантаження', formatLocalDateTime(c.loadAt)], ['Дата доставки', formatLocalDateTime(c.deliveryAt)],
      ],
      linkPath: `/transport/${id}`, linkLabel: `Відкрити заявку №${id}`,
    };
  });
}

export function markLoaded(user: CurrentUser, id: number) {
  const r = load(id);
  const isOwner = user.role === 'customer' && r.customer_email === user.email;
  if (!isOwner && user.role !== 'dispatcher') throw new HttpError(404, 'Заявку на перевезення не знайдено');
  const res = run("UPDATE transport_requests SET status = 'LOADED', updated_at = ? WHERE id = ? AND status = 'CAR_ASSIGNED'", now(), id);
  if (!res.changes) throw new HttpError(409, `«Авто завантажено» доступно лише у статусі «Авто призначено» (зараз «${label(load(id).status)}»)`);
  addTEvent(id, user.email, 'CAR_ASSIGNED', 'LOADED', isOwner ? 'Замовник підтвердив: авто завантажено' : 'Диспетчер підтвердив: авто завантажено');
  if (!isOwner) notify(r.customer_email, 'transport', id, 'Авто завантажено');
}

export function completeTransport(user: CurrentUser, id: number): Notice {
  requireRole(user, 'dispatcher');
  return tx(() => {
    const t = now();
    const res = run("UPDATE transport_requests SET status = 'DONE', completed_at = ?, updated_at = ? WHERE id = ? AND status = 'LOADED'", t, t, id);
    if (!res.changes) throw new HttpError(409, `«Заявку виконано» доступно лише у статусі «Завантажено» (зараз «${label(load(id).status)}»)`);
    const r = load(id);
    addTEvent(id, user.email, 'LOADED', 'DONE', 'Заявку виконано');
    notify(r.customer_email, 'transport', id, 'Заявку виконано');
    return {
      to: r.customer_email, subject: `Заявку на перевезення №${id} виконано`, greeting: r.full_name,
      lines: [`Перевезення за заявкою №${id} виконано: ${r.load_address} → ${r.unload_address}.`],
      details: [['Дата виконання', new Date(t).toLocaleString('uk-UA')]],
      linkPath: `/transport/${id}`, linkLabel: `Відкрити заявку №${id}`,
    };
  });
}

const LIST = `SELECT t.id, t.status, t.created_at AS createdAt, t.customer_email AS customerEmail, t.full_name AS fullName,
  t.load_address AS loadAddress, t.unload_address AS unloadAddress, t.load_at AS loadAt, t.unload_at AS unloadAt,
  t.seal_required AS sealRequired, t.car_number AS carNumber, t.driver_name AS driverName, t.completed_at AS completedAt,
  t.dispatcher_email AS dispatcherEmail, u.full_name AS dispatcherName, t.rework_comment AS reworkComment
  FROM transport_requests t LEFT JOIN users u ON u.email = t.dispatcher_email`;

export function listMyTransport(user: CurrentUser): Row[] {
  const unread = unreadByRequest(user.email, 'transport');
  return all(`${LIST} WHERE t.customer_email = ? ORDER BY t.id DESC`, user.email).map((r) => ({ ...r, unread: unread[r.id] ?? [] }));
}

export function listAllTransport(user: CurrentUser): Row[] {
  requireRole(user, 'dispatcher');
  return all(`${LIST} ORDER BY CASE WHEN t.status = 'NEW' THEN 0 ELSE 1 END, t.load_at ASC, t.id DESC`);
}

export function newTransportCount(): number {
  return Number(get("SELECT COUNT(*) AS n FROM transport_requests WHERE status = 'NEW'")!.n);
}

export function getTransport(user: CurrentUser, id: number) {
  const r = load(id);
  const allowed = user.role === 'dispatcher' || (user.role === 'customer' && r.customer_email === user.email);
  if (!allowed) throw new HttpError(404, 'Заявку на перевезення не знайдено');
  if (user.role === 'customer') markRead(user.email, 'transport', id);
  const events = all(
    `SELECT e.at, e.actor_email AS actorEmail, e.status_from AS statusFrom, e.status_to AS statusTo, e.comment, e.text,
            COALESCE(u.full_name, cp.transport_name, NULLIF(TRIM(cp.last_name || ' ' || cp.first_name), ''), e.actor_email) AS actorName
       FROM transport_events e LEFT JOIN users u ON u.email = e.actor_email LEFT JOIN customer_profiles cp ON cp.email = e.actor_email
      WHERE e.request_id = ? ORDER BY e.id`,
    id,
  );
  return {
    id: r.id, status: r.status, customerEmail: r.customer_email, fullName: r.full_name, phone: r.phone, position: r.position,
    loadAddress: r.load_address, loadContactName: r.load_contact_name, loadContactPhone: r.load_contact_phone, loadAt: r.load_at,
    cargoDetails: r.cargo_details, sealRequired: !!r.seal_required,
    unloadAddress: r.unload_address, unloadContactName: r.unload_contact_name, unloadContactPhone: r.unload_contact_phone,
    unloadCompany: r.unload_company, unloadAt: r.unload_at,
    dispatcherEmail: r.dispatcher_email, dispatcherName: staffName(r.dispatcher_email), takenAt: r.taken_at,
    reworkComment: r.rework_comment, cancelComment: r.cancel_comment,
    car: r.car_number ? {
      driverName: r.driver_name, driverPhone: r.driver_phone, carModel: r.car_model, carNumber: r.car_number,
      driverLicense: r.driver_license, loadAt: r.car_load_at, deliveryAt: r.car_delivery_at,
    } : null,
    completedAt: r.completed_at, createdAt: r.created_at, updatedAt: r.updated_at, submittedAt: r.submitted_at, events,
  };
}
