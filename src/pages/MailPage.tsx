import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useApp, usePersisted } from '../context';
import { PageHeader, fmtDateTime } from '../components/ui';

type Mail = { id: number; to: string; subject: string; body: string; linkPath: string | null; at: string; delivered: number };

/** Тестова пошта: листи, які надіслав портал (на хостингу без SMTP замінює Mailpit). */
export default function MailPage() {
  const { user } = useApp();
  const [mails, setMails] = useState<Mail[] | null>(null);
  const [f, setF] = usePersisted<{ mine: boolean }>('mail-filter', { mine: true });
  const [open, setOpen] = useState<number | null>(null);
  const load = useCallback(() => { api.get<Mail[]>('/api/mail').then(setMails); }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const shown = (mails ?? []).filter((m) => !f.mine || m.to === user?.email);
  return (
    <>
      <PageHeader title="Тестова пошта">
        <p className="muted">Листи, які портал надсилає замовникам: повернення на доопрацювання, видалення позиції, призначення/зміна авто, виконання. У тестовому середовищі вони не йдуть на реальні адреси.</p>
      </PageHeader>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={f.mine} className={`tab ${f.mine ? 'is-active' : ''}`} onClick={() => setF({ mine: true })}>Для {user?.email}</button>
        <button role="tab" aria-selected={!f.mine} className={`tab ${!f.mine ? 'is-active' : ''}`} onClick={() => setF({ mine: false })}>Усі листи <span className="tab-count">{mails?.length ?? 0}</span></button>
      </div>
      {!mails ? <div className="page-loading">Завантаження…</div> : !shown.length ? (
        <div className="empty">Листів поки немає.{f.mine ? ' Перегляньте вкладку «Усі листи» або увійдіть як замовник.' : ''}</div>
      ) : (
        <div className="mail-list">
          {shown.map((m) => {
            const isOpen = open === m.id;
            const body = m.body.replace(/\n[^\n]*: https?:\/\/\S+\n\n— Портал закупівель$/, '\n\n— Портал закупівель');
            return (
              <article key={m.id} className={`mail-item ${isOpen ? 'is-open' : ''}`}>
                <button className="mail-head" onClick={() => setOpen(isOpen ? null : m.id)} aria-expanded={isOpen}>
                  <span className="mail-subject">{m.subject}</span>
                  <span className="muted small">Кому: {m.to} · {fmtDateTime(m.at)}{m.delivered ? '' : ' · SMTP недоступний'}</span>
                </button>
                {isOpen && (
                  <div className="mail-body">
                    <div className="mail-text">{body}</div>
                    {m.linkPath && <Link className="btn btn-primary btn-sm" to={m.linkPath}>Відкрити заявку</Link>}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
