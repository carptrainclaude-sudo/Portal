import nodemailer from 'nodemailer';

export const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';
const SMTP_HOST = process.env.SMTP_HOST ?? '127.0.0.1';
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 1025);

const transport = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: false, ignoreTLS: true });

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

/** Надсилає лист через SMTP (у тесті — Mailpit). Не кидає помилок: повертає true/false. */
export async function sendNotice(n: Notice): Promise<boolean> {
  const link = `${APP_URL}${n.linkPath}`;
  const text = [
    `Вітаємо, ${n.greeting}!`, '', ...n.lines,
    ...(n.quote ? ['', `${n.quoteLabel ?? 'Коментар'}:`, n.quote] : []),
    ...(n.details?.length ? ['', ...n.details.map(([k, v]) => `${k}: ${v}`)] : []),
    '', `${n.linkLabel}: ${link}`, '', '— Портал закупівель',
  ].join('\n');
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
    await transport.sendMail({ from: '"Портал закупівель" <noreply@portal.test>', to: n.to, subject: n.subject, text, html });
    return true;
  } catch (e) {
    console.warn('[mail] Не вдалося надіслати лист (чи запущено Mailpit?):', (e as Error).message);
    return false;
  }
}
