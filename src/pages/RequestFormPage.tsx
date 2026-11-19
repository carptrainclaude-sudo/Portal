import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type RequestDetail } from '../api';
import { useApp } from '../context';
import { Icon, PageHeader, RequestStatus } from '../components/ui';
import ProductPicker, { pickedKey, type Picked } from '../components/ProductPicker';
import LocationQuantities, { filledCount, isValidQty, sumQty, type QtyMap } from '../components/LocationQuantities';
import Matrix from '../components/Matrix';
import { REQUEST_TYPE, monthLabel } from '../../shared/constants';

type FormItem = { key: string; productId: number | null; name: string; unit: string; isNew: boolean; qty: QtyMap; collapsed: boolean };
type Form = {
  lastName: string; firstName: string; phone9: string; deliveryMonth: string;
  type: string; categoryId: number; items: FormItem[];
};

/** Маска телефону: +380 (XX) XXX-XX-XX; зберігаємо 9 цифр після 380. */
export function formatPhone9(d: string) {
  let s = '+380';
  if (d.length > 0) s += ' (' + d.slice(0, 2);
  if (d.length >= 2) s += ')';
  if (d.length > 2) s += ' ' + d.slice(2, 5);
  if (d.length > 5) s += '-' + d.slice(5, 7);
  if (d.length > 7) s += '-' + d.slice(7, 9);
  return s;
}
export const phone9Of = (p: string | null | undefined) => (p ? p.replace(/\D/g, '').slice(3, 12) : '');

export function PhoneInput({ value, onChange, invalid, id }: { value: string; onChange: (v: string) => void; invalid?: boolean; id?: string }) {
  return (
    <input
      id={id}
      className={`input ${invalid ? 'is-invalid' : ''}`}
      inputMode="tel"
      value={formatPhone9(value)}
      placeholder="+380 (__) ___-__-__"
      onChange={(e) => {
        let d = e.target.value.replace(/\D/g, '');
        if (d.startsWith('380')) d = d.slice(3);
        d = d.slice(0, 9);
        if (d === value && e.target.value.length < formatPhone9(value).length) d = d.slice(0, -1);
        onChange(d);
      }}
    />
  );
}

