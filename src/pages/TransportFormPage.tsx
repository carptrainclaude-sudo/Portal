import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type TransportDetail } from '../api';
import { useApp } from '../context';
import { PageHeader, TransportStatusBadge } from '../components/ui';
import { PhoneInput, phone9Of } from './RequestFormPage';
import { localNow } from '../../shared/constants';

type F = {
  fullName: string; phone9: string; position: string;
  loadAddress: string; loadContactName: string; loadContactPhone9: string; loadAt: string;
  cargoDetails: string; seal: '' | 'yes' | 'no';
  unloadAddress: string; unloadContactName: string; unloadContactPhone9: string; unloadCompany: string; unloadAt: string;
};
const EMPTY: F = {
  fullName: '', phone9: '', position: '', loadAddress: '', loadContactName: '', loadContactPhone9: '', loadAt: '',
  cargoDetails: '', seal: '', unloadAddress: '', unloadContactName: '', unloadContactPhone9: '', unloadCompany: '', unloadAt: '',
};
const CARGO_HINT = 'Вкажіть: що за вантаж, кількість місць, вага (кг), об\'єм (м³) або габарити, тип упаковки, особливі умови (крихке, температурний режим тощо)';

export default function TransportFormPage() {
  const { id } = useParams();
  const editId = id ? Number(id) : null;
  const { user, toast } = useApp();
  const nav = useNavigate();
  const [f, setF] = useState<F | null>(null);
  const [orig, setOrig] = useState<TransportDetail | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof F, string>>>({});
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (editId) {
      api.get<TransportDetail>(`/api/transport/${editId}`).then((t) => {
        setOrig(t);
        setF({
          fullName: t.fullName, phone9: phone9Of(t.phone), position: t.position,
          loadAddress: t.loadAddress, loadContactName: t.loadContactName, loadContactPhone9: phone9Of(t.loadContactPhone), loadAt: t.loadAt,
          cargoDetails: t.cargoDetails, seal: t.sealRequired ? 'yes' : 'no',
          unloadAddress: t.unloadAddress, unloadContactName: t.unloadContactName ?? '', unloadContactPhone9: phone9Of(t.unloadContactPhone),
          unloadCompany: t.unloadCompany ?? '', unloadAt: t.unloadAt,
        });
      }).catch((e) => setLoadError(e.message));
    } else {
      api.get<{ lastName: string; firstName: string; phone: string; transportName: string | null; position: string | null } | null>('/api/profile').then((p) => {
        setF({
          ...EMPTY,
          fullName: p?.transportName || [p?.lastName, p?.firstName].filter(Boolean).join(' '),
          phone9: phone9Of(p?.phone), position: p?.position ?? '',
        });
      });
    }
  }, [editId]);

  if (loadError) return <div className="banner banner-error">{loadError}</div>;
  if (!f) return <div className="page-loading">Завантаження…</div>;
  if (orig && orig.status !== 'NEW' && orig.status !== 'REWORK') {
    return <div className="banner banner-warning">Заявка №{orig.id} має статус <TransportStatusBadge status={orig.status} /> — редагування недоступне. <Link to={`/transport/${orig.id}`}>Переглянути</Link></div>;
  }

  const set = <K extends keyof F>(k: K, v: F[K]) => { setF({ ...f, [k]: v }); setErrors((e) => ({ ...e, [k]: undefined })); };
  const nowLocal = localNow();

  const validate = () => {
    const e: Partial<Record<keyof F, string>> = {};
    if (!f.fullName.trim()) e.fullName = "Вкажіть прізвище та ім'я";
    if (f.phone9.length !== 9) e.phone9 = 'Введіть номер повністю';
    if (!f.position.trim()) e.position = 'Вкажіть посаду';
    if (!f.loadAddress.trim()) e.loadAddress = 'Вкажіть адресу завантаження';
    if (!f.loadContactName.trim()) e.loadContactName = "Вкажіть ім'я контактної особи";
    if (f.loadContactPhone9.length !== 9) e.loadContactPhone9 = 'Введіть номер повністю';
    if (!f.loadAt) e.loadAt = 'Вкажіть дату та час';
    else if (f.loadAt < nowLocal && f.loadAt !== orig?.loadAt) e.loadAt = 'Дата завантаження не може бути в минулому';
    if (!f.cargoDetails.trim()) e.cargoDetails = 'Опишіть вантаж';
    if (!f.seal) e.seal = 'Оберіть «Так» або «Ні»';
    if (!f.unloadAddress.trim()) e.unloadAddress = 'Вкажіть адресу вивантаження';
    if (f.unloadContactPhone9 && f.unloadContactPhone9.length !== 9) e.unloadContactPhone9 = 'Введіть номер повністю або залиште порожнім';
    if (!f.unloadAt) e.unloadAt = 'Вкажіть дату та час';
    else if (f.loadAt && f.unloadAt < f.loadAt) e.unloadAt = 'Не раніше дати завантаження';
    setErrors(e);
    if (Object.keys(e).length) setTimeout(() => document.querySelector('.is-invalid')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 30);
    return !Object.keys(e).length;
  };

  const submit = async () => {
    if (!validate()) return;
    setBusy(true);
    const body = {
      fullName: f.fullName, phone: '+380' + f.phone9, position: f.position,
      loadAddress: f.loadAddress, loadContactName: f.loadContactName, loadContactPhone: '+380' + f.loadContactPhone9, loadAt: f.loadAt,
      cargoDetails: f.cargoDetails, seal: f.seal,
      unloadAddress: f.unloadAddress, unloadContactName: f.unloadContactName,
      unloadContactPhone: f.unloadContactPhone9 ? '+380' + f.unloadContactPhone9 : '', unloadCompany: f.unloadCompany, unloadAt: f.unloadAt,
    };
    try {
      if (editId) {
        await api.put(`/api/transport/${editId}`, body);
        toast(orig?.status === 'REWORK' ? `Заявку №${editId} виправлено та повторно відправлено` : `Заявку №${editId} збережено`);
        nav(`/transport/${editId}`);
      } else {
        const r = await api.post<{ id: number }>('/api/transport', body);
        toast(`Заявку на перевезення №${r.id} відправлено диспетчерам`);
        nav(`/transport/${r.id}`);
      }
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const err = (k: keyof F) => (errors[k] ? <span className="field-error">{errors[k]}</span> : null);
  const inv = (k: keyof F) => (errors[k] ? 'is-invalid' : '');
  const text = (k: keyof F, label: string, req = true, placeholder = '') => (
    <label className="field">
      <span className="label">{label} {req && <span className="req">*</span>}</span>
      <input className={`input ${inv(k)}`} value={f[k] as string} placeholder={placeholder} onChange={(e) => set(k, e.target.value as never)} />
      {err(k)}
    </label>
  );
  const phone = (k: 'phone9' | 'loadContactPhone9' | 'unloadContactPhone9', label: string, req = true) => (
    <label className="field">
      <span className="label">{label} {req && <span className="req">*</span>}</span>
      <PhoneInput value={f[k]} onChange={(v) => set(k, v)} invalid={!!errors[k]} />
      {err(k)}
    </label>
  );

  return (
    <>
      <PageHeader
        title={editId ? `Редагування заявки на перевезення №${editId}` : 'Замовити транспорт'}
        crumbs={editId ? <><Link to="/my-requests">Мої заявки</Link> / <Link to={`/transport/${editId}`}>№{editId}</Link></> : <><Link to="/catalog">Каталог сервісів</Link> / <Link to="/catalog/transport">Замовлення транспорту</Link> / Нова заявка</>}
      >
        <p className="muted">Поля з <span className="req">*</span> — обов'язкові.</p>
      </PageHeader>

      {orig?.status === 'REWORK' && orig.reworkComment && (
        <div className="banner banner-warning"><b>Заявку повернуто на доопрацювання.</b> Коментар диспетчера:
          <div className="rework-comment">{orig.reworkComment}</div>Після збереження заявка знову отримає статус «Нова».</div>
      )}

      <section className="card">
        <h3 className="card-title">Контактна інформація</h3>
        <div className="form-grid">
          {text('fullName', "Прізвище та ім'я")}
          {phone('phone9', 'Контактний телефон')}
          {text('position', 'Посада')}
          <label className="field"><span className="label">Email</span><input className="input" value={user?.email ?? ''} readOnly disabled /></label>
        </div>
        <p className="hint">Після першої заявки контактні дані зберігаються в профіль і підставляються автоматично.</p>
      </section>

      <section className="card">
        <h3 className="card-title">Завантаження</h3>
        <div className="form-grid">
          <div className="span-2">{text('loadAddress', 'Адреса завантаження', true, 'Місто, вулиця, будинок, склад')}</div>
          {text('loadContactName', "Контактна особа: ім'я")}
          {phone('loadContactPhone9', 'Контактна особа: телефон')}
          <label className="field">
            <span className="label">Бажана дата та час завантаження <span className="req">*</span></span>
            <input type="datetime-local" className={`input ${inv('loadAt')}`} value={f.loadAt} min={nowLocal} onChange={(e) => set('loadAt', e.target.value)} />
            {err('loadAt')}
          </label>
        </div>
      </section>

      <section className="card">
        <h3 className="card-title">Вантаж</h3>
        <label className="field">
          <span className="label">Деталі вантажу <span className="req">*</span></span>
          <textarea className={`input ${inv('cargoDetails')}`} rows={4} value={f.cargoDetails} onChange={(e) => set('cargoDetails', e.target.value)} />
          <span className="hint">{CARGO_HINT}</span>
          {err('cargoDetails')}
        </label>
        <label className="field" style={{ maxWidth: 260 }}>
          <span className="label">Потреба в печатці <span className="req">*</span></span>
          <select className={`input ${inv('seal')}`} value={f.seal} onChange={(e) => set('seal', e.target.value as F['seal'])}>
            <option value="">—</option>
            <option value="yes">Так</option>
            <option value="no">Ні</option>
          </select>
          {err('seal')}
        </label>
      </section>

      <section className="card">
        <h3 className="card-title">Вивантаження</h3>
        <div className="form-grid">
          <div className="span-2">{text('unloadAddress', 'Адреса вивантаження', true, 'Місто, вулиця, будинок')}</div>
          {text('unloadContactName', "Контактна особа: ім'я", false)}
          {phone('unloadContactPhone9', 'Контактна особа: телефон', false)}
          {text('unloadCompany', 'Назва компанії', false)}
          <label className="field">
            <span className="label">Бажана дата та час вивантаження <span className="req">*</span></span>
            <input type="datetime-local" className={`input ${inv('unloadAt')}`} value={f.unloadAt} min={f.loadAt || nowLocal} onChange={(e) => set('unloadAt', e.target.value)} />
            {err('unloadAt')}
          </label>
        </div>
      </section>

      <div className="form-actions sticky-actions">
        <button className="btn btn-subtle" onClick={() => nav(editId ? `/transport/${editId}` : '/catalog/transport')}>Скасувати</button>
        <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'Відправлення…' : editId ? 'Зберегти та відправити' : 'Відправити заявку'}</button>
      </div>
    </>
  );
}
