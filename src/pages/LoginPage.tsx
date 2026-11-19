import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../context';
import { api, type Role } from '../api';
import { Icon } from '../components/ui';
import { ROLE_LABEL, homeFor } from '../components/Layout';

type DemoUser = { email: string; role: Role; fullName?: string };

export default function LoginPage() {
  const { user, login, loading } = useApp();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [params] = useSearchParams();
  const nav = useNavigate();

  useEffect(() => {
    api.get<DemoUser[]>('/api/auth/demo-users').then(setUsers).catch(() => {});
  }, []);

  if (!loading && user) return <Navigate to={params.get('next') || '/'} replace />;

  const doLogin = async (e: string) => {
    setError('');
    try {
      const u = await login(e);
      nav(params.get('next') || homeFor(u.role), { replace: true });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand login-brand">
          <span className="brand-logo"><Icon name="cart" size={20} /></span>
          <span>Портал закупівель</span>
        </div>
        <h1>Вхід</h1>
        <p className="muted">Тестове середовище: вхід лише за email, без пароля. Роль визначається автоматично.</p>
        <form onSubmit={(e) => { e.preventDefault(); doLogin(email); }}>
          <label className="field">
            <span className="label">Email</span>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.ua" autoFocus required />
          </label>
          {error && <div className="field-error">{error}</div>}
          <button className="btn btn-primary btn-block" type="submit">Увійти</button>
        </form>
        <div className="login-demo">
          <div className="label">Швидкий вхід (демо)</div>
          <div className="demo-grid">
            {users.map((u) => (
              <button key={u.email} className="demo-user" onClick={() => doLogin(u.email)}>
                <span className={`avatar avatar-sm ${u.role === 'buyer' ? 'avatar-buyer' : u.role === 'dispatcher' ? 'avatar-dispatcher' : ''}`}>{u.email[0].toUpperCase()}</span>
                <span>
                  <div>{u.email}</div>
                  <div className="muted small">{ROLE_LABEL[u.role]}{u.fullName ? ` · ${u.fullName}` : ''}</div>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
