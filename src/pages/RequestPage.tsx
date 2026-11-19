import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Product, type RequestDetail, type RequestLine } from '../api';
import { useApp } from '../context';
import { Icon, ItemStatus, Modal, PageHeader, RequestStatus, fmtDateTime, fmtYmd } from '../components/ui';
import Matrix, { type MatrixRow } from '../components/Matrix';
import { REQUEST_TYPE, formatPhone, monthLabel } from '../../shared/constants';
import { useCancel } from './MyRequestsPage';

type CheckResult = { exact: Product | null; similar: (Product & { score: number })[] };
type Dialog =
  | { kind: 'return' }
  | { kind: 'fix'; line: RequestLine }
  | { kind: 'remove'; line: RequestLine }
  | null;

export default function RequestPage() {
  const { id } = useParams();
  const { user, meta, toast, refreshCounters } = useApp();
  const nav = useNavigate();
  const [r, setR] = useState<RequestDetail | null>(null);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<RequestDetail>(`/api/requests/${id}`).then((d) => { setR(d); refreshCounters(); }).catch((e) => setError(e.message));
  }, [id, refreshCounters]);
  const cancel = useCancel(load);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  if (error) return <div className="banner banner-error">{error}</div>;
  if (!r || !meta) return <div className="page-loading">Завантаження…</div>;

  const isBuyer = user?.role === 'buyer';
  const taken = r.status === 'IN_PROGRESS' || r.status === 'DONE';
  const canAct = isBuyer && r.status === 'NEW';
  const editable = !isBuyer && (r.status === 'NEW' || r.status === 'REWORK');
  const active = r.lines.filter((l) => !l.removed);
  const removed = r.lines.filter((l) => l.removed);
  const newLines = active.filter((l) => l.isNew);
  const lineQty = (lineId: number) => r.items.filter((i) => i.lineId === lineId).reduce((s, i) => s + i.qty, 0);
  const lineLocs = (lineId: number) => r.items.filter((i) => i.lineId === lineId).length;

  const rows: MatrixRow[] = active.map((l) => ({
    key: l.id, name: l.name, unit: l.unit, isNew: !!l.isNew, userAdded: !!l.userAdded,
    newLabel: isBuyer ? 'Немає в довіднику' : 'нова позиція — на перевірці',
    cells: Object.fromEntries(r.items.filter((i) => i.lineId === l.id).map((i) => [i.locationId, { qty: i.qty, status: i.status }])),
  }));
  const lineName = (lineId: number) => r.lines.find((l) => l.id === lineId);
  const done = r.items.filter((i) => i.status === 'DONE').length;

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); load(); refreshCounters(); }
  };
  const take = () => act(async () => {
    const res = await api.post<{ added: string[]; linked: string[] }>(`/api/requests/${r.id}/take`);
    const extra = res.added.length ? ` До довідника додано: ${res.added.length}.` : '';
    toast(`Заявку №${r.id} взято в роботу. Позиції — у «Зведеній потребі».${extra}`);
  });

  const crumbs = isBuyer ? <><Link to="/inbox">Вхідні заявки</Link> / №{r.id}</> : <><Link to="/my-requests">Мої заявки</Link> / №{r.id}</>;
  const noActive = active.length === 0;

  return (
    <>
      <PageHeader
        crumbs={crumbs}
        title={<>Заявка №{r.id} <RequestStatus status={r.status} /></>}
        actions={<>
          {isBuyer && r.status !== 'CANCELLED' && (<>
            <button className="btn btn-default" disabled={!canAct || busy} onClick={() => setDialog({ kind: 'return' })}>Повернути на доопрацювання</button>
            <button className="btn btn-primary" disabled={!canAct || busy || noActive} title={noActive ? 'З заявки видалено всі позиції' : undefined} onClick={take}>Взяти в роботу</button>
          </>)}
          {editable && (<>
            <button className="btn btn-subtle btn-danger-text" onClick={() => cancel(r.id)}>Скасувати заявку</button>
            <button className="btn btn-primary" onClick={() => nav(`/requests/${r.id}/edit`)}><Icon name="edit" size={16} /> Редагувати</button>
          </>)}
        </>}
      />

      {r.status === 'REWORK' && r.reworkComment && (
        <div className="banner banner-warning"><b>Заявку повернуто на доопрацювання.</b> Коментар закупівельника:
          <div className="rework-comment">{r.reworkComment}</div>
          {!isBuyer && <>Виправте заявку та відправте її повторно — кнопка «Редагувати».</>}</div>
      )}
      {isBuyer && canAct && noActive && (
        <div className="banner banner-error">З заявки видалено всі позиції — взяти її в роботу неможливо. Поверніть заявку на доопрацювання.</div>
      )}
      {isBuyer && taken && (
        <div className="banner banner-info">Заявку взяв у роботу <b>{r.assigneeName}</b>{r.takenAt ? ` ${fmtDateTime(r.takenAt)}` : ''}. Керування позиціями — у розділі <Link to="/summary">«Зведена потреба»</Link>.</div>
      )}

      <div className="detail-layout">
        <div className="detail-main">
          {newLines.length > 0 && (
            <section className="card card-new">
              <div className="card-title-row">
                <h3 className="card-title">Нові позиції — немає в довіднику <span className="muted">({newLines.length})</span></h3>
              </div>
              <p className="muted small">
                {isBuyer
                  ? 'Перевірте назву та одиницю виміру. Після «Взяти в роботу» позиції, що залишились, буде додано до довідника (з позначкою «додано з заявки №' + r.id + '»).'
                  : 'Цих товарів немає в довіднику — закупівельник перевірить їх. Після прийняття заявки вони з’являться в довіднику.'}
              </p>
              <div className="table-wrap">
                <table className="table table-compact">
                  <thead><tr><th>Назва</th><th>Од.</th><th className="num">Разом</th><th>Локацій</th>{isBuyer && canAct && <th />}</tr></thead>
                  <tbody>
                    {newLines.map((l) => (
                      <tr key={l.id} className="row-new">
                        <td><b>{l.name}</b> <span className="lozenge lozenge-red lozenge-xs">Немає в довіднику</span></td>
                        <td>{l.unit}</td><td className="num">{lineQty(l.id)}</td><td>{lineLocs(l.id)}</td>
                        {isBuyer && canAct && (
                          <td className="row-actions">
                            <button className="btn btn-default btn-sm" disabled={busy} onClick={() => setDialog({ kind: 'fix', line: l })}><Icon name="edit" size={14} /> Виправити</button>
                            <button className="btn btn-subtle btn-sm btn-danger-text" disabled={busy} onClick={() => setDialog({ kind: 'remove', line: l })}><Icon name="trash" size={14} /> Видалити з заявки</button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="card">
            <h3 className="card-title">Товари × локації</h3>
            {rows.length ? <Matrix rows={rows} locations={meta.locations} showStatus={taken} /> : <div className="empty">У заявці не залишилось позицій</div>}
          </section>

          {removed.length > 0 && (
            <section className="card">
              <h3 className="card-title">Видалені із заявки <span className="muted">({removed.length})</span></h3>
              <ul className="removed-list">
                {removed.map((l) => (
                  <li key={l.id}>
                    <div><s>{l.name}</s> <span className="muted small">· {l.removedQty ?? '—'} {l.unit}</span></div>
                    <div className="small">Коментар{l.removedByName ? ` (${l.removedByName})` : ''}: {l.removedComment}</div>
                    {l.removedAt && <div className="muted small">{fmtDateTime(l.removedAt)}</div>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {taken && (
            <section className="card">
              <div className="card-title-row"><h3 className="card-title">Позиції</h3><span className="muted">Виконано {done} з {r.items.length}</span></div>
              <div className="table-wrap">
                <table className="table table-compact">
                  <thead><tr><th>Товар</th><th>Од.</th><th>Локація</th><th className="num">К-сть</th><th>Статус</th><th>Планова дата</th><th>Виконавець</th></tr></thead>
                  <tbody>
                    {r.items.map((it) => {
                      const l = lineName(it.lineId);
                      return (
                        <tr key={it.id}>
                          <td>{l?.name}</td><td>{l?.unit}</td><td>{it.locationName}</td><td className="num">{it.qty}</td>
                          <td><ItemStatus status={it.status} /></td><td>{fmtYmd(it.plannedDate)}</td><td>{it.executorName ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="card">
            <h3 className="card-title">Історія</h3>
            <ul className="timeline">
              {r.events.map((e, i) => (
                <li key={i}><span className="tl-dot" />
                  <div><b>{e.actorEmail === 'system' ? 'Система' : e.actorName}</b> <span className="muted small">{fmtDateTime(e.at)}</span></div>
                  <div>{e.text}</div>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="detail-side card">
          <h3 className="card-title">Деталі</h3>
          <dl className="details">
            <dt>Статус</dt><dd><RequestStatus status={r.status} /></dd>
            <dt>Тип</dt><dd>{REQUEST_TYPE[r.type as keyof typeof REQUEST_TYPE]}</dd>
            <dt>Категорія</dt><dd>{r.category}</dd>
            <dt>Місяць поставки</dt><dd><b>{monthLabel(r.deliveryMonth)}</b></dd>
            <dt>Виконавець</dt><dd>{r.assigneeName ?? <span className="muted">не призначено</span>}</dd>
            <dt>Нові позиції</dt><dd>{newLines.length || '—'}</dd>
          </dl>
          <h3 className="card-title">Замовник</h3>
          <dl className="details">
            <dt>ПІБ</dt><dd>{r.lastName} {r.firstName}</dd>
            <dt>Телефон</dt><dd>{formatPhone(r.phone)}</dd>
            <dt>Email</dt><dd>{r.customerEmail}</dd>
          </dl>
          <dl className="details">
            <dt>Створено</dt><dd>{fmtDateTime(r.createdAt)}</dd>
            <dt>Відправлено</dt><dd>{fmtDateTime(r.submittedAt)}</dd>
            <dt>Оновлено</dt><dd>{fmtDateTime(r.updatedAt)}</dd>
          </dl>
        </aside>
      </div>

      {dialog?.kind === 'return' && (
        <CommentDialog
          title={`Повернути заявку №${r.id} на доопрацювання`}
          hint="Замовник отримає email і сповіщення в кабінеті з номером заявки, вашим коментарем і посиланням."
          action="Повернути" busy={busy} onClose={() => setDialog(null)}
          onSubmit={(comment) => act(async () => {
            const res = await api.post<{ mailSent: boolean }>(`/api/requests/${r.id}/return`, { comment });
            setDialog(null);
            toast(res.mailSent ? `Заявку №${r.id} повернуто на доопрацювання. Замовнику надіслано лист.` : `Заявку №${r.id} повернуто, але лист не надіслано (Mailpit не запущено?)`, res.mailSent ? 'success' : 'error');
          })}
        />
      )}
      {dialog?.kind === 'remove' && (
        <CommentDialog
          title="Видалити позицію з заявки"
          hint={`«${dialog.line.name}» (${lineQty(dialog.line.id)} ${dialog.line.unit}) буде видалено із заявки №${r.id}. Замовник отримає email і сповіщення з назвою товару та вашим коментарем.`}
          action="Видалити з заявки" danger busy={busy} onClose={() => setDialog(null)}
          onSubmit={(comment) => act(async () => {
            const res = await api.post<{ mailSent: boolean }>(`/api/requests/${r.id}/lines/${dialog.line.id}/remove`, { comment });
            setDialog(null);
            toast(`Позицію «${dialog.line.name}» видалено.${res.mailSent ? ' Замовнику надіслано лист.' : ' Лист не надіслано (Mailpit не запущено?)'}`, res.mailSent ? 'success' : 'error');
          })}
        />
      )}
      {dialog?.kind === 'fix' && (
        <FixDialog line={dialog.line} categoryId={r.categoryId} busy={busy} onClose={() => setDialog(null)}
          onSubmit={(name, unit) => act(async () => {
            const res = await api.post<{ linked: boolean; product?: Product }>(`/api/requests/${r.id}/lines/${dialog.line.id}/fix`, { name, unit });
            setDialog(null);
            toast(res.linked ? `Позицію прив'язано до наявного товару «${res.product?.name}»` : 'Позицію виправлено');
          })}
        />
      )}
    </>
  );
}

export function CommentDialog({ title, hint, action, danger, busy, onClose, onSubmit, label = 'Коментар для замовника' }: {
  title: string; hint: string; action: string; danger?: boolean; busy: boolean; label?: string;
  onClose: () => void; onSubmit: (comment: string) => void;
}) {
  const [comment, setComment] = useState('');
  const [err, setErr] = useState('');
  const submit = () => {
    if (comment.trim().length < 3) { setErr("Коментар обов'язковий (щонайменше 3 символи)"); return; }
    onSubmit(comment.trim());
  };
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn btn-subtle" onClick={onClose}>Скасувати</button>
      <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy} onClick={submit}>{action}</button>
    </>}>
      <p className="muted">{hint}</p>
      <label className="field">
        <span className="label">{label} <span className="req">*</span></span>
        <textarea className={`input ${err ? 'is-invalid' : ''}`} rows={4} value={comment} autoFocus placeholder="Опишіть причину"
          onChange={(e) => { setComment(e.target.value); setErr(''); }} />
        {err && <span className="field-error">{err}</span>}
      </label>
    </Modal>
  );
}

function FixDialog({ line, categoryId, busy, onClose, onSubmit }: {
  line: RequestLine; categoryId: number; busy: boolean; onClose: () => void; onSubmit: (name: string, unit: string) => void;
}) {
  const { meta } = useApp();
  const [name, setName] = useState(line.name);
  const [unit, setUnit] = useState(line.unit);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (name.trim().length < 3) { setCheck(null); return; }
    const t = setTimeout(() => api.post<CheckResult>('/api/products/check', { name, categoryId }).then(setCheck), 250);
    return () => clearTimeout(t);
  }, [name, categoryId]);
  const submit = () => {
    if (name.trim().length < 3) { setErr('Назва має містити щонайменше 3 символи'); return; }
    onSubmit(name.trim(), unit);
  };
  return (
    <Modal title="Виправити нову позицію" onClose={onClose} footer={<>
      <button className="btn btn-subtle" onClick={onClose}>Скасувати</button>
      <button className="btn btn-primary" disabled={busy} onClick={submit}>{check?.exact ? "Прив'язати до наявного" : 'Зберегти'}</button>
    </>}>
      <p className="muted">Замовник ввів: «{line.newName ?? line.name}» ({line.newUnit ?? line.unit}).</p>
      <label className="field"><span className="label">Назва <span className="req">*</span></span>
        <input className="input" value={name} onChange={(e) => { setName(e.target.value); setErr(''); }} autoFocus /></label>
      <label className="field"><span className="label">Одиниця виміру <span className="req">*</span></span>
        <select className="input" value={unit} onChange={(e) => setUnit(e.target.value)} disabled={!!check?.exact}>
          {meta?.units.map((u) => <option key={u} value={u}>{u}</option>)}
        </select></label>
      {check?.exact && (
        <div className="banner banner-info">Такий товар уже є в довіднику: <b>{check.exact.name}</b> ({check.exact.unit}). Позицію буде прив'язано до нього — дубль не створюється.</div>
      )}
      {!check?.exact && !!check?.similar.length && (
        <div className="banner banner-warning"><b>Схожі товари в довіднику</b> — оберіть, щоб прив'язати позицію:
          {check.similar.map((s) => (
            <button key={s.id} className="suggestion" onClick={() => { setName(s.name); setUnit(s.unit); }}><span>{s.name}</span><span className="muted small">{s.unit} · Обрати</span></button>
          ))}
        </div>
      )}
      {err && <div className="field-error">{err}</div>}
    </Modal>
  );
}
