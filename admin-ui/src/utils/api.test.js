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
  let requestOptions;
  const restores = [
    replaceGlobal('window', { location: { href: '' } }),
    replaceGlobal('fetch', async (_url, options) => {
      requestOptions = options;
      return response;
    }),
  ];

  try {
    assert.equal(await authFetch('/admin/stats'), response);
    assert.equal(globalThis.window.location.href, '');
    assert.equal(requestOptions.credentials, 'include');
    assert.equal('Authorization' in requestOptions.headers, false);
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test('authFetch redirects to login and returns null for 401 responses', async () => {
  const restores = [
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
