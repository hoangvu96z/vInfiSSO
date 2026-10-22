import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('presents server-priced VietQR orders without claiming that an order is already paid', async () => {
  const vite = await createServer({
    root: projectRoot,
    configFile: resolve(projectRoot, 'vite.config.js'),
    server: { middlewareMode: true },
    appType: 'custom',
  });

  const originalWindow = globalThis.window;
  globalThis.window = {
    location: { search: '', href: 'https://sso.example/ui/payment' },
  };

  try {
    const { default: PaymentPage } = await vite.ssrLoadModule(
      '/src/pages/PaymentPage.jsx',
    );
    const html = renderToStaticMarkup(
      React.createElement(PaymentPage, { user: { id: 'test-user' } }),
    );

    assert.match(html, /Thanh toán VietQR/);
    assert.match(html, /Tạo đơn và mã VietQR/);
    assert.match(html, /Chưa có đơn thanh toán/);
    assert.doesNotMatch(html, /10\.000đ|20\.000đ/);
    assert.doesNotMatch(html, /Thanh toán thành công/);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    await vite.close();
  }
});
