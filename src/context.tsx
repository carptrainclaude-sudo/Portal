import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type Counters, type Meta, type User } from './api';

type Toast = { id: number; kind: 'success' | 'error' | 'info'; text: string };

type Ctx = {
  user: User | null;
  meta: Meta | null;
  loading: boolean;
  login: (email: string) => Promise<User>;
  logout: () => Promise<void>;
  toast: (text: string, kind?: Toast['kind']) => void;
  counters: Counters;
  refreshCounters: () => void;
};

const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [counters, setCounters] = useState<Counters>({});

  const loadMeta = useCallback(async () => setMeta(await api.get<Meta>('/api/meta')), []);

  useEffect(() => {
    api.get<User | null>('/api/auth/me')
      .then(async (u) => {
        setUser(u);
        if (u) await loadMeta();
      })
      .finally(() => setLoading(false));
  }, [loadMeta]);

  const refreshCounters = useCallback(() => {
    if (!user) return;
    api.get<Counters>('/api/counters').then(setCounters).catch(() => {});
  }, [user]);

  useEffect(() => {
    setCounters({});
    refreshCounters();
    if (!user) return;
    const t = setInterval(refreshCounters, 10000);
    return () => clearInterval(t);
  }, [user, refreshCounters]);

  const login = async (email: string) => {
    const u = await api.post<User>('/api/auth/login', { email });
    setUser(u);
    await loadMeta();
    return u;
  };
  const logout = async () => {
    await api.post('/api/auth/logout');
    setUser(null);
  };
  const toast = useCallback((text: string, kind: Toast['kind'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 4000);
  }, []);

  return (
    <AppCtx.Provider value={{ user, meta, loading, login, logout, toast, counters, refreshCounters }}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
            {t.text}
          </div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}

/** Стан, що зберігається між переходами сторінок (sessionStorage) — для фільтрів. */
export function usePersisted<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem('pp:' + key);
      return raw ? { ...initial, ...JSON.parse(raw) } : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback((nv: T | ((p: T) => T)) => {
    setV((prev) => {
      const next = typeof nv === 'function' ? (nv as (p: T) => T)(prev) : nv;
      try { sessionStorage.setItem('pp:' + key, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [key]);
  return [v, set];
}
