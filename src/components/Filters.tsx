import type { ReactNode } from 'react';
import type { PurchaseRow, TransportRow } from '../api';
import { REQUEST_STATUS, TRANSPORT_STATUS } from '../../shared/constants';
import { Icon } from './ui';

// ---------- Базові контроли ----------

export function FilterBar({ children, onReset, active, count }: { children: ReactNode; onReset: () => void; active: boolean; count?: ReactNode }) {
  return (
    <div className="filters" role="search">
      {children}
      {active && <button className="btn btn-subtle btn-sm" onClick={onReset}>Скинути фільтри</button>}
      {count !== undefined && <span className="muted small filters-count">{count}</span>}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder, width = 240 }: { value: string; onChange: (v: string) => void; placeholder: string; width?: number }) {
  return (
    <div className="input-icon" style={{ width }}>
      <Icon name="search" size={16} />
      <input className="input input-sm" value={value} placeholder={placeholder} aria-label={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function Pick({ value, onChange, label, options }: { value: string; onChange: (v: string) => void; label: string; options: [string, string][] }) {
  return (
    <select className="input input-sm" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

export function Period({ label, from, to, onChange }: { label: string; from: string; to: string; onChange: (from: string, to: string) => void }) {
  return (
    <span className="period" role="group" aria-label={label}>
      <span className="muted small">{label}:</span>
      <input className="input input-sm" type="date" value={from} aria-label={`${label} з`} onChange={(e) => onChange(e.target.value, to)} />
      <span className="muted">—</span>
      <input className="input input-sm" type="date" value={to} aria-label={`${label} по`} onChange={(e) => onChange(from, e.target.value)} />
    </span>
  );
}

const inPeriod = (value: string | null | undefined, from: string, to: string) => {
  if (!from && !to) return true;
  if (!value) return false;
  const d = value.slice(0, 10);
  return (!from || d >= from) && (!to || d <= to);
};
const has = (hay: (string | number | null | undefined)[], q: string) => {
  const n = q.trim().toLowerCase().replace(/^№/, '');
  if (!n) return true;
  return hay.some((h) => h != null && String(h).toLowerCase().includes(n));
};
/** ISO-час (UTC) → локальна дата YYYY-MM-DD для порівняння з фільтром. */
const isoLocalDate = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// ---------- Закупівлі ----------

export type PurchaseFilter = { q: string; status: string; month: string; hasNew: string };
export const PURCHASE_ALL: PurchaseFilter = { q: '', status: '', month: '', hasNew: '' };

export function filterPurchases(rows: PurchaseRow[], f: PurchaseFilter) {
  return rows.filter((r) =>
    (!f.q.trim() || String(r.id) === f.q.trim().replace(/^№/, '')) &&
    (!f.status || r.status === f.status) &&
    (!f.month || r.deliveryMonth === f.month) &&
    (!f.hasNew || (f.hasNew === 'yes' ? r.newCount > 0 : r.newCount === 0)));
}

export function PurchaseFilters({ value, onChange, months, initial, count }: {
  value: PurchaseFilter; onChange: (f: PurchaseFilter) => void; months: { value: string; label: string }[]; initial: PurchaseFilter; count: ReactNode;
}) {
  const set = (patch: Partial<PurchaseFilter>) => onChange({ ...value, ...patch });
  const active = JSON.stringify(value) !== JSON.stringify(initial);
  return (
    <FilterBar active={active} onReset={() => onChange(initial)} count={count}>
      <SearchBox value={value.q} onChange={(q) => set({ q })} placeholder="№ заявки" width={140} />
      <Pick label="Статус" value={value.status} onChange={(status) => set({ status })} options={[['', 'Усі статуси'], ...Object.entries(REQUEST_STATUS)]} />
      <Pick label="Місяць поставки" value={value.month} onChange={(month) => set({ month })} options={[['', 'Усі місяці'], ...months.map((m) => [m.value, m.label] as [string, string])]} />
      <Pick label="Нові позиції" value={value.hasNew} onChange={(hasNew) => set({ hasNew })} options={[['', 'Нові позиції: усі'], ['yes', 'Є нові позиції'], ['no', 'Без нових позицій']]} />
    </FilterBar>
  );
}

// ---------- Перевезення (замовник) ----------

export type TransportFilter = { q: string; status: string; createdFrom: string; createdTo: string; loadFrom: string; loadTo: string };
export const TRANSPORT_ALL: TransportFilter = { q: '', status: '', createdFrom: '', createdTo: '', loadFrom: '', loadTo: '' };

export function filterTransport(rows: TransportRow[], f: TransportFilter) {
  return rows.filter((r) =>
    has([r.id, r.loadAddress, r.unloadAddress], f.q) && (!f.status || r.status === f.status) &&
    inPeriod(isoLocalDate(r.createdAt), f.createdFrom, f.createdTo) && inPeriod(r.loadAt, f.loadFrom, f.loadTo));
}

export function TransportFilters({ value, onChange, count }: { value: TransportFilter; onChange: (f: TransportFilter) => void; count: ReactNode }) {
  const set = (patch: Partial<TransportFilter>) => onChange({ ...value, ...patch });
  return (
    <FilterBar active={JSON.stringify(value) !== JSON.stringify(TRANSPORT_ALL)} onReset={() => onChange(TRANSPORT_ALL)} count={count}>
      <SearchBox value={value.q} onChange={(q) => set({ q })} placeholder="№ або адреса" />
      <Pick label="Статус" value={value.status} onChange={(status) => set({ status })} options={[['', 'Усі статуси'], ...Object.entries(TRANSPORT_STATUS)]} />
      <Period label="Створено" from={value.createdFrom} to={value.createdTo} onChange={(createdFrom, createdTo) => set({ createdFrom, createdTo })} />
      <Period label="Завантаження" from={value.loadFrom} to={value.loadTo} onChange={(loadFrom, loadTo) => set({ loadFrom, loadTo })} />
    </FilterBar>
  );
}

// ---------- Перевезення (диспетчер) ----------

export type DispatchFilter = { q: string; status: string; loadFrom: string; loadTo: string; mine: string; seal: string };
export const DISPATCH_ALL: DispatchFilter = { q: '', status: '', loadFrom: '', loadTo: '', mine: '', seal: '' };

export function filterDispatch(rows: TransportRow[], f: DispatchFilter, me: string) {
  return rows.filter((r) =>
    has([r.id, r.fullName, r.loadAddress, r.unloadAddress, r.carNumber, r.driverName], f.q) && (!f.status || r.status === f.status) &&
    inPeriod(r.loadAt, f.loadFrom, f.loadTo) && (!f.mine || r.dispatcherEmail === me) &&
    (!f.seal || (f.seal === 'yes' ? !!r.sealRequired : !r.sealRequired)));
}

export function DispatchFilters({ value, onChange, count }: { value: DispatchFilter; onChange: (f: DispatchFilter) => void; count: ReactNode }) {
  const set = (patch: Partial<DispatchFilter>) => onChange({ ...value, ...patch });
  return (
    <FilterBar active={JSON.stringify(value) !== JSON.stringify(DISPATCH_ALL)} onReset={() => onChange(DISPATCH_ALL)} count={count}>
      <SearchBox value={value.q} onChange={(q) => set({ q })} placeholder="№, замовник, адреса, авто, водій" width={300} />
      <Pick label="Статус" value={value.status} onChange={(status) => set({ status })} options={[['', 'Усі статуси'], ...Object.entries(TRANSPORT_STATUS)]} />
      <Period label="Завантаження" from={value.loadFrom} to={value.loadTo} onChange={(loadFrom, loadTo) => set({ loadFrom, loadTo })} />
      <div className="segmented segmented-sm" role="radiogroup" aria-label="Чиї заявки">
        <button type="button" className={`seg ${!value.mine ? 'is-on' : ''}`} onClick={() => set({ mine: '' })} aria-pressed={!value.mine}>Усі</button>
        <button type="button" className={`seg ${value.mine ? 'is-on' : ''}`} onClick={() => set({ mine: 'yes' })} aria-pressed={!!value.mine}>Мої</button>
      </div>
      <Pick label="Печатка" value={value.seal} onChange={(seal) => set({ seal })} options={[['', 'Печатка: усі'], ['yes', 'Потрібна печатка'], ['no', 'Без печатки']]} />
    </FilterBar>
  );
}
