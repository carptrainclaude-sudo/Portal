import nodemailer from 'nodemailer';
import { all, run, now } from './db.ts';

// Адреса порталу для посилань у листах: APP_URL → RENDER_EXTERNAL_URL (Render задає сам) → локальна.
export const APP_URL = (process.env.APP_URL ?? process.env.RENDER_EXTERNAL_URL ?? 'http://localhost:3000').replace(/\/$/, '');
// smtp — надсилати через SMTP (локально Mailpit); outbox — лише зберігати в БД і показувати на сторінці «Тестова пошта».
export const MAIL_MODE = (process.env.MAIL_MODE ?? (process.env.RENDER && !process.env.SMTP_HOST ? 'outbox' : 'smtp')) as 'smtp' | 'outbox';
const SMTP_HOST = process.env.SMTP_HOST ?? '127.0.0.1';
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 1025);

const transport = MAIL_MODE === 'smtp'
  ? nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT, secure: process.env.SMTP_SECURE === 'true',
    ignoreTLS: !process.env.SMTP_USER,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' } : undefined,
  })
  : null;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export type Notice = {
  to: string;
  subject: string;
  greeting: string;               // ім'я адресата
  lines: string[];                // абзаци тексту
  quoteLabel?: string;            // підпис над цитатою (коментар)
  quote?: string;                 // коментар
  details?: [string, string][];   // таблиця «поле — значення»
  linkPath: string;               // '/requests/12' або '/transport/5'
  linkLabel: string;
};

/** Список листів для сторінки «Тестова пошта» (нові зверху). */
export function listOutbox() {
  return all('SELECT id, to_email AS "to", subject, body, link_path AS linkPath, created_at AS at, delivered FROM mail_outbox ORDER BY id DESC LIMIT 300');
}

/** Зберігає лист у «Тестову пошту» та (у режимі smtp) надсилає через SMTP. Не кидає помилок: true — лист доставлено/збережено. */
export async function sendNotice(n: Notice): Promise<boolean> {
  const link = `${APP_URL}${n.linkPath}`;
  const text = [
    `Вітаємо, ${n.greeting}!`, '', ...n.lines,
    ...(n.quote ? ['', `${n.quoteLabel ?? 'Коментар'}:`, n.quote] : []),
    ...(n.details?.length ? ['', ...n.details.map(([k, v]) => `${k}: ${v}`)] : []),
    '', `${n.linkLabel}: ${link}`, '', '— Портал закупівель',
  ].join('\n');
  let delivered = true;
  if (transport) {
    const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#172b4d;max-width:560px">
    <div style="background:#0c66e4;color:#fff;padding:12px 16px;border-radius:6px 6px 0 0;font-weight:600">Портал закупівель</div>
    <div style="border:1px solid #dfe1e6;border-top:0;padding:16px;border-radius:0 0 6px 6px">
      <p>Вітаємо, ${esc(n.greeting)}!</p>
      ${n.lines.map((l) => `<p>${esc(l).replace(/№(\d+)/g, '<b>№$1</b>')}</p>`).join('')}
      ${n.quote ? `<p style="margin-bottom:4px;color:#626f86">${esc(n.quoteLabel ?? 'Коментар')}:</p>
      <blockquote style="margin:0 0 16px;padding:10px 12px;background:#fff7d6;border-left:3px solid #e2b203;white-space:pre-wrap">${esc(n.quote)}</blockquote>` : ''}
      ${n.details?.length ? `<table style="border-collapse:collapse;margin:0 0 16px">${n.details.map(([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#626f86">${esc(k)}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`).join('')}</table>` : ''}
      <p><a href="${link}" style="display:inline-block;background:#0c66e4;color:#fff;padding:8px 14px;border-radius:4px;text-decoration:none">${esc(n.linkLabel)}</a></p>
      <p style="color:#626f86;font-size:12px">${link}</p>
    </div>
  </div>`;
    try {
      await transport.sendMail({ from: process.env.MAIL_FROM ?? '"Портал закупівель" <noreply@portal.test>', to: n.to, subject: n.subject, text, html });
    } catch (e) {
      delivered = false;
      console.warn('[mail] Не вдалося надіслати лист (чи запущено Mailpit?):', (e as Error).message);
    }
  }
  try {
    run('INSERT INTO mail_outbox (to_email, subject, body, link_path, created_at, delivered) VALUES (?, ?, ?, ?, ?, ?)',
      n.to, n.subject, text, n.linkPath, now(), delivered ? 1 : 0);
  } catch (e) {
    console.warn('[mail] Не вдалося зберегти лист у «Тестову пошту»:', (e as Error).message);
  }
  return delivered;
}
