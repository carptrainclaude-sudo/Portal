// Запуск однією командою: довідники → seed (якщо БД ще немає) → збірка фронтенду → Mailpit → сервер.
// Параметри: --reset  перестворити БД із seed-даними
//            --build  примусово перезібрати фронтенд
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const node = process.execPath;
const p = (...x) => path.join(root, ...x);

function step(title, cmd, cmdArgs) {
  console.log(`\n▶ ${title}`);
  const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`✖ Помилка на кроці: ${title}`);
    process.exit(r.status ?? 1);
  }
}

function newestMtime(dir) {
  let max = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    max = Math.max(max, e.isDirectory() ? newestMtime(f) : fs.statSync(f).mtimeMs);
  }
  return max;
}

const portBusy = (port) =>
  new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });

// 1. Довідники
const hasLocations = fs.existsSync(p('data', 'locations.xlsx')) || fs.existsSync(p('data', 'locations.sample.xlsx'));
if (!fs.existsSync(p('data', 'products.xlsx')) || !hasLocations) {
  if (fs.existsSync(p('data', 'source', 'Довідники.xlsx'))) {
    step('Формування довідників data/products.xlsx, data/locations.xlsx', node, [p('scripts', 'build-dictionaries.mjs')]);
  } else {
    console.error('✖ Немає довідників data/products.xlsx і data/locations(.sample).xlsx. Див. README, розділ «Довідники».');
    process.exit(1);
  }
}

// 2. БД (перестворюється, якщо її немає, якщо задано --reset або якщо схема застаріла після оновлення порталу)
const SCHEMA_VERSION = 2;
function dbVersion(file) {
  const r = spawnSync(node, ['--no-warnings', '-e',
    `const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);console.log(d.prepare('PRAGMA user_version').get().user_version)`, file]);
  return Number(String(r.stdout).trim()) || 0;
}
const dbFile = p('data', 'portal.db');
if (args.has('--reset') || !fs.existsSync(dbFile)) {
  step('Seed тестових даних', node, ['--no-warnings', p('server', 'seed.ts')]);
} else if (dbVersion(dbFile) < SCHEMA_VERSION) {
  console.log('\n• Портал оновлено — структура БД змінилась, тестові дані буде перестворено.');
  step('Seed тестових даних', node, ['--no-warnings', p('server', 'seed.ts')]);
}

// 3. Фронтенд
const distIndex = p('dist', 'index.html');
const srcTime = Math.max(newestMtime(p('src')), newestMtime(p('shared')), fs.statSync(p('index.html')).mtimeMs);
if (args.has('--build') || !fs.existsSync(distIndex) || fs.statSync(distIndex).mtimeMs < srcTime) {
  step('Збірка фронтенду (vite build)', node, [p('node_modules', 'vite', 'bin', 'vite.js'), 'build', '--logLevel', 'warn']);
}

const children = [];

// 4. Mailpit
const mailpitExe = p('tools', 'mailpit', process.platform === 'win32' ? 'mailpit.exe' : 'mailpit');
if (await portBusy(8025)) {
  console.log('\n• Mailpit уже запущено на порту 8025');
} else if (fs.existsSync(mailpitExe)) {
  console.log('\n▶ Запуск Mailpit (SMTP :1025, веб :8025)');
  const mp = spawn(mailpitExe, ['--listen', '127.0.0.1:8025', '--smtp', '127.0.0.1:1025', '--quiet'], { cwd: root, stdio: 'inherit' });
  mp.on('error', (e) => console.warn('Mailpit не запустився:', e.message));
  children.push(mp);
} else {
  console.warn('\n⚠ Mailpit не знайдено в tools/mailpit — листи не надсилатимуться. Див. README.');
}

// 5. Сервер
if (await portBusy(3000)) {
  console.error('\n✖ Порт 3000 зайнятий. Зупиніть інший процес або задайте PORT.');
  children.forEach((c) => c.kill());
  process.exit(1);
}
const server = spawn(node, ['--no-warnings', p('server', 'index.ts')], { cwd: root, stdio: 'inherit', env: process.env });
children.push(server);

const shutdown = () => {
  children.forEach((c) => { try { c.kill(); } catch {} });
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
server.on('exit', (code) => {
  children.forEach((c) => { try { c.kill(); } catch {} });
  process.exit(code ?? 0);
});
