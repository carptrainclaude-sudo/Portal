import { useCallback, useEffect, useState, type InputHTMLAttributes } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type TransportDetail } from '../api';
import { useApp } from '../context';
import { Icon, Modal, PageHeader, TransportStatusBadge, fmtDateTime } from '../components/ui';
import { CommentDialog } from './RequestPage';
import { PhoneInput, phone9Of } from './RequestFormPage';
import { formatLocalDateTime, formatPhone } from '../../shared/constants';

type Dialog = 'rework' | 'cancel' | 'car' | null;

export default function TransportPage() {
  const { id } = useParams();
  const { user, toast, refreshCounters } = useApp();
  const nav = useNavigate();
  const [t, setT] = useState<TransportDetail | null>(null);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<TransportDetail>(`/api/transport/${id}`).then((d) => { setT(d); refreshCounters(); }).catch((e) => setError(e.message));
  }, [id, refreshCounters]);
  useEffect(() => {
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, [load]);

  if (error) return <div className="banner banner-error">{error}</div>;
  if (!t) return <div className="page-loading">Завантаження…</div>;

  const isDispatcher = user?.role === 'dispatcher';
  const isOwner = user?.role === 'customer' && user.email === t.customerEmail;
  const s = t.status;

  const act = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    try { const msg = await fn(); if (msg) toast(msg); setDialog(null); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); load(); }
  };
  const post = (path: string, body?: unknown) => api.post<{ mailSent?: boolean }>(`/api/transport/${t.id}/${path}`, body);
  const mailNote = (r: { mailSent?: boolean }) => (r.mailSent === false ? ' Лист не надіслано (Mailpit не запущено?)' : ' Замовнику надіслано лист.');

  const actions = isDispatcher ? (<>
    {s === 'NEW' && <>
      <button className="btn btn-default" disabled={busy} onClick={() => setDialog('rework')}>Відправити на доопрацювання</button>
      <button className="btn btn-primary" disabled={busy} onClick={() => act(async () => { await post('take'); return `Заявку №${t.id} взято в роботу`; })}>Взяти в роботу</button>
    </>}
    {s === 'IN_PROGRESS' && <button className="btn btn-primary" disabled={busy} onClick={() => setDialog('car')}><Icon name="truck" /> Внести дані по авто</button>}
    {(s === 'CAR_ASSIGNED' || s === 'LOADED') && <button className="btn btn-default" disabled={busy} onClick={() => setDialog('car')}><Icon name="edit" size={16} /> Змінити дані авто</button>}
    {s === 'CAR_ASSIGNED' && <button className="btn btn-primary" disabled={busy} onClick={() => act(async () => { await post('loaded'); return 'Статус «Завантажено»'; })}>Авто завантажено</button>}
    {s === 'LOADED' && <button className="btn btn-primary" disabled={busy} onClick={() => act(async () => { const r = await post('complete'); return `Заявку №${t.id} виконано.${mailNote(r)}`; })}><Icon name="check" /> Заявку виконано</button>}
  </>) : isOwner ? (<>
    {(s === 'NEW' || s === 'REWORK') && <>
      <button className="btn btn-subtle btn-danger-text" disabled={busy} onClick={() => setDialog('cancel')}>Скасувати</button>
      <button className="btn btn-primary" onClick={() => nav(`/transport/${t.id}/edit`)}><Icon name="edit" size={16} /> Редагувати</button>
    </>}
    {s === 'CAR_ASSIGNED' && <button className="btn btn-primary" disabled={busy} onClick={() => act(async () => { await post('loaded'); return 'Дякуємо! Статус «Завантажено»'; })}><Icon name="check" /> Авто завантажено</button>}
  </>) : null;

  const steps = ['NEW', 'IN_PROGRESS', 'CAR_ASSIGNED', 'LOADED', 'DONE'];
  const stepIdx = steps.indexOf(s);

  return (
    <>
      <PageHeader
        crumbs={isDispatcher ? <><Link to="/dispatch">Вхідні перевезення</Link> / №{t.id}</> : <><Link to="/catalog/transport">Замовлення транспорту</Link> / №{t.id}</>}
        title={<>Перевезення №{t.id} <TransportStatusBadge status={s} /></>}
        actions={actions}
      />

      {stepIdx >= 0 && (
        <ol className="stepper" aria-label="Етапи заявки">
          {['Нова', 'В роботі', 'Авто призначено', 'Завантажено', 'Виконано'].map((l, i) => (
            <li key={l} className={i < stepIdx ? 'is-done' : i === stepIdx ? 'is-current' : ''}>{l}</li>
          ))}
        </ol>
      )}
      {s === 'REWORK' && t.reworkComment && (
        <div className="banner banner-warning"><b>Заявку повернуто на доопрацювання.</b> Коментар диспетчера:
          <div className="rework-comment">{t.reworkComment}</div>{isOwner && 'Виправте заявку — кнопка «Редагувати».'}</div>
      )}
      {s === 'CANCELLED' && t.cancelComment && <div className="banner banner-info"><b>Заявку скасовано замовником.</b> Причина: {t.cancelComment}</div>}
      {isOwner && s === 'CAR_ASSIGNED' && <div className="banner banner-info">Авто призначено. Коли авто завантажать, натисніть «Авто завантажено».</div>}

      <div className="detail-layout">
        <div className="detail-main">
          {t.car && (
            <section className="card card-car">
              <h3 className="card-title"><Icon name="truck" /> Дані авто</h3>
              <dl className="details details-wide">
                <dt>Номер авто</dt><dd><b className="car-plate">{t.car.carNumber}</b></dd>
                <dt>Марка та модель</dt><dd>{t.car.carModel || '—'}</dd>
                <dt>Водій</dt><dd>{t.car.driverName}</dd>
                <dt>Телефон водія</dt><dd>{formatPhone(t.car.driverPhone)}</dd>
                <dt>Посвідчення водія</dt><dd>{t.car.driverLicense || '—'}</dd>
                <dt>Дата завантаження</dt><dd>{formatLocalDateTime(t.car.loadAt)}</dd>
                <dt>Дата доставки</dt><dd>{formatLocalDateTime(t.car.deliveryAt)}</dd>
              </dl>
            </section>
          )}
          <section className="card">
            <h3 className="card-title">Маршрут і вантаж</h3>
            <div className="route-grid">
              <div>
                <div className="kv-k">Завантаження</div>
                <div className="route-addr">{t.loadAddress}</div>
                <div className="small">Бажано: <b>{formatLocalDateTime(t.loadAt)}</b></div>
                <div className="small muted">Контакт: {t.loadContactName}, {formatPhone(t.loadContactPhone)}</div>
              </div>
              <div className="route-arrow-big" aria-hidden="true">→</div>
              <div>
                <div className="kv-k">Вивантаження</div>
                <div className="route-addr">{t.unloadAddress}</div>
                <div className="small">Бажано: <b>{formatLocalDateTime(t.unloadAt)}</b></div>
                {(t.unloadContactName || t.unloadContactPhone || t.unloadCompany) && (
                  <div className="small muted">Контакт: {[t.unloadCompany, t.unloadContactName, t.unloadContactPhone && formatPhone(t.unloadContactPhone)].filter(Boolean).join(', ')}</div>
                )}
              </div>
            </div>
            <div>
              <div className="kv-k">Деталі вантажу</div>
              <div className="cargo">{t.cargoDetails}</div>
            </div>
            <div><span className="kv-k">Потреба в печатці: </span><b>{t.sealRequired ? 'Так' : 'Ні'}</b></div>
          </section>

          <section className="card">
            <h3 className="card-title">Історія</h3>
            <ul className="timeline">
              {t.events.map((e, i) => (
                <li key={i}><span className="tl-dot" />
                  <div><b>{e.actorName}</b> <span className="muted small">{fmtDateTime(e.at)}</span></div>
                  <div>
                    {e.statusTo && e.statusFrom !== e.statusTo && <>{e.statusFrom && <><TransportStatusBadge status={e.statusFrom} /> → </>}<TransportStatusBadge status={e.statusTo} /> </>}
                    {e.text}
                  </div>
                  {e.comment && <div className="rework-comment small">{e.comment}</div>}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="detail-side card">
          <h3 className="card-title">Деталі</h3>
          <dl className="details">
            <dt>Статус</dt><dd><TransportStatusBadge status={s} /></dd>
            <dt>Диспетчер</dt><dd>{t.dispatcherName ?? <span className="muted">не призначено</span>}</dd>
            <dt>Створено</dt><dd>{fmtDateTime(t.createdAt)}</dd>
            <dt>Оновлено</dt><dd>{fmtDateTime(t.updatedAt)}</dd>
            <dt>Виконано</dt><dd>{t.completedAt ? fmtDateTime(t.completedAt) : '—'}</dd>
          </dl>
          <h3 className="card-title">Замовник</h3>
          <dl className="details">
            <dt>ПІБ</dt><dd>{t.fullName}</dd>
            <dt>Посада</dt><dd>{t.position}</dd>
            <dt>Телефон</dt><dd>{formatPhone(t.phone)}</dd>
            <dt>Email</dt><dd>{t.customerEmail}</dd>
          </dl>
        </aside>
      </div>

      {dialog === 'rework' && (
        <CommentDialog title={`Відправити заявку №${t.id} на доопрацювання`} busy={busy} action="Відправити на доопрацювання"
          hint="Замовник отримає email і сповіщення в кабінеті з вашим коментарем." onClose={() => setDialog(null)}
          onSubmit={(comment) => act(async () => { const r = await post('rework', { comment }); return `Заявку №${t.id} повернуто на доопрацювання.${mailNote(r)}`; })} />
      )}
      {dialog === 'cancel' && (
        <CommentDialog title={`Скасувати заявку №${t.id}?`} busy={busy} action="Скасувати заявку" danger label="Причина скасування"
          hint="Скасовану заявку не можна відновити." onClose={() => setDialog(null)}
          onSubmit={(comment) => act(async () => { await post('cancel', { comment }); return `Заявку №${t.id} скасовано`; })} />
      )}
      {dialog === 'car' && (
        <CarDialog t={t} busy={busy} onClose={() => setDialog(null)}
          onSubmit={(body) => act(async () => {
            const r = await post('car', body);
            return `${t.car ? 'Дані авто змінено' : 'Авто призначено'}.${mailNote(r)}`;
          })} />
      )}
    </>
  );
}

function CarDialog({ t, busy, onClose, onSubmit }: { t: TransportDetail; busy: boolean; onClose: () => void; onSubmit: (body: object) => void }) {
  const c = t.car;
  const [v, setV] = useState({
    driverName: c?.driverName ?? '', driverPhone9: phone9Of(c?.driverPhone), carModel: c?.carModel ?? '', carNumber: c?.carNumber ?? '',
    driverLicense: c?.driverLicense ?? '', loadAt: c?.loadAt ?? t.loadAt, deliveryAt: c?.deliveryAt ?? t.unloadAt,
  });
  const [e, setE] = useState<Record<string, string>>({});
  const set = (k: keyof typeof v, val: string) => { setV({ ...v, [k]: val }); setE({ ...e, [k]: '' }); };
  const submit = () => {
    const er: Record<string, string> = {};
    if (!v.driverName.trim()) er.driverName = "Вкажіть прізвище та ім'я водія";
    if (v.driverPhone9.length !== 9) er.driverPhone9 = 'Введіть номер повністю';
    if (!v.carNumber.trim()) er.carNumber = 'Вкажіть номер авто';
    if (!v.loadAt) er.loadAt = 'Вкажіть дату завантаження';
    if (!v.deliveryAt) er.deliveryAt = 'Вкажіть дату доставки';
    else if (v.loadAt && v.deliveryAt < v.loadAt) er.deliveryAt = 'Не раніше дати завантаження';
    setE(er);
    if (Object.keys(er).length) return;
    onSubmit({ ...v, driverPhone: '+380' + v.driverPhone9 });
  };
  const field = (k: keyof typeof v, label: string, req: boolean, props: InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="field"><span className="label">{label} {req && <span className="req">*</span>}</span>
      <input className={`input ${e[k] ? 'is-invalid' : ''}`} value={v[k]} onChange={(ev) => set(k, ev.target.value)} {...props} />
      {e[k] && <span className="field-error">{e[k]}</span>}</label>
  );
  return (
    <Modal title={c ? 'Змінити дані авто' : 'Внести дані по авто'} width={620} onClose={onClose} footer={<>
      <button className="btn btn-subtle" onClick={onClose}>Скасувати</button>
      <button className="btn btn-primary" disabled={busy} onClick={submit}>Підтвердити</button>
    </>}>
      <p className="muted">{c ? 'Замовник отримає сповіщення та лист про зміну авто.' : 'Після підтвердження статус зміниться на «Авто призначено», замовник отримає сповіщення та лист.'}</p>
      <div className="form-grid">
        {field('driverName', "Прізвище та ім'я водія", true)}
        <label className="field"><span className="label">Телефон водія <span className="req">*</span></span>
          <PhoneInput value={v.driverPhone9} onChange={(x) => set('driverPhone9', x)} invalid={!!e.driverPhone9} />
          {e.driverPhone9 && <span className="field-error">{e.driverPhone9}</span>}</label>
        {field('carModel', 'Марка та модель авто', false, { placeholder: 'Напр., Renault Master' })}
        {field('carNumber', 'Номер авто', true, { placeholder: 'AA 1234 KX' })}
        {field('driverLicense', 'Номер посвідчення водія', false)}
        {field('loadAt', 'Дата завантаження', true, { type: 'datetime-local' })}
        {field('deliveryAt', 'Дата доставки', true, { type: 'datetime-local', min: v.loadAt })}
      </div>
    </Modal>
  );
}
