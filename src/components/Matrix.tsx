import { ITEM_STATUS } from '../../shared/constants';

export type MatrixRow = {
  key: string | number;
  name: string;
  unit: string;
  userAdded?: boolean;
  /** Нова позиція (немає в довіднику) — рядок підсвічується червоним. */
  isNew?: boolean;
  newLabel?: string;
  cells: Record<number, { qty: number; status?: string }>;
};

/** Таблиця «товари × локації»: показуються лише локації з кількістю, перший стовпець закріплений. */
export default function Matrix({ rows, locations, showStatus = false }: {
  rows: MatrixRow[];
  locations: { id: number; name: string }[];
  showStatus?: boolean;
}) {
  const used = locations.filter((l) => rows.some((r) => r.cells[l.id]?.qty));
  const colTotal = (id: number) => rows.reduce((s, r) => s + (r.cells[id]?.qty ?? 0), 0);
  const rowTotal = (r: MatrixRow) => Object.values(r.cells).reduce((s, c) => s + c.qty, 0);
  const grand = rows.reduce((s, r) => s + rowTotal(r), 0);

  return (
    <div className="matrix-wrap">
      <div className="matrix-scroll">
        <table className="matrix">
          <thead>
            <tr>
              <th className="sticky-col">Товар</th>
              {used.map((l) => <th key={l.id} className="num">{l.name}</th>)}
              <th className="num total-col">Разом</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={r.isNew ? 'row-new' : ''}>
                <td className="sticky-col">
                  <div className="matrix-product">{r.name}</div>
                  <div className="muted small">
                    {r.unit}
                    {r.isNew && <span className="lozenge lozenge-red lozenge-xs">{r.newLabel ?? 'Немає в довіднику'}</span>}
                    {!r.isNew && r.userAdded && <span className="lozenge lozenge-teal lozenge-xs">додано з заявки</span>}
                  </div>
                </td>
                {used.map((l) => {
                  const c = r.cells[l.id];
                  return (
                    <td key={l.id} className="num">
                      {c ? (
                        <span className={showStatus && c.status ? `cell-status cell-${c.status}` : ''}
                          title={showStatus && c.status ? ITEM_STATUS[c.status as keyof typeof ITEM_STATUS] : undefined}>
                          {c.qty}
                        </span>
                      ) : <span className="muted">—</span>}
                    </td>
                  );
                })}
                <td className="num total-col"><b>{rowTotal(r)}</b> <span className="muted small">{r.unit}</span></td>
              </tr>
            ))}
          </tbody>
          {rows.length > 1 && (
            <tfoot>
              <tr>
                <td className="sticky-col">Разом по локації</td>
                {used.map((l) => <td key={l.id} className="num">{colTotal(l.id)}</td>)}
                <td className="num total-col">{grand}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {showStatus && (
        <div className="legend">
          {Object.entries(ITEM_STATUS).map(([k, v]) => (
            <span key={k}><span className={`legend-dot cell-${k}`} /> {v}</span>
          ))}
        </div>
      )}
      <div className="muted small matrix-meta">Локацій у заявці: {used.length} · Товарів: {rows.length}</div>
    </div>
  );
}
