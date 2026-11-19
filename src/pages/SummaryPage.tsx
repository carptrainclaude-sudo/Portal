import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../context';
import { Icon, PageHeader } from '../components/ui';
import { ITEM_STATUS, monthLabel } from '../../shared/constants';

type Row = {
  id: number; requestId: number; customerName: string; deliveryMonth: string; executorEmail: string | null;
  executorName: string | null; plannedDate: string | null; productId: number; productName: string; unit: string;
  locationId: number; locationName: string; qty: number; status: string;
};
type Options = { months: { value: string; label: string }[]; locations: { id: number; name: string }[]; products: { id: number; name: string }[] };

const FILTER_KEYS = ['month', 'executor', 'status', 'locationId', 'productId'] as const;

export default function SummaryPage() {
  const { meta, toast } = useApp();
  const [params, setParams] = useSearchParams();
  const categoryId = params.get('categoryId');
  const [data, setData] = useState<{ rows: Row[]; options: Options } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkDate, setBulkDate] = useState('');
  const [bulkExec, setBulkExec] = useState('');
  const [saving, setSaving] = useState(false);

  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (categoryId) q.set('categoryId', categoryId);
    FILTER_KEYS.forEach((k) => params.get(k) && q.set(k, params.get(k)!));
    return q.toString();
  }, [params, categoryId]);

  const load = useCallback(() => {
    if (!categoryId) return;
    api.get<{ rows: Row[]; options: Options }>(`/api/summary?${query}`).then((d) => {
      setData(d);
      setSelected((s) => new Set([...s].filter((id) => d.rows.some((r) => r.id === id))));
    });
  }, [query, categoryId]);

  useEffect(() => { load(); }, [load]);

  if (!meta) return null;

  // ---- Вибір категорії ----
  if (!categoryId) {
    return (
      <>
        <PageHeader title="Зведена потреба"><p className="muted">Оберіть категорію.</p></PageHeader>
        <div className="service-grid">
          {meta.categories.map((c) => (
            <button key={c.id} className="service-card" onClick={() => setParams({ categoryId: String(c.id) })}>
              <span className="service-icon"><Icon name="table" size={22} /></span>
              <span className="service-body">
                <span className="service-title">{c.name}</span>
                <span className="service-text">Позиції заявок у роботі, згруповані за місяцем поставки.</span>
              </span>
            </button>
          ))}
        </div>
      </>
    );
  }

  const category = meta.categories.find((c) => String(c.id) === categoryId)?.name ?? '';
  const setFilter = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    setParams(p, { replace: true });
  };
  const hasFilters = FILTER_KEYS.some((k) => params.get(k));

  const patch = async (ids: number[], body: Record<string, unknown>) => {
    setSaving(true);
    try {
      const r = await api.patch<{ updated: number; autoDone: number[] }>('/api/items', { ids, ...body });
      if (ids.length > 1) toast(`Оновлено позицій: ${r.updated}`);
      r.autoDone.forEach((id) => toast(`Усі позиції заявки №${id} виконано — заявка отримала статус «Виконано»`, 'info'));
      load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const rows = data?.rows ?? [];
  const groups: { month: string; rows: Row[] }[] = [];
  for (const r of rows) {
    const g = groups[groups.length - 1];
    if (g && g.month === r.deliveryMonth) g.rows.push(r); else groups.push({ month: r.deliveryMonth, rows: [r] });
  }
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleIds = (ids: number[], on: boolean) => {
    const s = new Set(selected);
    ids.forEach((id) => (on ? s.add(id) : s.delete(id)));
    setSelected(s);
  };
  const sel = [...selected];

  return (
    <>
      <PageHeader
        title={`Зведена потреба — ${category}`}
        crumbs={<><Link to="/summary">Зведена потреба</Link> / {category}</>}
        actions={
          <>
            <a className="btn btn-default" href={`/api/summary/export?format=xlsx&${query}`}><Icon name="download" size={16} /> Excel</a>
            <a className="btn btn-default" href={`/api/summary/export?format=pdf&${query}`}><Icon name="download" size={16} /> PDF</a>
          </>
        }
      />

      <div className="filters">
        <select className="input input-sm" value={params.get('month') ?? ''} onChange={(e) => setFilter('month', e.target.value)} aria-label="Місяць">
          <option value="">Усі місяці</option>
          {data?.options.months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <select className="input input-sm" value={params.get('executor') ?? ''} onChange={(e) => setFilter('executor', e.target.value)} aria-label="Виконавець">
          <option value="">Усі виконавці</option>
          {meta.buyers.map((b) => <option key={b.email} value={b.email}>{b.fullName}</option>)}
          <option value="__none__">Не призначено</option>
        </select>
        <select className="input input-sm" value={params.get('status') ?? ''} onChange={(e) => setFilter('status', e.target.value)} aria-label="Статус">
          <option value="">Усі статуси</option>
          {Object.entries(ITEM_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input input-sm" value={params.get('locationId') ?? ''} onChange={(e) => setFilter('locationId', e.target.value)} aria-label="Локація">
          <option value="">Усі локації</option>
          {data?.options.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select className="input input-sm filter-product" value={params.get('productId') ?? ''} onChange={(e) => setFilter('productId', e.target.value)} aria-label="Товар">
          <option value="">Усі товари</option>
          {data?.options.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {hasFilters && (
          <button className="btn btn-subtle btn-sm" onClick={() => setParams({ categoryId }, { replace: true })}>Скинути фільтри</button>
        )}
        <span className="muted small filters-count">Рядків: {rows.length} · Кількість: {rows.reduce((s, r) => s + r.qty, 0)}</span>
      </div>

      <div className={`bulk-bar ${selected.size ? 'is-active' : ''}`}>
        <b>Вибрано: {selected.size}</b>
        <span className="bulk-group">
          <select className="input input-sm" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} disabled={!selected.size}>
            <option value="">Статус…</option>
            {Object.entries(ITEM_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="btn btn-default btn-sm" disabled={!selected.size || !bulkStatus || saving} onClick={() => patch(sel, { status: bulkStatus })}>Застосувати</button>
        </span>
        <span className="bulk-group">
          <input className="input input-sm" type="date" value={bulkDate} onChange={(e) => setBulkDate(e.target.value)} disabled={!selected.size} aria-label="Планова дата" />
          <button className="btn btn-default btn-sm" disabled={!selected.size || !bulkDate || saving} onClick={() => patch(sel, { plannedDate: bulkDate })}>Встановити дату</button>
        </span>
        <span className="bulk-group">
          <select className="input input-sm" value={bulkExec} onChange={(e) => setBulkExec(e.target.value)} disabled={!selected.size}>
            <option value="">Виконавець…</option>
            {meta.buyers.map((b) => <option key={b.email} value={b.email}>{b.fullName}</option>)}
          </select>
          <button className="btn btn-default btn-sm" disabled={!selected.size || !bulkExec || saving} onClick={() => patch(sel, { executorEmail: bulkExec })}>Призначити</button>
        </span>
        {selected.size > 0 && <button className="btn btn-subtle btn-sm" onClick={() => setSelected(new Set())}>Зняти вибір</button>}
      </div>

      {!data ? <div className="page-loading">Завантаження…</div> : rows.length === 0 ? (
        <div className="empty">{hasFilters ? 'За обраними фільтрами позицій немає.' : 'Поки немає заявок у роботі. Візьміть заявку з «Вхідних заявок».'}</div>
      ) : (
        <div className="table-wrap summary-wrap">
          <table className="table table-compact summary">
            <thead>
              <tr>
                <th className="col-check"><input type="checkbox" checked={allSelected} onChange={(e) => toggleIds(rows.map((r) => r.id), e.target.checked)} aria-label="Вибрати всі" /></th>
                <th>ID заявки</th>
                <th>ПІБ замовника</th>
                <th>Місяць поставки</th>
                <th>Виконавець</th>
                <th>Планова дата</th>
                <th>Товар</th>
                <th>Од.</th>
                <th>Локація</th>
                <th className="num">К-сть</th>
                <th>Статус позиції</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const ids = g.rows.map((r) => r.id);
                const gAll = ids.every((id) => selected.has(id));
                return [
                  <tr key={`g-${g.month}`} className="group-row">
                    <td className="col-check"><input type="checkbox" checked={gAll} onChange={(e) => toggleIds(ids, e.target.checked)} aria-label={`Вибрати ${monthLabel(g.month)}`} /></td>
                    <td colSpan={10}>
                      <b>{monthLabel(g.month)}</b>
                      <span className="muted small"> · позицій: {g.rows.length} · заявок: {new Set(g.rows.map((r) => r.requestId)).size}</span>
                    </td>
                  </tr>,
                  ...g.rows.map((r, i) => {
                    const firstOfReq = i === 0 || g.rows[i - 1].requestId !== r.requestId;
                    return (
                      <tr key={r.id} className={`${selected.has(r.id) ? 'is-selected' : ''} ${firstOfReq ? 'req-start' : ''} status-${r.status}`}>
                        <td className="col-check"><input type="checkbox" checked={selected.has(r.id)} onChange={(e) => toggleIds([r.id], e.target.checked)} aria-label={`Вибрати позицію ${r.id}`} /></td>
                        <td><Link to={`/requests/${r.requestId}`}>№{r.requestId}</Link></td>
                        <td className="nowrap">{r.customerName}</td>
                        <td className="nowrap">{monthLabel(r.deliveryMonth)}</td>
                        <td>
                          <select className="input input-xs" value={r.executorEmail ?? ''} disabled={saving} aria-label={`Виконавець, позиція ${r.id}`}
                            onChange={(e) => patch([r.id], { executorEmail: e.target.value || null })}>
                            <option value="">—</option>
                            {meta.buyers.map((b) => <option key={b.email} value={b.email}>{b.fullName}</option>)}
                          </select>
                        </td>
                        <td>
                          <input className="input input-xs" type="date" value={r.plannedDate ?? ''} disabled={saving} aria-label={`Планова дата, позиція ${r.id}`}
                            onChange={(e) => patch([r.id], { plannedDate: e.target.value || null })} />
                        </td>
                        <td className="col-product">{r.productName}</td>
                        <td>{r.unit}</td>
                        <td className="nowrap">{r.locationName}</td>
                        <td className="num"><b>{r.qty}</b></td>
                        <td>
                          <select className={`input input-xs status-select st-${r.status}`} value={r.status} disabled={saving} aria-label={`Статус, позиція ${r.id}`}
                            onChange={(e) => patch([r.id], { status: e.target.value })}>
                            {Object.entries(ITEM_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        </td>
                      </tr>
                    );
                  }),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
