import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DB_PATH = process.env.DB_PATH ?? path.join(ROOT, 'data', 'portal.db');

export const SCHEMA_VERSION = 2;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'buyer'          -- buyer | dispatcher
);
CREATE TABLE IF NOT EXISTS customer_profiles (
  email TEXT PRIMARY KEY,
  last_name TEXT NOT NULL DEFAULT '',
  first_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  transport_name TEXT,
  position TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  norm TEXT NOT NULL,
  unit TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  user_added INTEGER NOT NULL DEFAULT 0,
  source_request_id INTEGER,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_products_norm ON products(category_id, norm);
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'PLANNED',
  category_id INTEGER NOT NULL REFERENCES categories(id),
  status TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  last_name TEXT NOT NULL,
  first_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  delivery_month TEXT NOT NULL,
  assignee_email TEXT,
  taken_at TEXT,
  rework_comment TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  submitted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS ix_requests_customer ON requests(customer_email);
-- Рядок заявки = товар. Нова позиція (немає в довіднику): product_id NULL, назва/од. у new_name/new_unit.
CREATE TABLE IF NOT EXISTS request_lines (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  line_order INTEGER NOT NULL DEFAULT 0,
  product_id INTEGER REFERENCES products(id),
  new_name TEXT,
  new_unit TEXT,
  was_new INTEGER NOT NULL DEFAULT 0,
  removed INTEGER NOT NULL DEFAULT 0,
  removed_comment TEXT,
  removed_by TEXT,
  removed_at TEXT,
  removed_qty INTEGER
);
CREATE INDEX IF NOT EXISTS ix_lines_request ON request_lines(request_id);
-- Позиція = рядок заявки + локація.
CREATE TABLE IF NOT EXISTS request_items (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  line_id INTEGER NOT NULL REFERENCES request_lines(id) ON DELETE CASCADE,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  executor_email TEXT,
  planned_date TEXT,
  UNIQUE (line_id, location_id)
);
CREATE INDEX IF NOT EXISTS ix_items_request ON request_items(request_id);
CREATE TABLE IF NOT EXISTS request_events (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  text TEXT NOT NULL
);
-- Сповіщення замовнику (лічильник непрочитаних у «Мої заявки»).
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_email TEXT NOT NULL,
  kind TEXT NOT NULL,                          -- purchase | transport
  request_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_notif_user ON notifications(user_email, read_at);
-- Заявки на перевезення.
CREATE TABLE IF NOT EXISTS transport_requests (
  id INTEGER PRIMARY KEY,
  status TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  position TEXT NOT NULL,
  load_address TEXT NOT NULL,
  load_contact_name TEXT NOT NULL,
  load_contact_phone TEXT NOT NULL,
  load_at TEXT NOT NULL,
  cargo_details TEXT NOT NULL,
  seal_required INTEGER NOT NULL,
  unload_address TEXT NOT NULL,
  unload_contact_name TEXT,
  unload_contact_phone TEXT,
  unload_company TEXT,
  unload_at TEXT NOT NULL,
  dispatcher_email TEXT,
  taken_at TEXT,
  rework_comment TEXT,
  cancel_comment TEXT,
  driver_name TEXT,
  driver_phone TEXT,
  car_model TEXT,
  car_number TEXT,
  driver_license TEXT,
  car_load_at TEXT,
  car_delivery_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  submitted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_transport_customer ON transport_requests(customer_email);
CREATE TABLE IF NOT EXISTS transport_events (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES transport_requests(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  status_from TEXT,
  status_to TEXT,
  comment TEXT,
  text TEXT NOT NULL
);
`;

export function openDb(): DatabaseSync {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const version = Number((db.prepare('PRAGMA user_version').get() as any).user_version);
  const hasTables = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'requests'").get();
  if (hasTables && version < SCHEMA_VERSION) {
    throw new Error(`Схема БД застаріла (версія ${version}, потрібна ${SCHEMA_VERSION}). Запустіть: start.cmd --reset`);
  }
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return db;
}

export const db = openDb();

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const now = () => new Date().toISOString();

export type Row = Record<string, any>;
export const all = (sql: string, ...params: any[]): Row[] => db.prepare(sql).all(...params) as Row[];
export const get = (sql: string, ...params: any[]): Row | undefined => db.prepare(sql).get(...params) as Row | undefined;
export const run = (sql: string, ...params: any[]) => db.prepare(sql).run(...params);

export function addEvent(requestId: number, actor: string, text: string, at = now()) {
  run('INSERT INTO request_events (request_id, at, actor_email, text) VALUES (?, ?, ?, ?)', requestId, at, actor, text);
}
