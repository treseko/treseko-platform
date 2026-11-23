import {createHash, randomUUID} from 'node:crypto';

const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_FILES = 20_000;
const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)?$/;
const BUILD_RE = /^[a-f0-9]{64}$/;
const OMIT_DIRS = new Set(['.git', 'node_modules', '.cache', '.pytest_cache', 'coverage', 'logs', 'reports', 'pending-deliveries', 'update-control', '.engine-releases', 'test-results']);
const OMIT_FILES = new Set(['.treseko-content-digest', '.treseko-runtime-manifest.json', '.treseko-update-fence', '.treseko-update-draining', '.treseko-update-restart', '.treseko-active-engine-release.json', '.maintenance', 'maintenance.html', '.runner-token', '.worker-instance-id', '.env']);

export function engineBuildId(fs, path, root) {
  const records = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      const absolute = path.join(directory, entry.name);
      const rel = path.relative(root, absolute).split(path.sep).join('/');
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!OMIT_DIRS.has(entry.name)) walk(absolute);
      } else if (entry.isFile() && !OMIT_FILES.has(entry.name)
        && !entry.name.startsWith('.env.') && !rel.includes('\n') && !rel.includes('\r')) {
        records.push([rel, absolute]);
      }
    }
  };
  walk(root);
  records.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const manifest = createHash('sha256');
  for (const [rel, file] of records) {
    const digest = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    manifest.update(`${digest}  ./${rel}\n`);
  }
  return manifest.digest('hex');
}

function safeRelative(value) {
  const name = String(value || '').replace(/\/$/, '');
  if (!name || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) return false;
  return name.split('/').every(part => part && part !== '.' && part !== '..');
}

