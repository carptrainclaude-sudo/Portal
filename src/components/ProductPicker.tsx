import { useEffect, useRef, useState } from 'react';
import { api, type Product } from '../api';
import { useApp } from '../context';
import { Icon, Modal } from './ui';
import { normalizeName } from '../../shared/normalize';

type CheckResult = { exact: Product | null; similar: (Product & { score: number })[] };

/** Вибраний товар: з довідника (productId) або нова позиція (лише в цій заявці). */
export type Picked = { productId: number | null; name: string; unit: string; isNew: boolean };
export const pickedKey = (p: { productId: number | null; name: string }) => (p.productId ? `p:${p.productId}` : `n:${normalizeName(p.name)}`);

/** Поле вибору товару з автопідказками з довідника + додавання нової позиції з підказкою схожих назв. */
export default function ProductPicker({ categoryId, excludeKeys, onPick, autoFocus }: {
  categoryId: number;
  excludeKeys: string[];
  onPick: (p: Picked) => void;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => {
      api.get<Product[]>(`/api/products?categoryId=${categoryId}&q=${encodeURIComponent(q)}`).then((r) => { setResults(r); setActive(0); });
    }, 150);
    return () => clearTimeout(t);
  }, [q, categoryId]);

  useEffect(() => {
    const h = (e: MouseEvent) => boxRef.current && !boxRef.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const showList = open && q.trim().length >= 2;
  const options: ({ kind: 'p'; p: Product } | { kind: 'new' })[] = [...results.map((p) => ({ kind: 'p' as const, p })), { kind: 'new' as const }];
  const used = (p: Product) => excludeKeys.includes(`p:${p.id}`);

  const choose = (i: number) => {
    const o = options[i];
    if (!o) return;
    if (o.kind === 'new') { setCreating(q.trim()); setOpen(false); return; }
    if (used(o.p)) return;
    onPick({ productId: o.p.id, name: o.p.name, unit: o.p.unit, isNew: false });
    setQ('');
    setOpen(false);
  };

  return (
    <div className="picker" ref={boxRef}>
      <div className="input-icon">
        <Icon name="search" size={16} />
        <input
          className="input" value={q} autoFocus={autoFocus}
          placeholder="Почніть вводити назву товару (від 2 символів)…"
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!showList) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, options.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            if (e.key === 'Enter') { e.preventDefault(); choose(active); }
            if (e.key === 'Escape') setOpen(false);
          }}
          role="combobox" aria-expanded={showList} aria-autocomplete="list" aria-label="Пошук товару в довіднику"
        />
      </div>
      {showList && (
        <div className="picker-list" role="listbox">
          {results.length === 0 && <div className="picker-empty">У довіднику нічого не знайдено</div>}
          {options.map((o, i) => o.kind === 'p' ? (
            <button key={o.p.id} type="button" role="option" aria-selected={i === active} aria-disabled={used(o.p)}
              className={`picker-item ${i === active ? 'is-active' : ''} ${used(o.p) ? 'is-disabled' : ''}`}
              onMouseEnter={() => setActive(i)} onClick={() => choose(i)}>
              <span className="picker-name">{o.p.name}</span>
              <span className="picker-meta">{used(o.p) ? <span className="muted small">вже в заявці</span> : <span className="muted small">{o.p.unit}</span>}</span>
            </button>
          ) : (
            <button key="new" type="button" role="option" aria-selected={i === active} className={`picker-item picker-new ${i === active ? 'is-active' : ''}`}
              onMouseEnter={() => setActive(i)} onClick={() => choose(i)}>
              <Icon name="plus" size={16} /> Додати новий товар: <b>{q.trim()}</b>
            </button>
          ))}
        </div>
      )}
      {creating !== null && (
        <NewPositionModal
          initialName={creating} categoryId={categoryId} excludeKeys={excludeKeys}
          onClose={() => setCreating(null)}
          onDone={(p) => { setCreating(null); setQ(''); onPick(p); }}
        />
      )}
    </div>
  );
}

/** Нова позиція: НЕ зберігається в довідник — лише в заявці. Показуємо схожі назви, щоб обрати наявний товар. */
function NewPositionModal({ initialName, categoryId, excludeKeys, onClose, onDone }: {
  initialName: string; categoryId: number; excludeKeys: string[];
  onClose: () => void; onDone: (p: Picked) => void;
}) {
  const { meta } = useApp();
  const [name, setName] = useState(initialName);
  const [unit, setUnit] = useState('шт');
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (name.trim().length < 3) { setCheck(null); return; }
    const t = setTimeout(() => api.post<CheckResult>('/api/products/check', { name, categoryId }).then(setCheck), 250);
    return () => clearTimeout(t);
  }, [name, categoryId]);

  const pickExisting = (p: Product) => {
    if (excludeKeys.includes(`p:${p.id}`)) { setError(`Товар «${p.name}» уже є в заявці`); return; }
    onDone({ productId: p.id, name: p.name, unit: p.unit, isNew: false });
  };
  const addNew = () => {
    const clean = name.replace(/\s+/g, ' ').trim();
    if (clean.length < 3) { setError('Назва має містити щонайменше 3 символи'); return; }
    if (check?.exact) { setError('Такий товар уже є в довіднику — оберіть його вище'); return; }
    if (excludeKeys.includes(`n:${normalizeName(clean)}`)) { setError('Таку нову позицію вже додано в заявку'); return; }
    onDone({ productId: null, name: clean, unit, isNew: true });
  };

  return (
    <Modal
      title="Нова позиція"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-subtle" onClick={onClose}>Скасувати</button>
          {!check?.exact && (
            <button className={`btn ${check?.similar.length ? 'btn-default' : 'btn-primary'}`} onClick={addNew}>
              {check?.similar.length ? 'Ні, додати як нову позицію' : 'Додати нову позицію'}
            </button>
          )}
        </>
      }
    >
      <p className="muted">
        Товару немає в довіднику. Він буде доданий <b>лише в цю заявку</b> з позначкою «нова позиція».
        Закупівельник перевірить його і за потреби додасть до довідника.
      </p>
      <label className="field">
        <span className="label">Назва товару <span className="req">*</span></span>
        <input className="input" value={name} onChange={(e) => { setName(e.target.value); setError(''); }} autoFocus />
      </label>
      <label className="field">
        <span className="label">Одиниця виміру <span className="req">*</span></span>
        <select className="input" value={unit} onChange={(e) => setUnit(e.target.value)}>
          {meta?.units.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </label>
      {check?.exact && (
        <div className="banner banner-warning">
          <b>Такий товар уже є в довіднику</b> (без урахування регістру, пробілів і латиниці/кирилиці):
          <button className="suggestion" onClick={() => pickExisting(check.exact!)}><span>{check.exact.name}</span><span className="muted small">{check.exact.unit} · Обрати</span></button>
        </div>
      )}
      {!check?.exact && !!check?.similar.length && (
        <div className="banner banner-info">
          <b>Можливо, ви мали на увазі…</b>
          {check.similar.map((s) => (
            <button key={s.id} className="suggestion" onClick={() => pickExisting(s)}><span>{s.name}</span><span className="muted small">{s.unit} · Обрати</span></button>
          ))}
        </div>
      )}
      {error && <div className="field-error">{error}</div>}
    </Modal>
  );
}
