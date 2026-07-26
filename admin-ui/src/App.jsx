import React, { useState, useEffect } from 'react';
import SsoPage from './pages/SsoPage';
import AdminPage from './pages/AdminPage';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pathname, setPathname] = useState(window.location.pathname);

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const token = localStorage.getItem('sso_token');
        const res = await fetch('/sso/session', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        } else {
          setUser(null);
        }
      } catch (e) {
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    checkSession();
  }, []);

  const handleLogout = async () => {
    try {
      const token = localStorage.getItem('sso_token');
      await fetch('/sso/logout', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
    } catch (e) {}
    localStorage.removeItem('sso_token');
    setUser(null);
    window.location.href = '/ui/sso';
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#090d16', color: '#6366f1' }}>
        <h2>⏳ Ứng dụng đang khởi tạo...</h2>
      </div>
    );
  }

  const isAdminRoute = pathname.includes('/admin') || window.location.hash.includes('analytics') || window.location.hash.includes('plans');

  if (isAdminRoute && user?.role === 'admin') {
    return <AdminPage user={user} onLogout={handleLogout} />;
  }

  return <SsoPage onLoginSuccess={(u) => { setUser(u); if (u.role === 'admin') window.location.href = '/ui/admin'; }} />;
}
