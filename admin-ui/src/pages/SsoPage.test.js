import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = resolve(projectRoot, '..');

test('authenticated dashboard destinations and contact link use exact vunph.id.vn routes', async () => {
  const vite = await createServer({
    root: projectRoot,
    configFile: resolve(projectRoot, 'vite.config.js'),
    server: { middlewareMode: true },
    appType: 'custom',
  });

  const originalWindow = globalThis.window;
  globalThis.window = {
    location: { search: '', pathname: '/ui/sso', href: 'https://sso.vunph.click/ui/sso' },
    history: { replaceState() {} },
  };

  try {
    const { default: SsoPage } = await vite.ssrLoadModule('/src/pages/SsoPage.jsx');
    const { APP_DESTINATIONS, SUPPORT_CONTACT_URL } = await vite.ssrLoadModule(
      '/src/config/destinations.js',
    );

    // 1. Verify app destinations mapping matches the user-approved topology
    assert.deepEqual(APP_DESTINATIONS, {
      iching: 'https://vunph.id.vn/kinhdich/',
      tarot: 'https://vunph.id.vn/tarot/',
      tuvi: 'https://vunph.id.vn/tuvi/',
      talk: 'https://vunph.id.vn/talk/',
      note: 'https://vunph.id.vn/note/',
    });

    assert.equal(SUPPORT_CONTACT_URL, 'https://vunph.id.vn/talk/');

    for (const [key, url] of Object.entries(APP_DESTINATIONS)) {
      const parsed = new URL(url);
      assert.equal(
        parsed.origin,
        'https://vunph.id.vn',
        `App destination ${key} must point to https://vunph.id.vn`,
      );
      assert.doesNotMatch(
        url,
        /vunph\.click/,
        `App destination ${key} must not point to vunph.click`,
      );
    }

    // 2. Verify authenticated dashboard renders app destinations and support contact
    const htmlAuthenticated = renderToStaticMarkup(
      React.createElement(SsoPage, {
        user: {
          id: 'user-test-1',
          email: 'member@example.com',
          displayName: 'Test Member',
          role: 'user',
          isVerified: true,
        },
      }),
    );

    assert.match(htmlAuthenticated, /Đến IChingNow/);
    assert.match(htmlAuthenticated, /Đến TarotNow/);
    assert.match(htmlAuthenticated, /Đến TuViNow/);
    assert.match(htmlAuthenticated, /Đến TalkWithMe \(Liên hệ\)/);
    assert.match(htmlAuthenticated, /Đến NoteNow \(Ghi chú\)/);
    assert.match(htmlAuthenticated, /href="https:\/\/vunph\.id\.vn\/talk\/"/);
    assert.doesNotMatch(htmlAuthenticated, /href="https:\/\/vunph\.click\/talk\/"/);
    assert.doesNotMatch(htmlAuthenticated, /vunph\.click\/(kinhdich|tarot|tuvi|note)/);

    // Verify SSO identity and copyright remain on vunph.click
    assert.match(htmlAuthenticated, /© 2026 vunph\.click/);
    assert.match(htmlAuthenticated, /Hồ Sơ Của Tôi/);

    // 3. Verify unauthenticated login/register page renders contact link pointing to vunph.id.vn
    const htmlUnauthenticated = renderToStaticMarkup(
      React.createElement(SsoPage, { user: null }),
    );

    assert.match(htmlUnauthenticated, /href="https:\/\/vunph\.id\.vn\/talk\/"/);
    assert.doesNotMatch(htmlUnauthenticated, /href="https:\/\/vunph\.click\/talk\/"/);
    assert.match(htmlUnauthenticated, /href="\/sso\/oauth\/google/);
    assert.match(htmlUnauthenticated, /href="\/sso\/oauth\/facebook/);

    // 4. Verify standalone register page HTML contact link points to vunph.id.vn
    const registerHtmlPath = resolve(repoRoot, 'src/sso/register-page.html');
    const registerHtml = fs.readFileSync(registerHtmlPath, 'utf8');
    assert.match(registerHtml, /href="https:\/\/vunph\.id\.vn\/talk\/"/);
    assert.doesNotMatch(registerHtml, /href="https:\/\/vunph\.click\/talk\/"/);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    await vite.close();
  }
});
