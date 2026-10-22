import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('keeps the payment page in an explicit unavailable state without success claims', async () => {
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

    assert.match(html, /Thanh toán hiện chưa được hỗ trợ/);
    assert.match(html, /Chưa có quy trình tạo và xác nhận đơn thanh toán an toàn/);
    assert.doesNotMatch(html, /Thanh toán thành công|Đã thanh toán/i);
    assert.doesNotMatch(html, /Thanh toán ngay|Xác nhận thanh toán/i);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    await vite.close();
  }
});
