import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type PurchaseRow } from '../api';
import { useApp, usePersisted } from '../context';
import { NewLinesBadge, PageHeader, RequestStatus, fmtDateTime } from '../components/ui';
import { PurchaseFilters, filterPurchases, type PurchaseFilter, PURCHASE_ALL } from '../components/Filters';
import { REQUEST_TYPE, monthLabel } from '../../shared/constants';

const INBOX_DEFAULT: PurchaseFilter = { ...PURCHASE_ALL, status: 'NEW' };

export default function InboxPage() {
  const { refreshCounters } = useApp();
  const [rows, setRows] = useState<PurchaseRow[] | null>(null);
  const [f, setF] = usePersisted<PurchaseFilter>('buyer-inbox', INBOX_DEFAULT);
  const load = useCallback(() => {
    api.get<PurchaseRow[]>('/api/buyer/requests').then(setRows);
    refreshCounters();
  }, [refreshCounters]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const months = useMemo(() => [...new Set((rows ?? []).map((r) => r.deliveryMonth))].sort().map((v) => ({ value: v, label: monthLabel(v) })), [rows]);
  const shown = filterPurchases(rows ?? [], f);

  return (
    <>
      <PageHeader title="Вхідні заявки">
        <p className="muted">За замовчуванням — заявки у статусі «Нова», нові зверху. Заявки з товарами, яких немає в довіднику, позначені «Є нові позиції».</p>
      </PageHeader>
      <PurchaseFilters value={f} onChange={setF} months={months} initial={INBOX_DEFAULT} count={`Заявок: ${shown.length}`} />
      {!rows ? <div className="page-loading">Завантаження…</div> : shown.length === 0 ? (
        <div className="empty">{f.status === 'NEW' && !f.q && !f.month && !f.hasNew ? 'Нових заявок немає 🎉' : 'За обраними фільтрами заявок немає'}</div>
      ) : (
        <div className="queue">
          {shown.map((r) => (
            <Link key={r.id} to={`/requests/${r.id}`} className={`queue-row ${r.newCount ? 'has-new' : ''}`}>
              <span className="queue-id">№{r.id}</span>
              <span className="queue-main">
                <span className="queue-line">
                  <span className="lozenge lozenge-blue">{REQUEST_TYPE[r.type as keyof typeof REQUEST_TYPE]}</span>
                  <span className="dot-sep">·</span><b>{r.lastName}</b>
                  <span className="dot-sep">·</span>{r.category}
                  <span className="dot-sep">·</span>{monthLabel(r.deliveryMonth)}
                  <NewLinesBadge count={r.newCount} />
                </span>
                <span className="muted small">
                  {r.lastName} {r.firstName} · товарів: {r.productCount}{r.removedCount ? ` · видалено: ${r.removedCount}` : ''} · надійшла {fmtDateTime(r.submittedAt)}
                  {r.assigneeName ? ` · виконавець: ${r.assigneeName}` : ''}
                </span>
              </span>
              {r.status !== 'NEW' && <RequestStatus status={r.status} />}
              <span className="btn btn-default btn-sm">Відкрити</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
