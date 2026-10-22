export function getAuthHeaders() {
  const token = localStorage.getItem('sso_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function authFetch(url, options = {}) {
  const headers = { ...getAuthHeaders(), ...(options.headers || {}) };
  const res = await fetch(url, { ...options, headers, credentials: 'include' });
  if (res.status === 401) {
    window.location.href = '/ui/sso';
    return null;
  }
  return res;
}

export async function getResponseErrorMessage(res, fallback) {
  try {
    const data = await res.clone().json();
    if (typeof data.message === 'string' && data.message.trim()) return data.message;
    if (Array.isArray(data.message) && data.message.length > 0) {
      return data.message.filter((item) => typeof item === 'string').join(', ') || `${fallback} (HTTP ${res.status})`;
    }
  } catch {
    // Fall back to the request-specific message when the response is not JSON.
  }
  return `${fallback} (HTTP ${res.status})`;
}

export const safeArr = (v) => (Array.isArray(v) ? v : []);
