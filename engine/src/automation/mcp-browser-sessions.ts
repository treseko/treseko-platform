import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import crypto from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

const SESSION_TTL_MS = 10 * 60_000;
const SESSION_MAX_AGE_MS = 30 * 60_000;
const MAX_SESSIONS = 32;
const MAX_SESSIONS_PER_OWNER = 4;
const MAX_TARGETS = 120;
const MAX_SNAPSHOT_CHARS = 24_000;
const sessions = new Map<string, BrowserSession>();

type BrowserSession = {
  id: string; owner: string; projectId: string; expiresAt: number;
  maxExpiresAt: number;
  browser: Browser; context: BrowserContext; page: Page; snapshotVersion: number;
};

function publicIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0)
    || (a === 198 && (b === 18 || b === 19)));
}

function publicAddress(ip: string): boolean {
  if (isIP(ip) === 4) return publicIpv4(ip);
  if (isIP(ip) !== 6) return false;
  const normalized = ip.toLowerCase().split('%')[0];
  const dottedTail = normalized.match(/(\d+\.\d+\.\d+\.\d+)$/);
  let address = normalized;
  if (dottedTail) {
    const octets = dottedTail[1].split('.').map(Number);
    if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const tail = `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
    address = address.slice(0, -dottedTail[1].length) + tail;
  }
  const halves = address.split('::');
  if (halves.length > 2) return false;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return false;
  const words = [...left, ...Array(missing).fill('0'), ...right].map((word) => Number.parseInt(word, 16));
  if (words.length !== 8 || words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffff)) return false;
  const first = words[0];
  // Only global unicast space is eligible; this excludes mapped IPv4, ULA,
  // link-local, unspecified, multicast, and other special-purpose ranges.
  if ((first & 0xe000) !== 0x2000) return false;
  if (first === 0x2002 || (first === 0x2001 && [0, 2, 0x10, 0x20, 0xdb8].includes(words[1]))) return false;
  return true;
}

export async function assertPublicWebUrl(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('URL inválida'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Solo se permiten URL HTTP/HTTPS públicas sin credenciales embebidas');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) throw new Error('El destino debe ser un host público');
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new Error('El destino resuelve a una red no pública');
  return url;
}

async function destroy(session: BrowserSession): Promise<void> {
  sessions.delete(session.id);
  try { await session.context.close(); } catch { /* already closed */ }
  try { await session.browser.close(); } catch { /* already closed */ }
}

async function getOwnedSession(id: string, owner: string, projectId: string): Promise<BrowserSession> {
  const session = sessions.get(id);
  if (!session || session.owner !== owner || session.projectId !== projectId) throw new Error('Sesión web no encontrada');
  if (session.expiresAt <= Date.now() || session.maxExpiresAt <= Date.now() || session.page.isClosed()) {
    await destroy(session);
    throw new Error('La sesión web expiró');
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

async function snapshot(session: BrowserSession) {
  const state = await session.page.evaluate((maxTargets) => {
    const clean = (value: string | null | undefined, max = 500) => (value || '').replace(/\s+/g, ' ').trim().slice(0, max);
    const accessibleName = (element: HTMLElement) => {
      const labelledBy = (element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
        .map((id) => document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || '').join(' ');
      const labels = element instanceof HTMLInputElement
        ? Array.from(element.labels || []).map((label) => label.innerText || label.textContent || '').join(' ')
        : '';
      const inputButton = element instanceof HTMLInputElement && ['button', 'submit', 'reset', 'image'].includes(element.type);
      const name = clean(labelledBy || element.getAttribute('aria-label') || labels || element.getAttribute('title')
        || element.getAttribute('placeholder') || (inputButton ? element.value : '') || (element as HTMLElement).innerText || element.textContent);
      if (name || !(element instanceof HTMLAnchorElement) || !element.href) return name;
      try { return `link to ${new URL(element.href).pathname || '/'}`; } catch { return 'link without accessible name'; }
    };
    const safeHref = (raw: string) => { let url: URL; try { url = new URL(raw || location.href, location.href); } catch { return ''; } for (const key of [...url.searchParams.keys()]) if (/(token|secret|password|auth|session|key)/i.test(key)) url.searchParams.set(key, '[redacted]'); if (/(token|secret|password|auth|session|key)=/i.test(url.hash)) url.hash = '#[redacted]'; return url.toString().slice(0, 2000); };
    const nodes = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="tab"],[role="option"],[contenteditable="true"]')).slice(0, maxTargets);
    const elements = nodes.map((node, index) => {
      const element = node as HTMLElement;
      const id = `t${index + 1}`;
      element.setAttribute('data-mcp-target', id);
      const input = element as HTMLInputElement;
      const inputButton = element instanceof HTMLInputElement && ['button', 'submit', 'reset', 'image'].includes(element.type);
      const inputRole = element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type) ? element.type : undefined;
      const role = element.getAttribute('role') || inputRole || (element.tagName === 'A' ? 'link' : element.tagName === 'BUTTON' || inputButton ? 'button' : element.tagName.toLowerCase());
      const context = element.closest('li,[role="listitem"],tr,fieldset') as HTMLElement | null;
      const ariaChecked = element.getAttribute('aria-checked');
      const checked = ['checkbox', 'radio'].includes(role)
        ? input instanceof HTMLInputElement && ['checkbox', 'radio'].includes(input.type)
          ? input.checked
          : ariaChecked === 'mixed' ? 'mixed' : ariaChecked === 'true' ? true : ariaChecked === 'false' ? false : undefined
        : undefined;
      return { target: id, role, name: accessibleName(element), context: context && context !== element ? clean(context.innerText || context.textContent, 300) : undefined, type: input.type || undefined, value: input.type === 'password' ? '[redacted]' : clean(input.value || '', 300), checked, options: element instanceof HTMLSelectElement ? Array.from(element.options).slice(0, 40).map((option) => ({ label: clean(option.label, 200), value: option.value, selected: option.selected, disabled: option.disabled })) : undefined, href: element instanceof HTMLAnchorElement ? safeHref(element.href) : undefined, disabled: Boolean((element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true') };
    }).filter((item) => item.name || ['input','textarea','select'].includes(item.role));
    const safeUrl = new URL(location.href);
    for (const key of [...safeUrl.searchParams.keys()]) if (/(token|secret|password|auth|session|key)/i.test(key)) safeUrl.searchParams.set(key, '[redacted]');
    if (/(token|secret|password|auth|session|key)=/i.test(safeUrl.hash)) safeUrl.hash = '#[redacted]';
    return { title: clean(document.title, 300), url: safeUrl.toString().slice(0, 2000), text: clean(document.body?.innerText || '', 12000), elements };
  }, MAX_TARGETS);
  session.snapshotVersion += 1;
  return { browser_id: session.id, snapshot_version: session.snapshotVersion, ...state, text: state.text.slice(0, MAX_SNAPSHOT_CHARS) };
}

export async function openMcpBrowserSession(owner: string, projectId: string, rawUrl: string) {
  await assertPublicWebUrl(rawUrl);
  if ([...sessions.values()].filter((session) => session.owner === owner).length >= MAX_SESSIONS_PER_OWNER || sessions.size >= MAX_SESSIONS) throw new Error('Se alcanzó el límite de sesiones web; cierra una sesión y vuelve a intentar');
  const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--disable-background-networking'] });
  let session: BrowserSession | undefined;
  try {
    const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, serviceWorkers: 'block', acceptDownloads: false });
    await context.addInitScript(() => { (globalThis as any).__name = (globalThis as any).__name || ((fn: unknown) => fn); });
    const page = await context.newPage();
    await context.route('**/*', async (route) => {
      try { await assertPublicWebUrl(route.request().url()); await route.continue(); }
      catch { await route.abort('blockedbyclient'); }
    });
    session = { id: crypto.randomUUID(), owner, projectId, expiresAt: Date.now() + SESSION_TTL_MS, maxExpiresAt: Date.now() + SESSION_MAX_AGE_MS, browser, context, page, snapshotVersion: 0 };
    sessions.set(session.id, session);
    await context.routeWebSocket(() => true, async (socket) => {
      try {
        const url = new URL(socket.url());
        url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
        await assertPublicWebUrl(url.toString());
        socket.connectToServer();
      } catch { socket.close({ code: 1008, reason: 'Destination blocked by web policy' }); }
    });
    await page.goto(rawUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForTimeout(350);
    return await snapshot(session);
  } catch (error) {
    if (session) await destroy(session);
    else try { await browser.close(); } catch { /* ignore */ }
    throw error;
  }
}

export async function inspectMcpBrowserSession(owner: string, projectId: string, id: string) {
  return snapshot(await getOwnedSession(id, owner, projectId));
}

export async function actMcpBrowserSession(owner: string, projectId: string, args: any) {
  const session = await getOwnedSession(args.browser_id, owner, projectId);
  if (args.action !== 'navigate' && Number(args.snapshot_version) !== session.snapshotVersion) throw new Error('Objetivo vencido: inspecciona la página y vuelve a intentar con la versión actual');
  const page = session.page;
  const targetFor = async () => {
    const targetId = String(args.target_id || '').replace(/[^a-zA-Z0-9]/g, '');
    const target = page.locator(`[data-mcp-target="${targetId}"]`);
    if (await target.count() !== 1 || !(await target.isVisible())) throw new Error('El objetivo ya no está visible o no es único; inspecciona otra vez');
    const currentName = await target.evaluate((element) => {
      const clean = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
      const labelledBy = (element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
        .map((id) => document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || '').join(' ');
      const labels = element instanceof HTMLInputElement
        ? Array.from(element.labels || []).map((label) => label.innerText || label.textContent || '').join(' ')
        : '';
      const inputButton = element instanceof HTMLInputElement && ['button', 'submit', 'reset', 'image'].includes(element.type);
      const name = clean(labelledBy || element.getAttribute('aria-label') || labels || element.getAttribute('title')
        || element.getAttribute('placeholder') || (inputButton ? element.value : '') || (element as HTMLElement).innerText || element.textContent);
      if (name || !(element instanceof HTMLAnchorElement) || !element.href) return name;
      try { return `link to ${new URL(element.href).pathname || '/'}`; } catch { return 'link without accessible name'; }
    });
    if (currentName !== String(args.target_name || '').trim()) throw new Error('El objetivo cambió desde la inspección; inspecciona otra vez');
    return target;
  };
  if (args.action === 'navigate') {
    await assertPublicWebUrl(args.url);
    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  } else if (args.action === 'click') {
    const target = await targetFor();
    if (!(await target.isEnabled())) throw new Error('El objetivo está deshabilitado; inspecciona otra vez');
    await target.click({ timeout: 5000 });
  } else if (args.action === 'fill') {
    const target = await targetFor();
    if (!(await target.isEnabled())) throw new Error('El campo está deshabilitado; inspecciona otra vez');
    await target.fill(args.secret_value, { timeout: 5000 });
  } else if (args.action === 'select') {
    const target = await targetFor();
    if (!(await target.isEnabled())) throw new Error('El selector está deshabilitado; inspecciona otra vez');
    await target.selectOption({ label: args.option_label }, { timeout: 5000 });
  } else if (args.action === 'press') {
    const target = await targetFor();
    await target.press(args.key, { timeout: 5000 });
  } else if (args.action === 'wait') {
    await page.waitForTimeout(Math.min(5000, Math.max(100, Number(args.wait_ms || 500))));
  }
  await page.waitForTimeout(200);
  return snapshot(session);
}

export async function closeMcpBrowserSession(owner: string, projectId: string, id: string) {
  const session = await getOwnedSession(id, owner, projectId);
  await destroy(session);
  return { browser_id: id, status: 'closed' };
}

const cleanupTimer = setInterval(() => {
  for (const session of sessions.values()) if (session.expiresAt <= Date.now() || session.maxExpiresAt <= Date.now()) void destroy(session);
}, 30_000);
cleanupTimer.unref();
