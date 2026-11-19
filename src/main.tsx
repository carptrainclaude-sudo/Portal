import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './styles.css';
import { AppProvider, useApp } from './context';
import type { Role } from './api';
import Layout, { homeFor } from './components/Layout';
import LoginPage from './pages/LoginPage';
import CatalogPage from './pages/CatalogPage';
import RequestFormPage from './pages/RequestFormPage';
import MyRequestsPage from './pages/MyRequestsPage';
import RequestPage from './pages/RequestPage';
import InboxPage from './pages/InboxPage';
import SummaryPage from './pages/SummaryPage';
import TransportHomePage from './pages/TransportHomePage';
import TransportFormPage from './pages/TransportFormPage';
import TransportPage from './pages/TransportPage';
import DispatchPage from './pages/DispatchPage';

function Protected({ role, children }: { role?: Role | Role[]; children: React.ReactNode }) {
  const { user, loading, meta } = useApp();
  if (loading || (user && !meta)) return <div className="page-loading">Завантаження…</div>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  const roles = role ? (Array.isArray(role) ? role : [role]) : null;
  if (roles && !roles.includes(user.role)) {
    return <Layout><div className="empty">Ця сторінка недоступна для вашої ролі. Перемкніть користувача у правому верхньому куті.</div></Layout>;
  }
  return <Layout>{children}</Layout>;
}

function Home() {
  const { user, loading } = useApp();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={homeFor(user.role)} replace />;
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/catalog" element={<Protected><CatalogPage /></Protected>} />
      <Route path="/catalog/purchase" element={<Protected role="customer"><RequestFormPage /></Protected>} />
      <Route path="/catalog/transport" element={<Protected role="customer"><TransportHomePage /></Protected>} />
      <Route path="/requests/:id/edit" element={<Protected role="customer"><RequestFormPage /></Protected>} />
      <Route path="/my-requests" element={<Protected role="customer"><MyRequestsPage /></Protected>} />
      <Route path="/requests/:id" element={<Protected role={['customer', 'buyer']}><RequestPage /></Protected>} />
      <Route path="/inbox" element={<Protected role="buyer"><InboxPage /></Protected>} />
      <Route path="/summary" element={<Protected role="buyer"><SummaryPage /></Protected>} />
      <Route path="/transport/new" element={<Protected role="customer"><TransportFormPage /></Protected>} />
      <Route path="/transport/:id/edit" element={<Protected role="customer"><TransportFormPage /></Protected>} />
      <Route path="/transport/:id" element={<Protected role={['customer', 'dispatcher']}><TransportPage /></Protected>} />
      <Route path="/dispatch" element={<Protected role="dispatcher"><DispatchPage /></Protected>} />
      <Route path="*" element={<Protected><div className="empty">Сторінку не знайдено</div></Protected>} />
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
