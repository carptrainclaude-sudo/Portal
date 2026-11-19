import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type TransportRow } from '../api';
import { useApp, usePersisted } from '../context';
import { PageHeader, TransportStatusBadge } from '../components/ui';
import { DISPATCH_ALL, DispatchFilters, filterDispatch, type DispatchFilter } from '../components/Filters';
import { formatLocalDateTime } from '../../shared/constants';

export default function DispatchPage() {
  const { user, refreshCounters } = useApp();
  const nav = useNavigate();
  const [rows, setRows] = useState<TransportRow[] | null>(null);
  const [f, setF] = usePersisted<DispatchFilter>('dispatch', DISPATCH_ALL);
  const load = useCallback(() => { api.get<TransportRow[]>('/api/transport/all').then(setRows); refreshCounters(); }, [refreshCounters]);
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const shown = filterDispatch(rows ?? [], f, user?.email ?? '');
  const newCount = (rows ?? []).filter((r) => r.status === 'NEW').length;

  return (
    <>
      <PageHeader title="Вхідні перевезення">
        <p className="muted">Усі заявки на перевезення: нові — зверху й підсвічені{newCount ? ` (${newCount})` : ''}, далі — за датою завантаження.</p>
      </PageHeader>
      <div className="stack">
        <DispatchFilters value={f} onChange={setF} count={`Заявок: ${shown.length}`} />
        {!rows ? <div className="page-loading">Завантаження…</div> : !shown.length ? <div className="empty">Заявок за обраними фільтрами немає</div> : (
          <div className="table-wrap">
            <table className="table table-hover">
              <thead>
                <tr><th>№</th><th>Замовник</th><th>Маршрут</th><th>Бажане завантаження</th><th>Печатка</th><th>Статус</th><th>Диспетчер</th></tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className={`clickable ${r.status === 'NEW' ? 'row-highlight' : ''}`} onClick={() => nav(`/transport/${r.id}`)}>
                    <td><Link to={`/transport/${r.id}`} onClick={(e) => e.stopPropagation()}><b>№{r.id}</b></Link></td>
                    <td className="nowrap">{r.fullName}</td>
                    <td className="route"><span>{r.loadAddress}</span><span className="route-arrow">→</span><span>{r.unloadAddress}</span>
                      {r.carNumber && <div className="small muted">Авто <b className="car-plate">{r.carNumber}</b> · {r.driverName}</div>}</td>
                    <td className="nowrap">{formatLocalDateTime(r.loadAt)}</td>
                    <td>{r.sealRequired ? <span className="lozenge lozenge-orange">Так</span> : <span className="muted">Ні</span>}</td>
                    <td><TransportStatusBadge status={r.status} /></td>
                    <td className="nowrap">{r.dispatcherName ?? <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
