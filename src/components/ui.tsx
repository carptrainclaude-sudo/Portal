import { useEffect, type ReactNode } from 'react';
import { ITEM_STATUS, REQUEST_STATUS, TRANSPORT_STATUS } from '../../shared/constants';

const ICONS: Record<string, ReactNode> = {
  catalog: <path d="M4 5h7v6H4zM13 5h7v6h-7zM4 13h7v6H4zM13 13h7v6h-7z" />,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  inbox: <path d="M4 13l2.5-7h11L20 13v5H4zM4 13h5l1 2h4l1-2h5" />,
  table: <path d="M4 5h16v14H4zM4 10h16M4 15h16M10 5v14" />,
  cart: <path d="M4 5h2l2 10h10l2-7H7.2M9 19.5h.01M17 19.5h.01" />,
  wrench: <path d="M14 6a4 4 0 0 0 5 5l-8 8-3-3 8-8a4 4 0 0 1-2-2zM14 6l3-3" />,
  laptop: <path d="M5 6h14v9H5zM3 18h18" />,
  truck: <path d="M3 7h11v8H3zM14 10h4l3 3v2h-7M7 18.5h.01M17 18.5h.01" />,
  mail: <path d="M4 6h16v12H4zM4 7l8 6 8-6" />,
  logout: <path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9" />,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />,
  search: <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  user: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c1.5-4 4.5-5 8-5s6.5 1 8 5" />,
  check: <path d="M5 12l5 5 9-10" />,
  back: <path d="M15 6l-6 6 6 6" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
};

export function Icon({ name, size = 18 }: { name: keyof typeof ICONS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

const REQ_TONE: Record<string, string> = {
  NEW: 'blue', IN_PROGRESS: 'purple', DONE: 'green', REWORK: 'yellow', CANCELLED: 'grey',
};
const ITEM_TONE: Record<string, string> = { IN_PROGRESS: 'purple', IN_TRANSIT: 'teal', DONE: 'green' };

export function RequestStatus({ status }: { status: string }) {
  return <span className={`lozenge lozenge-${REQ_TONE[status] ?? 'grey'}`}>{REQUEST_STATUS[status as keyof typeof REQUEST_STATUS] ?? status}</span>;
}
const TRANSPORT_TONE: Record<string, string> = {
  NEW: 'blue', IN_PROGRESS: 'purple', CAR_ASSIGNED: 'teal', LOADED: 'orange', DONE: 'green', REWORK: 'yellow', CANCELLED: 'grey',
};
export function TransportStatusBadge({ status }: { status: string }) {
  return <span className={`lozenge lozenge-${TRANSPORT_TONE[status] ?? 'grey'}`}>{TRANSPORT_STATUS[status as keyof typeof TRANSPORT_STATUS] ?? status}</span>;
}
export function NewLinesBadge({ count }: { count: number }) {
  if (!count) return null;
  return <span className="lozenge lozenge-red" title={`Нових позицій: ${count}`}>⚑ Є нові позиції ({count})</span>;
}
export function UnreadDot({ texts }: { texts?: string[] }) {
  if (!texts?.length) return null;
  return <span className="unread-dot" title={texts.join('\n')} aria-label={`Непрочитане оновлення: ${texts.join('; ')}`} />;
}

export function ItemStatus({ status }: { status: string }) {
  return <span className={`lozenge lozenge-${ITEM_TONE[status] ?? 'grey'}`}>{ITEM_STATUS[status as keyof typeof ITEM_STATUS] ?? status}</span>;
}

export function Modal({ title, onClose, children, footer, width = 520 }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="btn btn-subtle btn-icon" onClick={onClose} aria-label="Закрити"><Icon name="x" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('uk-UA');
export const fmtYmd = (d: string | null) => (d ? d.split('-').reverse().join('.') : '—');

export function PageHeader({ title, crumbs, actions, children }: { title: ReactNode; crumbs?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-header">
      {crumbs && <div className="crumbs">{crumbs}</div>}
      <div className="page-header-row">
        <h1>{title}</h1>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
