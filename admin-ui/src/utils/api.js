export function getAuthHeaders() {
  const token = localStorage.getItem('sso_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function authFetch(url, options = {}) {
  const headers = { ...getAuthHeaders(), ...(options.headers || {}) };
  const res = await fetch(url, { ...options, headers, credentials: 'include' });
  if (res.status === 401 || res.status === 403) {
    window.location.href = '/ui/sso';
    return null;
  }
  return res;
}

export const safeArr = (v) => (Array.isArray(v) ? v : []);
