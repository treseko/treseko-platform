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
  browser: Browser; context: BrowserContext; page: Page; snapshotVersion: number; snapshotSignature?: string;
  recording: boolean; recordedActions: any[];
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
  const state = await session.page.evaluate(({ maxTargets, targetPrefix }) => {
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
    const elements = nodes.map((node) => {
      const element = node as HTMLElement;
      let id = element.getAttribute('data-mcp-target') || '';
      if (!id.startsWith(`${targetPrefix}-`)) {
        const targetCounter = ((globalThis as any).__mcpTargetCounter || 0) + 1;
        (globalThis as any).__mcpTargetCounter = targetCounter;
        id = `${targetPrefix}-${targetCounter}`;
        element.setAttribute('data-mcp-target', id);
      }
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
      return { target: id, role, name: accessibleName(element), context: context && context !== element ? clean(context.innerText || context.textContent, 300) : undefined, type: input.type || undefined, value: input.type === 'password' ? '[redacted]' : clean(input.value || '', 300), checked, options: element instanceof HTMLSelectElement ? Array.from(element.options).slice(0, 40).map((option) => ({ label: clean(option.label, 200), value: option.value, selected: option.selected, disabled: option.disabled })) : undefined, href: element instanceof HTMLAnchorElement ? safeHref(element.href) : undefined, disabled: Boolean((element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true'), visible: Boolean(element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden') };
    }).filter((item) => item.name || ['input','textarea','select'].includes(item.role));
    const safeUrl = new URL(location.href);
    for (const key of [...safeUrl.searchParams.keys()]) if (/(token|secret|password|auth|session|key)/i.test(key)) safeUrl.searchParams.set(key, '[redacted]');
    if (/(token|secret|password|auth|session|key)=/i.test(safeUrl.hash)) safeUrl.hash = '#[redacted]';
    return { title: clean(document.title, 300), url: safeUrl.toString().slice(0, 2000), text: clean(document.body?.innerText || '', 12000), elements };
  }, { maxTargets: MAX_TARGETS, targetPrefix: session.id.replaceAll('-', '').slice(0, 12) });
  const signature = JSON.stringify({
    url: state.url,
    title: state.title,
    elements: state.elements.map(({ target, role, name, context, type, value, checked, disabled, href, options }) => ({ target, role, name, context, type, value, checked, disabled, href, options })),
  });
  if (signature !== session.snapshotSignature) {
    session.snapshotVersion += 1;
    session.snapshotSignature = signature;
  }
  const actions = session.recording ? session.recordedActions.slice(-100) : undefined;
  const screenshot = session.recording
    ? `data:image/jpeg;base64,${(await session.page.screenshot({ type: 'jpeg', quality: 65, animations: 'disabled' })).toString('base64')}`
    : undefined;
  return { browser_id: session.id, snapshot_version: session.snapshotVersion, ...state, text: state.text.slice(0, MAX_SNAPSHOT_CHARS), ...(actions ? { recorded_actions: actions } : {}), ...(screenshot ? { screenshot } : {}) };
}

