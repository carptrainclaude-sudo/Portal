import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type TransportRow } from '../api';
import { useApp, usePersisted } from '../context';
import { TransportStatusBadge, UnreadDot, fmtDateTime } from './ui';
import { TRANSPORT_ALL, TransportFilters, filterTransport, type TransportFilter } from './Filters';
import { formatLocalDateTime } from '../../shared/constants';

/** Список заявок замовника на перевезення (з фільтрами, що зберігаються між сторінками). */
export default function CustomerTransportList() {
  const { refreshCounters } = useApp();
  const nav = useNavigate();
  const [rows, setRows] = useState<TransportRow[] | null>(null);
  const [f, setF] = usePersisted<TransportFilter>('customer-transport', TRANSPORT_ALL);
  const load = useCallback(() => { api.get<TransportRow[]>('/api/transport/my').then(setRows); refreshCounters(); }, [refreshCounters]);
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const shown = filterTransport(rows ?? [], f);
  return (
    <div className="stack">
      <TransportFilters value={f} onChange={setF} count={`Заявок: ${shown.length}`} />
      {!rows ? <div className="page-loading">Завантаження…</div> : !rows.length ? (
        <div className="empty">Заявок на перевезення ще немає. <Link to="/transport/new">Замовити транспорт</Link></div>
      ) : !shown.length ? <div className="empty">За обраними фільтрами заявок немає</div> : (
        <div className="table-wrap">
          <table className="table table-hover">
            <thead>
              <tr><th>№</th><th>Створено</th><th>Маршрут</th><th>Бажане завантаження</th><th>Статус</th><th>Виконано</th><th>Авто / водій</th></tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className={`clickable ${r.unread?.length ? 'row-unread' : ''}`} onClick={() => nav(`/transport/${r.id}`)}>
                  <td className="nowrap"><UnreadDot texts={r.unread} /><Link to={`/transport/${r.id}`} onClick={(e) => e.stopPropagation()}><b>№{r.id}</b></Link></td>
                  <td className="nowrap">{fmtDateTime(r.createdAt)}</td>
                  <td className="route"><span>{r.loadAddress}</span><span className="route-arrow">→</span><span>{r.unloadAddress}</span></td>
                  <td className="nowrap">{formatLocalDateTime(r.loadAt)}</td>
                  <td>
                    <TransportStatusBadge status={r.status} />
                    {r.unread?.length ? <div className="small unread-text">{r.unread[r.unread.length - 1]}</div> : null}
                  </td>
                  <td className="nowrap">{r.completedAt ? fmtDateTime(r.completedAt) : <span className="muted">—</span>}</td>
                  <td>{r.carNumber ? <><b className="car-plate">{r.carNumber}</b><div className="small">{r.driverName}</div></> : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
