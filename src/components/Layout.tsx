import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useApp } from '../context';
import { api, type Role } from '../api';
import { Icon } from './ui';

type DemoUser = { email: string; role: Role; fullName?: string };

export const ROLE_LABEL: Record<Role, string> = { customer: 'Замовник', buyer: 'Закупівельник', dispatcher: 'Диспетчер' };
export const homeFor = (role: Role) => (role === 'buyer' ? '/inbox' : role === 'dispatcher' ? '/dispatch' : '/catalog');
const avatarClass = (role: Role) => (role === 'buyer' ? 'avatar-buyer' : role === 'dispatcher' ? 'avatar-dispatcher' : '');

function UserSwitcher() {
  const { user, login, logout, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<DemoUser[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const nav = useNavigate();

  useEffect(() => {
    api.get<DemoUser[]>('/api/auth/demo-users').then(setUsers).catch(() => {});
  }, []);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  if (!user) return null;

  const switchTo = async (email: string) => {
    setOpen(false);
    const u = await login(email);
    toast(`Ви увійшли як ${u.email} (${ROLE_LABEL[u.role].toLowerCase()})`, 'info');
    nav(homeFor(u.role));
  };

  return (
    <div className="user-switcher" ref={ref}>
      <button className="user-btn" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-label={`Користувач ${user.email} — перемкнути`}>
        <span className={`avatar ${avatarClass(user.role)}`}>{user.email[0].toUpperCase()}</span>
        <span className="user-btn-text">
          <span className="user-email">{user.email}</span>
          <span className="user-role">{ROLE_LABEL[user.role]}</span>
        </span>
        <Icon name="chevron" size={14} />
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-title">Швидке перемикання (демо)</div>
          {users.map((u) => (
            <button key={u.email} className={`menu-item ${u.email === user.email ? 'is-active' : ''}`} onClick={() => switchTo(u.email)} role="menuitem" aria-label={`Увійти як ${u.email}`}>
              <span className={`avatar avatar-sm ${avatarClass(u.role)}`}>{u.email[0].toUpperCase()}</span>
              <span>
                <div>{u.email}</div>
                <div className="muted small">{ROLE_LABEL[u.role]}{u.fullName ? ` · ${u.fullName}` : ''}</div>
              </span>
            </button>
          ))}
          <div className="menu-sep" />
          <button className="menu-item" onClick={async () => { await logout(); nav('/login'); }} role="menuitem">
            <Icon name="logout" /> Вийти
          </button>
        </div>
      )}
    </div>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, counters, meta } = useApp();
  const badge = (n: number | undefined, label: string) =>
    n ? <span className="counter" aria-label={`${n} ${label}`}>{n}</span> : null;
  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <span className="brand-logo"><Icon name="cart" size={18} /></span>
          <span>Портал закупівель</span>
          <span className="env-badge">ТЕСТ</span>
        </NavLink>
        <div className="topbar-right">
          {meta?.mailpitUrl && (
            <a className="btn btn-subtle" href={meta.mailpitUrl} target="_blank" rel="noreferrer" title="Тестова поштова скринька (Mailpit)">
              <Icon name="mail" /> <span className="hide-sm">Mailpit</span>
            </a>
          )}
          <UserSwitcher />
        </div>
      </header>
      <div className="body">
        <nav className="sidebar" aria-label="Головне меню">
          <div className="sidebar-section">{user ? ROLE_LABEL[user.role] : ''}</div>
          <NavLink to="/catalog" className="nav-item" end><Icon name="catalog" /> Каталог сервісів</NavLink>
          {user?.role === 'customer' && (
            <NavLink to="/my-requests" className="nav-item">
              <Icon name="list" /> Мої заявки {badge(counters.unread?.total, 'непрочитаних оновлень')}
            </NavLink>
          )}
          {user?.role === 'buyer' && (
            <>
              <NavLink to="/inbox" className="nav-item"><Icon name="inbox" /> Вхідні заявки {badge(counters.inbox, 'нових')}</NavLink>
              <NavLink to="/summary" className="nav-item"><Icon name="table" /> Зведена потреба</NavLink>
            </>
          )}
          {user?.role === 'dispatcher' && (
            <NavLink to="/dispatch" className="nav-item"><Icon name="truck" /> Вхідні перевезення {badge(counters.transportNew, 'нових')}</NavLink>
          )}
        </nav>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