export async function openMcpBrowserSession(owner: string, projectId: string, rawUrl: string, recording = false) {
  await assertPublicWebUrl(rawUrl);
  if ([...sessions.values()].filter((session) => session.owner === owner).length >= MAX_SESSIONS_PER_OWNER || sessions.size >= MAX_SESSIONS) throw new Error('Se alcanzó el límite de sesiones web; cierra una sesión y vuelve a intentar');
  const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--disable-background-networking'] });
  let session: BrowserSession | undefined;
  try {
    const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, serviceWorkers: 'block', acceptDownloads: false });
    session = { id: crypto.randomUUID(), owner, projectId, expiresAt: Date.now() + SESSION_TTL_MS, maxExpiresAt: Date.now() + SESSION_MAX_AGE_MS, browser, context, page: undefined as unknown as Page, snapshotVersion: 0, recording, recordedActions: [] };
    if (recording) await context.exposeBinding('__tresekoRecorderBinding', (_source, action) => {
      if (session && session.recordedActions.length < 100 && action && typeof action === 'object') {
        session.recordedActions.push(action);
      }
    });
    await context.addInitScript((recordActions: boolean) => {
      (globalThis as any).__name = (globalThis as any).__name || ((fn: unknown) => fn);
      if (!recordActions || (globalThis as any).__tresekoRecorderInstalled) return;
      (globalThis as any).__tresekoRecorderInstalled = true;
      (globalThis as any).__tresekoRecorderActions = [];
      const clean = (value: unknown, max = 240) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
      const describe = (element: HTMLElement) => {
        const input = element as HTMLInputElement;
        const labels = input.labels ? Array.from(input.labels).map((label) => clean(label.innerText || label.textContent)).filter(Boolean) : [];
        const role = element.getAttribute('role') || (element.tagName === 'A' ? 'link' : element.tagName === 'BUTTON' ? 'button' : element.tagName === 'INPUT' ? (input.type === 'checkbox' || input.type === 'radio' ? input.type : 'textbox') : element.tagName.toLowerCase());
        const name = clean(element.getAttribute('aria-label') || labels[0] || element.getAttribute('title') || element.getAttribute('placeholder') || element.innerText || (['button','submit'].includes(input.type) ? input.value : element.textContent));
        const candidates: any[] = [];
        const testId = element.getAttribute('data-testid') || element.getAttribute('data-test');
        if (testId) candidates.push({ kind: 'testId', value: testId });
        if (name && ['button','link','checkbox','radio','tab'].includes(role)) candidates.push({ kind: 'role', role, name });
        if (labels.length) candidates.push({ kind: 'label', value: labels[0] });
        const placeholder = element.getAttribute('placeholder');
        if (placeholder) candidates.push({ kind: 'placeholder', value: placeholder });
        if (element.id) candidates.push({ kind: 'id', value: element.id });
        if (name) candidates.push({ kind: 'text', value: name });
        const sensitive = input.type === 'password' || /password|secret|token|api.?key/i.test(`${name} ${input.autocomplete || ''}`);
        return { role, name, candidates: candidates.slice(0, 6), type: input.type || '', sensitive };
      };
      const target = (value: EventTarget | null) => value instanceof HTMLElement ? value.closest('a,button,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"]') as HTMLElement | null : null;
      const record = (action: any) => {
        const actions = (globalThis as any).__tresekoRecorderActions as any[];
        if (actions.length < 100) {
          actions.push(action);
          void (globalThis as any).__tresekoRecorderBinding?.(action);
        }
      };
      document.addEventListener('click', (event) => {
        const element = target(event.target);
        if (element) record({ action: 'click', ...describe(element), url: location.href });
      }, true);
      document.addEventListener('keydown', (event) => {
        const key = event.key === ' ' ? 'Space' : event.key;
        const recordedKey = (event.ctrlKey || event.metaKey) && key.toLowerCase() === 'a'
          ? `${event.metaKey ? 'Meta' : 'Control'}+A`
          : key;
        if (!['Enter', 'Tab', 'Escape', 'Backspace', 'ArrowDown', 'ArrowUp', 'Space', 'Control+A', 'Meta+A'].includes(recordedKey)) return;
        const element = target(event.target) || document.activeElement as HTMLElement | null;
        if (element) record({ action: 'press', ...describe(element), key: recordedKey, url: location.href });
      }, true);
      const recordValue = (event: Event) => {
        const element = target(event.target);
        if (!element || !['INPUT','TEXTAREA','SELECT'].includes(element.tagName)) return;
        const details = describe(element);
        const input = element as HTMLInputElement;
        const value = details.sensitive ? '' : clean(input.value, 1000);
        const actions = (globalThis as any).__tresekoRecorderActions as any[];
        const previous = actions.at(-1);
        if (previous?.action === 'fill' && JSON.stringify(previous.candidates) === JSON.stringify(details.candidates)) actions.pop();
        record({ action: element.tagName === 'SELECT' ? 'select' : 'fill', ...details, value, url: location.href });
      };
      document.addEventListener('change', recordValue, true);
      document.addEventListener('blur', recordValue, true);
    }, recording);
    const page = await context.newPage();
    await context.route('**/*', async (route) => {
      try { await assertPublicWebUrl(route.request().url()); await route.continue(); }
      catch { await route.abort('blockedbyclient'); }
    });
    session.page = page;
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

export async function clearFocusedMcpBrowserText(page: Page): Promise<void> {
  const editableFocused = await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLTextAreaElement || (active instanceof HTMLElement && active.isContentEditable)) return true;
    return active instanceof HTMLInputElement && !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image'].includes(active.type);
  });
  if (!editableFocused) throw new Error('Haz clic primero en un campo de texto para poder limpiarlo.');
  const modifier = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta' : 'Control');
  await page.keyboard.press(`${modifier}+A`);
  await page.keyboard.press('Backspace');
}

