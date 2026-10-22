import assert from 'node:assert/strict';
import test from 'node:test';
import { authFetch } from './api.js';

function replaceGlobal(name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });

  return () => {
    if (original) Object.defineProperty(globalThis, name, original);
    else delete globalThis[name];
  };
}

test('authFetch returns 403 responses without redirecting to the login page', async () => {
  const response = { status: 403 };
  const restores = [
    replaceGlobal('localStorage', { getItem: () => 'admin-token' }),
    replaceGlobal('window', { location: { href: '' } }),
    replaceGlobal('fetch', async () => response),
  ];

  try {
    assert.equal(await authFetch('/admin/stats'), response);
    assert.equal(globalThis.window.location.href, '');
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test('authFetch redirects to login and returns null for 401 responses', async () => {
  const restores = [
    replaceGlobal('localStorage', { getItem: () => null }),
    replaceGlobal('window', { location: { href: '' } }),
    replaceGlobal('fetch', async () => ({ status: 401 })),
  ];

  try {
    assert.equal(await authFetch('/admin/stats'), null);
    assert.equal(globalThis.window.location.href, '/ui/sso');
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});
