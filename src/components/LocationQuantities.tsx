import { useMemo, useState } from 'react';
import type { Location } from '../api';
import { Icon } from './ui';

export type QtyMap = Record<number, string>;

export const isValidQty = (v: string) => /^\d+$/.test(v.trim()) && Number(v) > 0;
export const sumQty = (m: QtyMap) => Object.values(m).reduce((s, v) => s + (isValidQty(v) ? Number(v) : 0), 0);
export const filledCount = (m: QtyMap) => Object.values(m).filter((v) => v.trim() !== '').length;

/**
 * Введення кількостей по 35 локаціях:
 * пошук, фільтр «лише заповнені», вибір кількох локацій і масове заповнення однаковою кількістю,
 * копіювання з іншого товару, підсумок.
 */
export default function LocationQuantities({ locations, value, onChange, copySources, unit }: {
  locations: Location[];
  value: QtyMap;
  onChange: (m: QtyMap) => void;
  copySources: { key: string; name: string; qty: QtyMap }[];
  unit: string;
}) {
  const [search, setSearch] = useState('');
  const [onlyFilled, setOnlyFilled] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulk, setBulk] = useState('');

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    return locations.filter((l) => (!s || l.name.toLowerCase().includes(s)) && (!onlyFilled || (value[l.id] ?? '').trim() !== ''));
  }, [locations, search, onlyFilled, value]);

  const allVisibleSelected = visible.length > 0 && visible.every((l) => selected.has(l.id));
  const toggleAllVisible = () => {
    const next = new Set(selected);
    if (allVisibleSelected) visible.forEach((l) => next.delete(l.id));
    else visible.forEach((l) => next.add(l.id));
    setSelected(next);
  };
  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  const setQty = (id: number, v: string) => {
    const clean = v.replace(/[^\d]/g, '').slice(0, 7);
    const next = { ...value };
    if (clean === '') delete next[id]; else next[id] = clean;
    onChange(next);
  };
  const applyBulk = () => {
    if (!isValidQty(bulk) || !selected.size) return;
    const next = { ...value };
    selected.forEach((id) => (next[id] = String(Number(bulk))));
    onChange(next);
  };
  const clearSelected = () => {
    const next = { ...value };
    selected.forEach((id) => delete next[id]);
    onChange(next);
  };

  const total = sumQty(value);
  const filled = filledCount(value);
  const bulkValid = isValidQty(bulk);

  return (
    <div className="locq">
      <div className="locq-toolbar">
        <div className="input-icon locq-search">
          <Icon name="search" size={16} />
          <input className="input input-sm" placeholder="Пошук локації…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <label className="check">
          <input type="checkbox" checked={onlyFilled} onChange={(e) => setOnlyFilled(e.target.checked)} /> Лише заповнені
        </label>
        {copySources.length > 0 && (
          <select className="input input-sm locq-copy" value="" onChange={(e) => {
            const src = copySources.find((c) => c.key === e.target.value);
            if (src) onChange({ ...src.qty });
          }}>
            <option value="">Скопіювати кількості з товару…</option>
            {copySources.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
          </select>
        )}
      </div>

      <div className={`locq-bulk ${selected.size ? 'is-active' : ''}`}>
        <label className="check">
          <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} />
          {allVisibleSelected ? 'Зняти вибір' : `Вибрати всі${search || onlyFilled ? ' знайдені' : ''} (${visible.length})`}
        </label>
        <span className="muted">Вибрано: <b>{selected.size}</b></span>
        <span className="locq-bulk-fill">
          <input className="input input-sm input-qty" inputMode="numeric" placeholder="К-сть" value={bulk}
            onChange={(e) => setBulk(e.target.value.replace(/[^\d]/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyBulk(); } }} />
          <button type="button" className="btn btn-default btn-sm" disabled={!selected.size || !bulkValid} onClick={applyBulk}>
            Заповнити вибрані
          </button>
          <button type="button" className="btn btn-subtle btn-sm" disabled={!selected.size} onClick={clearSelected}>Очистити вибрані</button>
          {selected.size > 0 && <button type="button" className="btn btn-subtle btn-sm" onClick={() => setSelected(new Set())}>Скинути вибір</button>}
        </span>
      </div>

      <div className="locq-grid">
        {visible.map((l) => {
          const v = value[l.id] ?? '';
          const bad = v !== '' && !isValidQty(v);
          return (
            <div key={l.id} className={`locq-row ${v ? 'is-filled' : ''} ${selected.has(l.id) ? 'is-selected' : ''}`}>
              <label className="locq-name">
                <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} aria-label={`Вибрати ${l.name}`} />
                <span title={l.name}>{l.name}</span>
              </label>
              <input
                className={`input input-sm input-qty ${bad ? 'is-invalid' : ''}`}
                inputMode="numeric"
                value={v}
                placeholder="0"
                aria-label={`Кількість для ${l.name}`}
                onChange={(e) => setQty(l.id, e.target.value)}
              />
            </div>
          );
        })}
        {visible.length === 0 && <div className="muted locq-empty">Локацій не знайдено</div>}
      </div>

      <div className="locq-footer">
        <span>Заповнено локацій: <b>{filled}</b> з {locations.length}</span>
        <span className="locq-total">Разом по товару: <b>{total}</b> {unit}</span>
      </div>
    </div>
  );
}
