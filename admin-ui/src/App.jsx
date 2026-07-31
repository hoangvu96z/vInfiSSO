import React, { useState, useEffect } from 'react';
import SsoPage from './pages/SsoPage';
import AdminPage from './pages/AdminPage';
import ProfilePage from './pages/ProfilePage';

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
      // If user just logged out, skip session check entirely — prevents auto-login on reload
      const queryParams = new URLSearchParams(window.location.search);
      const isLoggedOut =
        queryParams.get('logged_out') === 'true' ||
        sessionStorage.getItem('just_logged_out') === '1';

      if (isLoggedOut) {
        sessionStorage.removeItem('just_logged_out');
        localStorage.removeItem('sso_token');
        // Clean up URL params without page reload
        if (queryParams.get('logged_out')) {
          queryParams.delete('logged_out');
          const newSearch = queryParams.toString();
          const newUrl = window.location.pathname + (newSearch ? '?' + newSearch : '') + window.location.hash;
          window.history.replaceState({}, '', newUrl);
        }
        setUser(null);
        setLoading(false);
        return;
      }

      try {
        const token = localStorage.getItem('sso_token');
        const res = await fetch('/sso/me', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          // Đồng bộ token từ server (cookie session) về localStorage
          // để các flow redirect kèm ?sso_token= luôn có token sẵn
          if (data.user && data.token) {
            localStorage.setItem('sso_token', data.token);
          }
          setUser(data.user);
        } else {
          localStorage.removeItem('sso_token');
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
    // Mark logout intent BEFORE any async call
    sessionStorage.setItem('just_logged_out', '1');
    localStorage.removeItem('sso_token');

    try {
      const token = localStorage.getItem('sso_token'); // already null, but keep for header
      await fetch('/sso/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (e) {}

    // DO NOT do window.location.href — just update React state directly
    // This avoids re-triggering checkSession with a potentially still-valid cookie
    setUser(null);
  };

  const handleLoginSuccess = (data) => {
    const loggedUser = data.user || data;
    setUser(loggedUser);
    if (loggedUser.role === 'admin') {
      window.location.href = '/ui/admin#analytics';
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#090d16', color: '#6366f1' }}>
        <h2>⏳ Ứng dụng đang khởi tạo...</h2>
      </div>
    );
  }

  const isAdminRoute = pathname.includes('/admin') || window.location.hash.includes('analytics') || window.location.hash.includes('users') || window.location.hash.includes('plans');
  const isProfileRoute = pathname.includes('/profile');

  if (isProfileRoute) {
    if (!user) {
      window.location.href = '/ui/sso';
      return null;
    }
    return (
      <ProfilePage
        user={user}
        onLogout={handleLogout}
        onUserUpdated={setUser}
      />
    );
  }

  if ((isAdminRoute || pathname === '/ui/admin') && user?.role === 'admin') {
    return <AdminPage user={user} onLogout={handleLogout} />;
  }

  return <SsoPage user={user} onLoginSuccess={handleLoginSuccess} onLogout={handleLogout} />;
}