export function createEngineSelfUpdater({fs, path, spawnSync, process, rootDir, admission,
  backendWsUrl, token, fetchFn = globalThis.fetch, restart = async () => process.exit(75), pollIntervalMs = 60_000, log = console}) {
  if (!path.isAbsolute(rootDir) || path.parse(rootDir).root === rootDir) throw new Error('Invalid Engine runtime directory');
  const control = path.join(rootDir, 'update-control');
  const pointer = path.join(rootDir, '.treseko-active-engine-release.json');
  const releases = path.join(rootDir, '.engine-releases');
  const baseUrl = () => {
    const parsed = new URL(backendWsUrl || '');
    parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
    // Backend routers are mounted flat in app_factory.py. Engine update routes
    // live at the service root, not under /api.
    parsed.pathname = '/'; parsed.search = ''; parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  };
  const run = (command, args, options = {}) => {
    const result = spawnSync(command, args, {cwd: options.cwd || rootDir, env: {...process.env, ...options.env},
      encoding: 'utf8', timeout: options.timeout || 15 * 60_000, maxBuffer: options.maxBuffer || 8 * 1024 * 1024,
      windowsHide: true, shell: process.platform === 'win32'});
    if (result.error || result.status !== 0) throw new Error(`${options.label || 'Comando OTA'} fallo: ${String(result.stderr || result.error?.message || '').slice(0, 400)}`);
    return String(result.stdout || '');
  };
  function currentRuntime() {
    if (fs.existsSync(pointer)) {
      const saved = JSON.parse(fs.readFileSync(pointer, 'utf8'));
      if (saved?.schema !== 1 || typeof saved.release !== 'string') throw new Error('Puntero Engine corrupto');
      const target = path.join(releases, saved.release);
      if (!path.resolve(target).startsWith(`${path.resolve(releases)}${path.sep}`)
          || fs.lstatSync(target).isSymbolicLink() || !fs.lstatSync(target).isDirectory()) throw new Error('Release activa Engine insegura');
      return {root: target, release: saved.release};
    }
    return {root: rootDir, release: null};
  }
  function atomicJson(file, value) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file);
  }
  function prepare(bytes, version, checksum, buildId) {
    if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error('Paquete Engine excede el limite permitido');
    const archive = path.join(rootDir, `.engine-update-${randomUUID()}.tar.gz`);
    const stage = path.join(releases, `.stage-${randomUUID()}`);
    fs.mkdirSync(releases, {recursive: true, mode: 0o700});
    fs.writeFileSync(archive, bytes, {flag: 'wx', mode: 0o600});
    try {
      const listing = run('tar', ['-tzf', archive], {label: 'Inspeccion del paquete Engine'}).split(/\r?\n/).filter(Boolean);
      if (!listing.length || listing.length > MAX_FILES || listing.some(name => !safeRelative(name))) throw new Error('El OTA Engine contiene rutas no permitidas');
      fs.mkdirSync(stage, {mode: 0o700});
      run('tar', ['--no-same-owner', '--no-same-permissions', '-xzf', archive, '-C', stage], {label: 'Extraccion del paquete Engine'});
      const metadata = JSON.parse(fs.readFileSync(path.join(stage, 'package.json'), 'utf8'));
      if (metadata.version !== version || fs.readFileSync(path.join(stage, 'VERSION'), 'utf8').trim() !== version) throw new Error('La version del paquete Engine no coincide');
      for (const required of ['src/server.ts', 'entrypoint.sh', 'engine-launcher.mjs', 'release-lifecycle.mjs', 'engine-self-update.mjs', 'package-lock.json']) {
        const stat = fs.lstatSync(path.join(stage, required));
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Paquete Engine incompleto');
      }
      const checkLinks = directory => {
        for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
          const item = path.join(directory, entry.name);
          if (entry.isSymbolicLink()) throw new Error('El paquete Engine contiene enlaces no permitidos');
          if (entry.isDirectory()) checkLinks(item);
        }
      };
      checkLinks(stage);
      if (engineBuildId(fs, path, stage) !== buildId) throw new Error('La huella del codigo Engine no coincide');
      const old = currentRuntime();
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      run(npm, ['ci'], {cwd: stage, env: {PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1', CYPRESS_INSTALL_BINARY: '0', PUPPETEER_SKIP_DOWNLOAD: '1'}, label: 'Instalacion de dependencias Engine'});
      if (metadata.dependencies?.playwright || metadata.devDependencies?.playwright) {
        run(npm, ['exec', '--', 'playwright', 'install', 'chromium'], {
          cwd: stage, label: 'Instalacion del navegador Playwright del Engine', timeout: 20 * 60_000,
        });
      }
      const installed = `${version}-${buildId.slice(0, 12)}`;
      const final = path.join(releases, installed);
      if (fs.existsSync(final)) {
        if (fs.lstatSync(final).isSymbolicLink() || !fs.lstatSync(final).isDirectory()
            || engineBuildId(fs, path, final) !== buildId) throw new Error('Conflicto con release Engine existente');
        fs.rmSync(stage, {recursive: true, force: true});
      } else fs.renameSync(stage, final);
      const previous = old.release;
      atomicJson(pointer, {schema: 1, release: installed, previous_release: previous});
      return {version, release: installed, previous_release: previous};
    } catch (error) {
      fs.rmSync(stage, {recursive: true, force: true});
      throw error;
    } finally { fs.unlinkSync(archive); }
  }
  async function checkAndApply() {
    if (!token || !backendWsUrl) return {status: 'configuration_missing'};
    const local = currentRuntime();
    const pkg = JSON.parse(fs.readFileSync(path.join(local.root, 'package.json'), 'utf8'));
    const version = fs.readFileSync(path.join(local.root, 'VERSION'), 'utf8').trim();
    const buildId = engineBuildId(fs, path, local.root);
    const state = admission.status();
    if (!state.enabled) return {status: 'admission_unavailable'};
    if (state.marker_state === 'invalid' || state.fenced || state.active_leases > 0
        || state.terminal_delivery.pending_local_deliveries > 0
        || state.terminal_delivery.local_spool_state === 'unavailable') return {status: 'busy_or_fenced'};
    const base = baseUrl();
    const headers = {'x-engine-internal-token': token};
    const query = new URLSearchParams({version, build_id: buildId});
    const response = await fetchFn(`${base}/engine-updates/me/status?${query}`, {headers, redirect: 'error', signal: AbortSignal.timeout(15_000)});
    if (!response.ok) throw new Error(`Estado OTA Engine rechazado (${response.status})`);
    const offer = await response.json();
    if (offer.status === 'current') return {status: 'current', version};
    if (offer.status !== 'update_required' || !VERSION_RE.test(String(offer.desired_version || ''))
        || !BUILD_RE.test(String(offer.desired_build_id || ''))) return {status: offer.status || 'update_unverified'};
    admission.acquireFence(`engine-self-update-${randomUUID()}`);
    const transaction = admission.status().owner_transaction;
    try {
      const deadline = Date.now() + 120_000;
      while (true) {
        const drained = admission.status();
        if (drained.active_leases === 0 && drained.terminal_delivery.pending_local_deliveries === 0
            && drained.terminal_delivery.local_spool_state === 'empty') break;
        if (Date.now() >= deadline) throw new Error('Engine no pudo drenar antes del tiempo limite');
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      const packageResponse = await fetchFn(`${base}/engine-updates/me/package?${query}`, {headers, redirect: 'error', signal: AbortSignal.timeout(120_000)});
      if (!packageResponse.ok) throw new Error(`Descarga OTA Engine rechazada (${packageResponse.status})`);
      const targetVersion = packageResponse.headers.get('x-engine-update-version');
      const targetBuild = packageResponse.headers.get('x-engine-update-build-id');
      const checksum = packageResponse.headers.get('x-engine-update-sha256');
      const bytes = Buffer.from(await packageResponse.arrayBuffer());
      if (targetVersion !== offer.desired_version || targetBuild !== offer.desired_build_id
          || !BUILD_RE.test(checksum || '') || createHash('sha256').update(bytes).digest('hex') !== checksum) {
        throw new Error('Firma de transporte, version o build del OTA Engine no coincide');
      }
      const candidate = prepare(bytes, targetVersion, checksum, targetBuild);
      log.info?.(`Engine ${version} preparado para ${candidate.version}; reiniciando sin leases activos.`);
      await restart(transaction);
      return {status: 'restarting', version: targetVersion, transaction};
    } catch (error) {
      if (transaction) admission.releaseFence(transaction);
      throw error;
    }
  }
  async function runLoop() {
    while (!process.exitCode) {
      try { await checkAndApply(); }
      catch (error) { log.error?.(`Autoactualizacion Engine no aplicada: ${String(error?.message || error).slice(0, 500)}`); }
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
  }
  return {checkAndApply, runLoop};
}
