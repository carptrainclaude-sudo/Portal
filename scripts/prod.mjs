// Запуск на хостингу (Render тощо): seed, якщо БД ще немає або схема застаріла, далі — сервер.
// Збірка фронтенду — окремим кроком (npm run build). Mailpit не запускається: листи — у «Тестовій пошті».
// Запуск: npm run start:prod   (= node --no-warnings scripts/prod.mjs)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_VERSION = 2;
const dbFile = process.env.DB_PATH ?? path.join(root, 'data', 'portal.db');

function dbVersion() {
  if (!fs.existsSync(dbFile)) return 0;
  const r = spawnSync(process.execPath, ['--no-warnings', '-e',
    "const {DatabaseSync}=require('node:sqlite');console.log(new DatabaseSync(process.argv[1]).prepare('PRAGMA user_version').get().user_version)", dbFile]);
  return Number(String(r.stdout).trim()) || 0;
}

if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
  console.error('✖ Немає збірки фронтенду (dist/). Спершу виконайте: npm run build');
  process.exit(1);
}

if (process.env.RESET_DB === 'true' || dbVersion() < SCHEMA_VERSION) {
  console.log('▶ Seed тестових даних…');
  const r = spawnSync(process.execPath, ['--no-warnings', path.join(root, 'server', 'seed.ts')], { cwd: root, stdio: 'inherit', env: process.env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

await import('../server/index.ts');