export default function RequestFormPage() {
  const { id } = useParams();
  const editId = id ? Number(id) : null;
  const { user, meta, toast } = useApp();
  const nav = useNavigate();

  const [form, setForm] = useState<Form | null>(null);
  const [orig, setOrig] = useState<RequestDetail | null>(null);
  const [step, setStep] = useState<'edit' | 'review'>('edit');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [showPicker, setShowPicker] = useState(true);

  useEffect(() => {
    if (!meta) return;
    const defCat = meta.categories[0]?.id ?? 1;
    if (editId) {
      api.get<RequestDetail>(`/api/requests/${editId}`).then((r) => {
        setOrig(r);
        const items: FormItem[] = r.lines.filter((l) => !l.removed).map((l) => {
          const qty: QtyMap = {};
          r.items.filter((i) => i.lineId === l.id).forEach((i) => (qty[i.locationId] = String(i.qty)));
          const p = { productId: l.productId, name: l.name, unit: l.unit };
          return { key: pickedKey(p), ...p, isNew: !!l.isNew, qty, collapsed: true };
        });
        setForm({ lastName: r.lastName, firstName: r.firstName, phone9: phone9Of(r.phone), deliveryMonth: r.deliveryMonth, type: r.type, categoryId: r.categoryId, items });
        setShowPicker(false);
      }).catch((e) => setLoadError(e.message));
    } else {
      api.get<{ lastName: string; firstName: string; phone: string } | null>('/api/profile').then((p) => {
        setForm({ lastName: p?.lastName ?? '', firstName: p?.firstName ?? '', phone9: phone9Of(p?.phone), deliveryMonth: '', type: 'PLANNED', categoryId: defCat, items: [] });
      });
    }
  }, [editId, meta]);

  const monthOpts = useMemo(() => {
    const opts = meta?.months ?? [];
    if (form?.deliveryMonth && !opts.some((o) => o.value === form.deliveryMonth)) return [{ value: form.deliveryMonth, label: monthLabel(form.deliveryMonth) }, ...opts];
    return opts;
  }, [meta, form?.deliveryMonth]);

  if (loadError) return <div className="banner banner-error">{loadError}</div>;
  if (!form || !meta) return <div className="page-loading">Завантаження…</div>;
  if (orig && orig.status !== 'NEW' && orig.status !== 'REWORK') {
    return <div className="banner banner-warning">Заявка №{orig.id} має статус <RequestStatus status={orig.status} /> — редагування недоступне. <Link to={`/requests/${orig.id}`}>Переглянути</Link></div>;
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v });
  const setItem = (i: number, patch: Partial<FormItem>) => setForm({ ...form, items: form.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  const removeItem = (i: number) => setForm({ ...form, items: form.items.filter((_, j) => j !== i) });
  const addProduct = (p: Picked) => {
    const key = pickedKey(p);
    if (form.items.some((it) => it.key === key)) { toast(`Товар «${p.name}» уже є в заявці`, 'error'); return; }
    setForm({ ...form, items: [...form.items.map((it) => ({ ...it, collapsed: true })), { key, ...p, qty: {}, collapsed: false }] });
    setShowPicker(false);
    setErrors((e) => ({ ...e, items: '' }));
    if (p.isNew) toast(`«${p.name}» додано як нову позицію — її перевірить закупівельник`, 'info');
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.lastName.trim()) e.lastName = 'Вкажіть прізвище';
    if (!form.firstName.trim()) e.firstName = "Вкажіть ім'я";
    if (form.phone9.length !== 9) e.phone = 'Введіть номер повністю: +380 (XX) XXX-XX-XX';
    if (!form.deliveryMonth) e.deliveryMonth = 'Оберіть місяць поставки';
    if (!form.items.length) e.items = 'Додайте щонайменше один товар';
    form.items.forEach((it) => {
      const vals = Object.values(it.qty).filter((v) => v.trim() !== '');
      if (!vals.length) e[`item-${it.key}`] = 'Вкажіть кількість щонайменше для однієї локації';
      else if (vals.some((v) => !isValidQty(v))) e[`item-${it.key}`] = 'Кількість має бути цілим числом більше 0';
    });
    setErrors(e);
    if (Object.keys(e).length) {
      setForm({ ...form, items: form.items.map((it) => (e[`item-${it.key}`] ? { ...it, collapsed: false } : it)) });
      setTimeout(() => document.querySelector('.is-invalid, .field-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    }
    return !Object.keys(e).length;
  };

  const submit = async () => {
    setSubmitting(true);
    const payload = {
      lastName: form.lastName.trim(), firstName: form.firstName.trim(), phone: `+380${form.phone9}`,
      deliveryMonth: form.deliveryMonth, type: form.type, categoryId: form.categoryId,
      items: form.items.map((it) => ({
        ...(it.productId ? { productId: it.productId } : { newName: it.name, newUnit: it.unit }),
        quantities: Object.entries(it.qty).filter(([, v]) => isValidQty(v)).map(([loc, v]) => ({ locationId: Number(loc), qty: Number(v) })),
      })),
    };
    try {
      if (editId) {
        await api.put(`/api/requests/${editId}`, payload);
        toast(orig?.status === 'REWORK' ? `Заявку №${editId} виправлено та повторно відправлено` : `Заявку №${editId} збережено`);
        nav(`/requests/${editId}`);
      } else {
        const r = await api.post<{ id: number }>('/api/requests', payload);
        toast(`Заявку №${r.id} створено та відправлено закупівельникам`);
        nav(`/requests/${r.id}`);
      }
    } catch (e) {
      toast((e as Error).message, 'error');
      setStep('edit');
    } finally {
      setSubmitting(false);
    }
  };

  const category = meta.categories.find((c) => c.id === form.categoryId)?.name ?? '';
  const crumbs = editId
    ? <><Link to="/my-requests">Мої заявки</Link> / <Link to={`/requests/${editId}`}>№{editId}</Link></>
    : <><Link to="/catalog">Каталог сервісів</Link> / Запит на закупівлю</>;
  const newCount = form.items.filter((i) => i.isNew).length;

  if (step === 'review') {
    return (
      <>
        <PageHeader title="Перевірка замовлення" crumbs={crumbs} />
        <div className="card">
          <div className="kv-grid">
            <div><span className="kv-k">Замовник</span><span>{form.lastName} {form.firstName}</span></div>
            <div><span className="kv-k">Телефон</span><span>{formatPhone9(form.phone9)}</span></div>
            <div><span className="kv-k">Email</span><span>{user?.email}</span></div>
            <div><span className="kv-k">Місяць поставки</span><span>{monthLabel(form.deliveryMonth)}</span></div>
            <div><span className="kv-k">Тип заявки</span><span>{REQUEST_TYPE[form.type as keyof typeof REQUEST_TYPE]}</span></div>
            <div><span className="kv-k">Категорія</span><span>{category}</span></div>
          </div>
        </div>
        {newCount > 0 && <div className="banner banner-info">У заявці {newCount} нов{newCount === 1 ? 'а позиція' : 'і позиції'} (немає в довіднику). Закупівельник перевірить їх перед узяттям заявки в роботу.</div>}
        <div className="card">
          <h3 className="card-title">Товари за локаціями</h3>
          <Matrix
            locations={meta.locations}
            rows={form.items.map((it) => ({
              key: it.key, name: it.name, unit: it.unit, isNew: it.isNew, newLabel: 'нова позиція',
              cells: Object.fromEntries(Object.entries(it.qty).filter(([, v]) => isValidQty(v)).map(([k, v]) => [Number(k), { qty: Number(v) }])),
            }))}
          />
        </div>
        <div className="form-actions sticky-actions">
          <button className="btn btn-default" onClick={() => setStep('edit')} disabled={submitting}><Icon name="back" /> Назад до редагування</button>
          <button className="btn btn-primary" onClick={submit} disabled={submitting}><Icon name="check" /> {submitting ? 'Відправлення…' : 'Підтвердити'}</button>
        </div>
      </>
    );
  }

  const totalUnits = form.items.reduce((s, it) => s + sumQty(it.qty), 0);
  const removed = orig?.lines.filter((l) => l.removed) ?? [];
  return (
    <>
      <PageHeader title={editId ? `Редагування заявки №${editId}` : 'Запит на закупівлю'} crumbs={crumbs}>
        {!editId && <p className="muted">Заповніть форму та натисніть «Перевірити замовлення». Поля з <span className="req">*</span> — обов'язкові.</p>}
      </PageHeader>

      {orig?.status === 'REWORK' && orig.reworkComment && (
        <div className="banner banner-warning">
          <b>Заявку повернуто на доопрацювання.</b> Коментар закупівельника:
          <div className="rework-comment">{orig.reworkComment}</div>
          Після збереження заявка знову отримає статус «Нова».
        </div>
      )}
      {removed.length > 0 && (
        <div className="banner banner-warning">
          <b>Закупівельник видалив із заявки:</b>
          <ul className="plain-list">{removed.map((l) => <li key={l.id}>«{l.name}» — {l.removedComment}</li>)}</ul>
        </div>
      )}

      <section className="card">
        <h3 className="card-title">Контактні дані</h3>
        <div className="form-grid">
          <label className="field"><span className="label">Прізвище <span className="req">*</span></span>
            <input className={`input ${errors.lastName ? 'is-invalid' : ''}`} value={form.lastName} onChange={(e) => set('lastName', e.target.value)} />
            {errors.lastName && <span className="field-error">{errors.lastName}</span>}</label>
          <label className="field"><span className="label">Ім'я <span className="req">*</span></span>
            <input className={`input ${errors.firstName ? 'is-invalid' : ''}`} value={form.firstName} onChange={(e) => set('firstName', e.target.value)} />
            {errors.firstName && <span className="field-error">{errors.firstName}</span>}</label>
          <label className="field"><span className="label">Телефон <span className="req">*</span></span>
            <PhoneInput value={form.phone9} onChange={(v) => set('phone9', v)} invalid={!!errors.phone} />
            {errors.phone && <span className="field-error">{errors.phone}</span>}</label>
          <label className="field"><span className="label">Email</span>
            <input className="input" value={user?.email ?? ''} readOnly disabled /><span className="hint">Підставлено з логіну</span></label>
        </div>
        <p className="hint">Контактні дані запам'ятовуються та підставляються в наступні заявки.</p>
      </section>

      <section className="card">
        <h3 className="card-title">Параметри заявки</h3>
        <div className="form-grid">
          <label className="field"><span className="label">Місяць поставки <span className="req">*</span></span>
            <select className={`input ${errors.deliveryMonth ? 'is-invalid' : ''}`} value={form.deliveryMonth} onChange={(e) => set('deliveryMonth', e.target.value)}>
              <option value="">Оберіть місяць…</option>
              {monthOpts.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            {errors.deliveryMonth && <span className="field-error">{errors.deliveryMonth}</span>}</label>
          <div className="field"><span className="label">Тип заявки <span className="req">*</span></span>
            <div className="segmented" role="radiogroup">
              <label className={`seg ${form.type === 'PLANNED' ? 'is-on' : ''}`}><input type="radio" name="type" checked={form.type === 'PLANNED'} onChange={() => set('type', 'PLANNED')} /> Планова</label>
              <label className="seg is-disabled" title="Термінові заявки будуть доступні незабаром"><input type="radio" name="type" disabled /> Термінова <span className="lozenge lozenge-grey lozenge-xs">незабаром</span></label>
            </div></div>
          <label className="field"><span className="label">Категорія <span className="req">*</span></span>
            <select className="input" value={form.categoryId} onChange={(e) => set('categoryId', Number(e.target.value))} disabled={form.items.length > 0}>
              {meta.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
        </div>
      </section>

      <section className="card">
        <div className="card-title-row">
          <h3 className="card-title">Товари <span className="muted">({form.items.length})</span></h3>
          {form.items.length > 0 && <span className="muted">Усього одиниць: <b>{totalUnits}</b></span>}
        </div>
        {errors.items && <div className="field-error">{errors.items}</div>}

        {form.items.map((it, i) => {
          const err = errors[`item-${it.key}`];
          const others = form.items.filter((o) => o.key !== it.key && filledCount(o.qty) > 0).map((o) => ({ key: o.key, name: o.name, qty: o.qty }));
          return (
            <div key={it.key} className={`item-card ${err ? 'has-error' : ''} ${it.isNew ? 'is-new' : ''}`}>
              <div className="item-head">
                <button type="button" className="item-toggle" onClick={() => setItem(i, { collapsed: !it.collapsed })} aria-expanded={!it.collapsed}>
                  <span className={`chev ${it.collapsed ? '' : 'is-open'}`}><Icon name="chevron" size={16} /></span>
                  <span className="item-num">{i + 1}</span>
                  <span className="item-name">{it.name}</span>
                </button>
                <span className="item-meta">
                  {it.isNew && <span className="lozenge lozenge-red lozenge-xs" title="Немає в довіднику — перевірить закупівельник">нова позиція</span>}
                  <span className="muted small">{filledCount(it.qty)} лок.</span>
                  <span className="item-total">{sumQty(it.qty)} {it.unit}</span>
                  <button type="button" className="btn btn-subtle btn-icon" onClick={() => removeItem(i)} title="Видалити товар" aria-label="Видалити товар"><Icon name="trash" size={16} /></button>
                </span>
              </div>
              {it.collapsed && filledCount(it.qty) > 0 && (
                <div className="item-chips">
                  {meta.locations.filter((l) => it.qty[l.id]).slice(0, 12).map((l) => <span key={l.id} className="chip">{l.name}: <b>{it.qty[l.id]}</b></span>)}
                  {filledCount(it.qty) > 12 && <span className="chip">+{filledCount(it.qty) - 12}</span>}
                </div>
              )}
              {!it.collapsed && (
                <LocationQuantities locations={meta.locations} value={it.qty} unit={it.unit} copySources={others} onChange={(qty) => setItem(i, { qty })} />
              )}
              {err && <div className="field-error">{err}</div>}
            </div>
          );
        })}

        {showPicker || form.items.length === 0 ? (
          <div className="add-product">
            <span className="label">Товар <span className="req">*</span></span>
            <ProductPicker categoryId={form.categoryId} excludeKeys={form.items.map((it) => it.key)} onPick={addProduct} autoFocus={form.items.length > 0} />
            {form.items.length > 0 && <button type="button" className="btn btn-subtle btn-sm" onClick={() => setShowPicker(false)}>Скасувати</button>}
          </div>
        ) : (
          <button type="button" className="btn btn-default" onClick={() => setShowPicker(true)}><Icon name="plus" /> Додати товар</button>
        )}
      </section>

      <div className="form-actions sticky-actions">
        <button className="btn btn-subtle" onClick={() => nav(editId ? `/requests/${editId}` : '/catalog')}>Скасувати</button>
        <button className="btn btn-primary" onClick={() => validate() && (setStep('review'), window.scrollTo(0, 0))}>Перевірити замовлення</button>
      </div>
    </>
  );
}
