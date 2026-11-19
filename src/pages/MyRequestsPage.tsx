import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type PurchaseRow } from '../api';
import { useApp, usePersisted } from '../context';
import { Icon, Modal, NewLinesBadge, PageHeader, RequestStatus, UnreadDot, fmtDateTime } from '../components/ui';
import { PURCHASE_ALL, PurchaseFilters, filterPurchases, type PurchaseFilter } from '../components/Filters';
import CustomerTransportList from '../components/TransportList';
import { monthLabel } from '../../shared/constants';

/** Скасування заявки на закупівлю з підтвердженням у вікні порталу. */
export function useCancel(onDone: () => void) {
  const { toast } = useApp();
  return async (id: number) => {
    if (!confirm(`Скасувати заявку №${id}? Цю дію не можна відмінити.`)) return;
    try {
      await api.post(`/api/requests/${id}/cancel`);
      toast(`Заявку №${id} скасовано`);
      onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
}

export default function MyRequestsPage() {
  const { counters } = useApp();
  const [tab, setTab] = usePersisted<{ v: 'purchase' | 'transport' }>('my-tab', { v: 'purchase' });
  const u = counters.unread;
  return (
    <>
      <PageHeader
        title="Мої заявки"
        actions={tab.v === 'purchase'
          ? <Link className="btn btn-primary" to="/catalog/purchase"><Icon name="plus" /> Новий запит на закупівлю</Link>
          : <Link className="btn btn-primary" to="/transport/new"><Icon name="truck" /> Замовити транспорт</Link>}
      />
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab.v === 'purchase'} className={`tab ${tab.v === 'purchase' ? 'is-active' : ''}`} onClick={() => setTab({ v: 'purchase' })}>
          Закупівлі {u?.purchase ? <span className="counter counter-inline">{u.purchase}</span> : null}
        </button>
        <button role="tab" aria-selected={tab.v === 'transport'} className={`tab ${tab.v === 'transport' ? 'is-active' : ''}`} onClick={() => setTab({ v: 'transport' })}>
          Перевезення {u?.transport ? <span className="counter counter-inline">{u.transport}</span> : null}
        </button>
      </div>
      {tab.v === 'purchase' ? <PurchaseList /> : <CustomerTransportList />}
    </>
  );
}

function PurchaseList() {
  const { refreshCounters } = useApp();
  const [rows, setRows] = useState<PurchaseRow[] | null>(null);
  const [f, setF] = usePersisted<PurchaseFilter>('customer-purchase', PURCHASE_ALL);
  const [cancelId, setCancelId] = useState<number | null>(null);
  const nav = useNavigate();
  const load = useCallback(() => { api.get<PurchaseRow[]>('/api/requests/my').then(setRows); refreshCounters(); }, [refreshCounters]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const months = useMemo(() => [...new Set((rows ?? []).map((r) => r.deliveryMonth))].sort().map((v) => ({ value: v, label: monthLabel(v) })), [rows]);
  const shown = filterPurchases(rows ?? [], f);

  return (
    <div className="stack">
      <PurchaseFilters value={f} onChange={setF} months={months} initial={PURCHASE_ALL} count={`Заявок: ${shown.length}`} />
      {!rows ? <div className="page-loading">Завантаження…</div> : !rows.length ? (
        <div className="empty">Заявок немає. <Link to="/catalog/purchase">Створити запит на закупівлю</Link></div>
      ) : !shown.length ? <div className="empty">За обраними фільтрами заявок немає</div> : (
        <div className="table-wrap">
          <table className="table table-hover">
            <thead>
              <tr><th style={{ width: 90 }}>ID</th><th>Дата створення</th><th>Місяць поставки</th><th>Статус</th><th>Товарів</th><th>Виконання позицій</th><th style={{ width: 200 }} /></tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const editable = r.status === 'NEW' || r.status === 'REWORK';
                const taken = r.status === 'IN_PROGRESS' || r.status === 'DONE';
                return (
                  <tr key={r.id} onClick={() => nav(`/requests/${r.id}`)} className={`clickable ${r.unread?.length ? 'row-unread' : ''}`}>
                    <td className="nowrap"><UnreadDot texts={r.unread} /><Link to={`/requests/${r.id}`} onClick={(e) => e.stopPropagation()}><b>№{r.id}</b></Link></td>
                    <td>{fmtDateTime(r.createdAt)}</td>
                    <td>{monthLabel(r.deliveryMonth)}</td>
                    <td>
                      <RequestStatus status={r.status} />
                      {r.unread?.length ? <div className="small unread-text">{r.unread[r.unread.length - 1]}</div> : null}
                      {r.status === 'REWORK' && r.reworkComment && <div className="row-comment" title={r.reworkComment}>💬 {r.reworkComment}</div>}
                    </td>
                    <td>
                      {r.productCount}
                      <div><NewLinesBadge count={r.newCount} /></div>
                      {r.removedCount ? <div className="small muted">видалено: {r.removedCount}</div> : null}
                    </td>
                    <td>
                      {taken && r.itemCount ? (
                        <div className="progress-cell">
                          <div className="progress" title={`Виконано ${r.doneCount}, в дорозі ${r.transitCount}, всього ${r.itemCount}`}>
                            <span className="progress-done" style={{ width: `${(r.doneCount / r.itemCount) * 100}%` }} />
                            <span className="progress-transit" style={{ width: `${(r.transitCount / r.itemCount) * 100}%` }} />
                          </div>
                          <span className="small muted">{r.doneCount}/{r.itemCount}</span>
                        </div>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td className="row-actions" onClick={(e) => e.stopPropagation()}>
                      {editable ? (<>
                        <Link className="btn btn-default btn-sm" to={`/requests/${r.id}/edit`}><Icon name="edit" size={14} /> Редагувати</Link>
                        <button className="btn btn-subtle btn-sm btn-danger-text" onClick={() => setCancelId(r.id)}>Скасувати</button>
                      </>) : <Link className="btn btn-subtle btn-sm" to={`/requests/${r.id}`}>Переглянути</Link>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {cancelId !== null && <CancelPurchase id={cancelId} onClose={() => setCancelId(null)} onDone={load} />}
    </div>
  );
}

function CancelPurchase({ id, onClose, onDone }: { id: number; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const go = async () => {
    try {
      await api.post(`/api/requests/${id}/cancel`);
      toast(`Заявку №${id} скасовано`);
      onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
    onClose();
  };
  return (
    <Modal title={`Скасувати заявку №${id}?`} onClose={onClose} footer={<>
      <button className="btn btn-subtle" onClick={onClose}>Ні</button>
      <button className="btn btn-danger" onClick={go}>Так, скасувати</button>
    </>}>
      <p>Скасовану заявку не можна відновити.</p>
    </Modal>
  );
}
