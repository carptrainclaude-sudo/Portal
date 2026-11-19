import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { ROOT, all, get } from './db.ts';
import {
  HttpError, resolveUser, buyers, staff, searchProducts, findSimilarProducts, requireRole,
  createRequest, updateRequest, cancelRequest, takeRequest, returnRequest, fixLine, removeLine, listMyRequests, buyerRequests,
  inboxCount, getRequest, parseFilters, summaryRows, summaryOptions, updateItems, unreadSummary, type CurrentUser,
} from './services.ts';
import {
  createTransport, updateTransport, cancelTransport, takeTransport, reworkTransport, setCar, markLoaded, completeTransport,
  listMyTransport, listAllTransport, newTransportCount, getTransport,
} from './transport.ts';
import { sendNotice, APP_URL, type Notice } from './mail.ts';
import { buildPdf, buildXlsx } from './export.ts';
import { ITEM_STATUS, UNITS, monthLabel, monthOptions } from '../shared/constants.ts';

const PORT = Number(process.env.PORT ?? 3000);
const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const COOKIE = 'portal_user';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser('test-env-only-secret'));

declare global {
  namespace Express {
    interface Request { user?: CurrentUser }
  }
}

app.use((req, _res, next) => {
  const email = req.signedCookies?.[COOKIE];
  if (email) req.user = resolveUser(email) ?? undefined;
  next();
});

const auth = (req: Request) => {
  if (!req.user) throw new HttpError(401, 'Потрібно увійти');
  return req.user;
};
const as = (req: Request, role: 'buyer' | 'dispatcher' | 'customer') => {
  const u = auth(req);
  requireRole(u, role);
  return u;
};
const num = (v: unknown) => {
  const id = Number(v);
  if (!Number.isInteger(id)) throw new HttpError(400, 'Невірний ID');
  return id;
};
const mail = async (...notices: Notice[]) => (await Promise.all(notices.map(sendNotice))).every(Boolean);

// ---------- Авторизація (лише для тестового середовища: без пароля) ----------

app.post('/api/auth/login', (req, res) => {
  const user = resolveUser(req.body?.email);
  if (!user) throw new HttpError(400, 'Вкажіть коректний email');
  res.cookie(COOKIE, user.email, { signed: true, httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 });
  res.json(user);
});
app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});
app.get('/api/auth/me', (req, res) => res.json(req.user ?? null));
app.get('/api/auth/demo-users', (_req, res) => {
  res.json([
    { email: 'customer1@test.ua', role: 'customer' },
    { email: 'customer2@test.ua', role: 'customer' },
    ...staff('buyer').map((b) => ({ email: b.email, role: 'buyer', fullName: b.fullName })),
    ...staff('dispatcher').map((b) => ({ email: b.email, role: 'dispatcher', fullName: b.fullName })),
  ]);
});

// ---------- Довідники, профіль, лічильники ----------

app.get('/api/meta', (req, res) => {
  auth(req);
  res.json({
    categories: all('SELECT id, name FROM categories ORDER BY id'),
    locations: all('SELECT id, name FROM locations ORDER BY sort'),
    units: UNITS,
    buyers: buyers(),
    dispatchers: staff('dispatcher'),
    months: monthOptions(),
    mailpitUrl: MAILPIT_URL,
  });
});

app.get('/api/products', (req, res) => {
  auth(req);
  const q = String(req.query.q ?? '');
  res.json(q.trim().length < 2 ? [] : searchProducts(q, Number(req.query.categoryId)));
});
app.post('/api/products/check', (req, res) => {
  auth(req);
  res.json(findSimilarProducts(String(req.body?.name ?? ''), Number(req.body?.categoryId)));
});

app.get('/api/profile', (req, res) => {
  const u = auth(req);
  const p = get(
    'SELECT last_name AS lastName, first_name AS firstName, phone, transport_name AS transportName, position FROM customer_profiles WHERE email = ?',
    u.email,
  );
  res.json(p ?? null);
});

app.get('/api/counters', (req, res) => {
  const u = auth(req);
  if (u.role === 'buyer') return res.json({ inbox: inboxCount() });
  if (u.role === 'dispatcher') return res.json({ transportNew: newTransportCount() });
  res.json({ unread: unreadSummary(u.email) });
});

// ---------- Заявки на закупівлю ----------