export async function actMcpBrowserSession(owner: string, projectId: string, args: any) {
  const session = await getOwnedSession(args.browser_id, owner, projectId);
  const stableTargetAction = ['click', 'fill', 'select', 'press'].includes(args.action);
  if (!['navigate', 'click_at', 'scroll_at', 'type_text', 'press_key', 'clear_focused_text'].includes(args.action)
    && !(session.recording && stableTargetAction)
    && Number(args.snapshot_version) !== session.snapshotVersion) throw new Error('Objetivo vencido: inspecciona la página y vuelve a intentar con la versión actual');
  const page = session.page;
  const targetFor = async () => {
    const targetId = String(args.target_id || '').replace(/[^a-zA-Z0-9_-]/g, '');
    let target = page.locator(`[data-mcp-target="${targetId}"]`);
    const targetCount = await target.count();
    const targetVisible = targetCount === 1 && await target.isVisible();
    if (!targetVisible) {
      const targetRole = String(args.target_role || '').trim();
      const targetName = String(args.target_name || '').trim();
      if (targetRole && targetName) {
        const semanticTarget = page.getByRole(targetRole as any, { name: targetName, exact: true });
        if (await semanticTarget.count() === 1 && await semanticTarget.isVisible()) target = semanticTarget;
        else if (targetRole === 'link' && args.target_href) {
          const href = new URL(String(args.target_href), page.url()).href;
          const hrefTarget = page.locator(`a[href=${JSON.stringify(href)}]`);
          if (await hrefTarget.count() === 1 && await hrefTarget.isVisible()) target = hrefTarget;
          else throw new Error('El enlace cambió desde la inspección y no se pudo resolver por nombre o dirección');
        } else throw new Error('El objetivo cambió desde la inspección y no se pudo resolver por nombre accesible');
      } else {
        throw new Error('El objetivo ya no está visible o no es único; inspecciona otra vez');
      }
    }
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
    const destination = await assertPublicWebUrl(args.url);
    if (session.recording && destination.toString() !== page.url() && session.recordedActions.length < 100) {
      const cleanUrl = new URL(destination);
      for (const key of [...cleanUrl.searchParams.keys()]) if (/(token|secret|password|auth|session|key)/i.test(key)) cleanUrl.searchParams.set(key, '[redacted]');
      if (/(token|secret|password|auth|session|key)=/i.test(cleanUrl.hash)) cleanUrl.hash = '#[redacted]';
      session.recordedActions.push({ action: 'navigate', url: cleanUrl.toString() });
    }
    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  } else if (args.action === 'click') {
    const target = await targetFor();
    if (!(await target.isEnabled())) throw new Error('El objetivo está deshabilitado; inspecciona otra vez');
    const previousUrl = page.url();
    const link = await target.evaluate((element) => element instanceof HTMLAnchorElement ? { url: element.href, target: element.target } : null);
    const navigation = link && link.target !== '_blank' && link.url !== previousUrl
      ? page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20_000 })
      : null;
    await target.click({ timeout: 5000, noWaitAfter: Boolean(link) });
    if (navigation) await navigation;
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
  } else if (args.action === 'click_at') {
    const x = Number(args.x); const y = Number(args.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 1365 || y > 900) throw new Error('Coordenadas de clic inválidas');
    const previousUrl = page.url();
    const link = await page.evaluate(({ clickX, clickY }) => {
      const element = document.elementFromPoint(clickX, clickY);
      const anchor = element instanceof Element ? element.closest('a') : null;
      return anchor instanceof HTMLAnchorElement ? { url: anchor.href, target: anchor.target } : null;
    }, { clickX: x, clickY: y });
    const navigation = link && link.target !== '_blank' && link.url !== previousUrl
      ? page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20_000 })
      : null;
    await page.mouse.click(x, y);
    if (navigation) await navigation;
  } else if (args.action === 'scroll_at') {
    const deltaY = Number(args.delta_y);
    if (!Number.isFinite(deltaY) || Math.abs(deltaY) > 900) throw new Error('Desplazamiento inválido');
    await page.mouse.wheel(0, deltaY);
  } else if (args.action === 'type_text') {
    const value = String(args.text || '');
    if (value.length > 1000) throw new Error('El texto supera el límite permitido');
    await page.keyboard.type(value, { delay: 15 });
  } else if (args.action === 'press_key') {
    const key = String(args.key || '');
    if (!['Enter', 'Tab', 'Escape', 'Backspace', 'ArrowDown', 'ArrowUp', 'Space', 'Control+A', 'Meta+A'].includes(key)) throw new Error('Tecla no permitida');
    await page.keyboard.press(key);
  } else if (args.action === 'clear_focused_text') {
    await clearFocusedMcpBrowserText(page);
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
