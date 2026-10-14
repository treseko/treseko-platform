import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { chromium } from 'playwright';
import { assertPublicWebUrl, openMcpBrowserSession } from './mcp-browser-sessions.ts';

test('MCP browser rejects loopback, RFC1918, link-local and metadata addresses', async () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.20.1.2', '192.168.1.2', '169.254.169.254', '[::1]', '[fd00::1]', '[fe80::1]', '[::ffff:7f00:1]', '[::ffff:10.1.2.3]', '[2002:7f00:1::1]', '[2001:db8::1]']) {
    await assert.rejects(assertPublicWebUrl(`http://${address}/`), /público|pública/);
  }
});

test('MCP browser allows a global IPv6 address', async () => {
  assert.equal((await assertPublicWebUrl('https://[2606:4700:4700::1111]/')).hostname, '[2606:4700:4700::1111]');
});

test('MCP browser rejects local names, unsupported schemes and embedded credentials', async () => {
  for (const url of ['http://localhost/', 'http://qa.local/', 'http://qa.internal/', 'file:///etc/passwd', 'javascript:alert(1)', 'https://user:pass@example.org/']) {
    await assert.rejects(assertPublicWebUrl(url));
  }
});

test('failed page navigation closes and removes its reserved browser session', async (context) => {
  let launches = 0;
  let browserCloses = 0;
  const page = { goto: async () => { throw new Error('synthetic navigation failure'); } };
  const browserContext = {
    addInitScript: async () => {}, newPage: async () => page, route: async () => {},
    routeWebSocket: async () => {}, close: async () => {},
  };
  const browser = { newContext: async () => browserContext, close: async () => { browserCloses += 1; } };
  const launch = mock.method(chromium, 'launch', async () => { launches += 1; return browser as never; });
  context.after(() => launch.mock.restore());

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(
      openMcpBrowserSession('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'https://[2606:4700:4700::1111]/'),
      /synthetic navigation failure/,
    );
  }
  assert.equal(launches, 5, 'a failed open must not consume the per-owner session limit');
  assert.equal(browserCloses, 5, 'every failed browser must be closed');
});