app.get('/api/requests/my', (req, res) => res.json(listMyRequests(auth(req))));
app.post('/api/requests', (req, res) => res.json({ id: createRequest(auth(req), req.body) }));
app.get('/api/requests/:id', (req, res) => res.json(getRequest(auth(req), num(req.params.id))));
app.put('/api/requests/:id', (req, res) => {
  updateRequest(auth(req), num(req.params.id), req.body);
  res.json({ ok: true });
});
app.post('/api/requests/:id/cancel', (req, res) => {
  cancelRequest(auth(req), num(req.params.id));
  res.json({ ok: true });
});
app.post('/api/requests/:id/take', (req, res) => res.json({ ok: true, ...takeRequest(as(req, 'buyer'), num(req.params.id)) }));
app.post('/api/requests/:id/return', async (req, res) => {
  const notice = returnRequest(as(req, 'buyer'), num(req.params.id), req.body?.comment);
  res.json({ ok: true, mailSent: await mail(notice) });
});
app.post('/api/requests/:id/lines/:lineId/fix', (req, res) => {
  res.json({ ok: true, ...fixLine(as(req, 'buyer'), num(req.params.id), num(req.params.lineId), req.body) });
});
app.post('/api/requests/:id/lines/:lineId/remove', async (req, res) => {
  const notice = removeLine(as(req, 'buyer'), num(req.params.id), num(req.params.lineId), req.body?.comment);
  res.json({ ok: true, mailSent: await mail(notice) });
});

// ---------- Закупівельник ----------

app.get('/api/buyer/requests', (req, res) => {
  as(req, 'buyer');
  res.json(buyerRequests());
});
app.get('/api/summary', (req, res) => {
  as(req, 'buyer');
  const f = parseFilters(req.query);
  res.json({ rows: summaryRows(f), options: summaryOptions(f.categoryId) });
});
app.patch('/api/items', async (req, res) => {
  const { mails, ...r } = updateItems(as(req, 'buyer'), req.body);
  if (mails.length) await mail(...mails);
  res.json(r);
});
app.get('/api/summary/export', async (req, res) => {
  as(req, 'buyer');
  const f = parseFilters(req.query);
  const category = get('SELECT name FROM categories WHERE id = ?', f.categoryId)?.name ?? '';
  const rows = summaryRows(f);
  const parts: string[] = [];
  if (f.month) parts.push(`місяць: ${monthLabel(f.month)}`);
  if (f.executor) parts.push(`виконавець: ${f.executor === '__none__' ? 'не призначено' : get('SELECT full_name FROM users WHERE email = ?', f.executor)?.full_name ?? f.executor}`);
  if (f.status) parts.push(`статус: ${ITEM_STATUS[f.status as keyof typeof ITEM_STATUS] ?? f.status}`);
  if (f.locationId) parts.push(`локація: ${get('SELECT name FROM locations WHERE id = ?', f.locationId)?.name ?? ''}`);
  if (f.productId) parts.push(`товар: ${get('SELECT name FROM products WHERE id = ?', f.productId)?.name ?? ''}`);
  const filterText = parts.join('; ');
  const name = `zvedena-potreba-${new Date().toISOString().slice(0, 10)}`;
  if (req.query.format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.pdf"`);
    res.send(await buildPdf(rows, filterText, category));
  } else {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`);
    res.send(await buildXlsx(rows, filterText, category));
  }
});

// ---------- Перевезення ----------

app.get('/api/transport/my', (req, res) => res.json(listMyTransport(as(req, 'customer'))));
app.get('/api/transport/all', (req, res) => res.json(listAllTransport(auth(req))));
app.post('/api/transport', (req, res) => res.json({ id: createTransport(auth(req), req.body) }));
app.get('/api/transport/:id', (req, res) => res.json(getTransport(auth(req), num(req.params.id))));
app.put('/api/transport/:id', (req, res) => {
  updateTransport(auth(req), num(req.params.id), req.body);
  res.json({ ok: true });
});
app.post('/api/transport/:id/cancel', (req, res) => {
  cancelTransport(auth(req), num(req.params.id), req.body?.comment);
  res.json({ ok: true });
});
app.post('/api/transport/:id/take', (req, res) => {
  takeTransport(auth(req), num(req.params.id));
  res.json({ ok: true });
});
app.post('/api/transport/:id/rework', async (req, res) => {
  const notice = reworkTransport(auth(req), num(req.params.id), req.body?.comment);
  res.json({ ok: true, mailSent: await mail(notice) });
});
app.post('/api/transport/:id/car', async (req, res) => {
  const notice = setCar(auth(req), num(req.params.id), req.body);
  res.json({ ok: true, mailSent: await mail(notice) });
});
app.post('/api/transport/:id/loaded', (req, res) => {
  markLoaded(auth(req), num(req.params.id));
  res.json({ ok: true });
});
app.post('/api/transport/:id/complete', async (req, res) => {
  const notice = completeTransport(auth(req), num(req.params.id));
  res.json({ ok: true, mailSent: await mail(notice) });
});

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Не знайдено')));

// ---------- Фронтенд (зібраний Vite) ----------

const dist = path.join(ROOT, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Внутрішня помилка сервера' : err.message });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Портал закупівель:  ${APP_URL}`);
  console.log(`  Mailpit (листи):    ${MAILPIT_URL}\n`);
});
