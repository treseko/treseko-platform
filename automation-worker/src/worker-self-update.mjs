import {createHash, randomUUID} from 'node:crypto';

const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 20_000;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)?$/;
const BUILD_ID = /^[a-f0-9]{64}$/;

function safeRelativeArchivePath(value) {
  const name = String(value || '').replace(/\r$/, '');
  if (!name || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) return false;
  const segments = name.split('/').filter(Boolean);
  return segments.length > 0 && segments.every(segment => segment !== '.' && segment !== '..');
}

function atomicWrite(fs, path, file, value, mode = 0o600) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const descriptor = fs.openSync(temporary, 'wx', mode);
  try {
    fs.writeFileSync(descriptor, value);
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
  fs.renameSync(temporary, file);
  const directory = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}

export function validateWorkerArchiveListing(listing) {
  const entries = String(listing || '').split(/\r?\n/).filter(Boolean);
  if (!entries.length || entries.length > MAX_ARCHIVE_ENTRIES
      || entries.some(name => !safeRelativeArchivePath(name))) {
    throw new Error('El paquete del Worker contiene rutas no permitidas.');
  }
  return entries;
}

export function createWorkerSelfUpdater({
  fs, path, spawnSync, process, rootDir, api, downloadWorkerUpdate,
  getActivity, sleep, pollIntervalMs, log = console,
}) {
  if (!path.isAbsolute(rootDir) || path.parse(rootDir).root === rootDir) {
    throw new Error('A dedicated absolute Worker runtime directory is required');
  }

  function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
      cwd: options.cwd || rootDir,
      env: { ...process.env, ...(options.env || {}) },
      encoding: 'utf8',
      maxBuffer: options.maxBuffer || 8 * 1024 * 1024,
      timeout: options.timeout || 120_000,
      windowsHide: true,
    });
    if (result.error || result.status !== 0) {
      const detail = String(result.stderr || result.error?.message || '').slice(0, 500);
      throw new Error(`${options.label || 'Comando de actualizacion'} fallo${detail ? `: ${detail}` : '.'}`);
    }
    return String(result.stdout || '');
  }

  function assertNoLinks(directory) {
    const stack = [directory];
    let visited = 0;
    while (stack.length) {
      const current = stack.pop();
      for (const name of fs.readdirSync(current)) {
        if (++visited > MAX_ARCHIVE_ENTRIES) throw new Error('El paquete contiene demasiados archivos.');
        const item = path.join(current, name);
        const stat = fs.lstatSync(item);
        if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
          throw new Error('El paquete del Worker contiene enlaces o archivos especiales.');
        }
        if (stat.isDirectory()) stack.push(item);
      }
    }
  }

  function readCandidateVersion(directory) {
    const packageFile = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    const versionFile = fs.readFileSync(path.join(directory, 'VERSION'), 'utf8').trim();
    if (!VERSION.test(String(packageFile.version || '')) || packageFile.version !== versionFile
        || !fs.statSync(path.join(directory, 'src', 'worker.mjs')).isFile()
        || !fs.statSync(path.join(directory, 'worker-launcher.mjs')).isFile()) {
      throw new Error('La version o el entrypoint del paquete del Worker no coincide.');
    }
    if (packageFile.scripts?.start !== 'node worker-launcher.mjs') {
      throw new Error('El paquete no incluye el launcher persistente del Worker.');
    }
    return packageFile.version;
  }

  function prepareCandidate(bytes, targetVersion, checksum, buildId) {
    const stateDirectory = path.join(rootDir, '.state', 'worker-update');
    const releasesDirectory = path.join(rootDir, '.worker-releases');
    fs.mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
    fs.mkdirSync(releasesDirectory, { recursive: true, mode: 0o700 });
    for (const directory of [stateDirectory, releasesDirectory]) {
      const stat = fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o022)) {
        throw new Error('El directorio persistente del update no es seguro.');
      }
    }
    // Linux runs browser scripts under a separate, unprivileged UID. It needs
    // to traverse the release path, but must not be able to list or modify the
    // private release store. The default 0700 mode made every Playwright CLI
    // look missing to that UID after a successful update.
    if (process.platform !== 'win32') fs.chmodSync(releasesDirectory, 0o711);
    const archive = path.join(stateDirectory, `worker-${targetVersion}-${randomUUID()}.tar.gz`);
    const releaseId = `${targetVersion}-${checksum.slice(0, 12)}`;
    const target = path.join(releasesDirectory, releaseId);
    const stage = path.join(releasesDirectory, `.staging-${randomUUID()}`);
    fs.writeFileSync(archive, bytes, { mode: 0o600, flag: 'wx' });
    try {
      const listing = run('tar', ['-tzf', archive], { maxBuffer: 4 * 1024 * 1024, label: 'Lectura del paquete' });
      validateWorkerArchiveListing(listing);
      fs.mkdirSync(stage, { mode: 0o700 });
      run('tar', ['--no-same-owner', '--no-same-permissions', '-xzf', archive, '-C', stage],
        { timeout: 120_000, label: 'Extraccion del paquete' });
      assertNoLinks(stage);
      if (readCandidateVersion(stage) !== targetVersion) throw new Error('La version extraida no coincide con el destino.');
      atomicWrite(fs, path, path.join(stage, '.treseko-content-digest'), `${buildId}\n`, 0o600);

      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      run(npm, ['ci'], {
        cwd: stage,
        timeout: 15 * 60_000,
        maxBuffer: 16 * 1024 * 1024,
        label: 'Instalacion de dependencias',
        env: {
          PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
          CYPRESS_INSTALL_BINARY: '0',
          PUPPETEER_SKIP_DOWNLOAD: '1',
        },
      });
      atomicWrite(fs, path, path.join(stage, '.treseko-runtime-manifest.json'),
        JSON.stringify({ source: 'legacy-payload', version: targetVersion }), 0o600);
      if (process.platform !== 'win32') fs.chmodSync(stage, 0o711);
      if (fs.existsSync(target)) {
        const targetStat = fs.lstatSync(target);
        if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) throw new Error('La carpeta destino del Worker no es segura.');
        assertNoLinks(target);
        const existing = readCandidateVersion(target);
        if (existing !== targetVersion) throw new Error('La carpeta destino pertenece a otra version.');
        fs.rmSync(stage, { recursive: true, force: true });
        if (process.platform !== 'win32') fs.chmodSync(target, 0o711);
      } else {
        fs.renameSync(stage, target);
      }
      return { archive, releaseId, releasePath: target, version: targetVersion };
    } catch (error) {
      fs.rmSync(stage, { recursive: true, force: true });
      fs.unlinkSync(archive);
      throw error;
    }
  }

  function activate(release) {
    const sourcePackage = path.join(release.releasePath, 'package.json');
    const sourceLock = path.join(release.releasePath, 'package-lock.json');
    const sourceLauncher = path.join(release.releasePath, 'worker-launcher.mjs');
    const sourceEntrypoint = path.join(release.releasePath, 'entrypoint.sh');
    for (const source of [sourcePackage, sourceLock, sourceLauncher, sourceEntrypoint,
      path.join(release.releasePath, 'VERSION')]) {
      const stat = fs.lstatSync(source);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('El paquete del Worker no esta completo.');
    }
    for (const name of ['package.json', 'package-lock.json', 'worker-launcher.mjs', 'entrypoint.sh', 'VERSION']) {
      const content = fs.readFileSync(path.join(release.releasePath, name));
      const temporary = path.join(rootDir, `${name}.${randomUUID()}.tmp`);
      fs.writeFileSync(temporary, content, {
        mode: name === 'worker-launcher.mjs' || name === 'entrypoint.sh' ? 0o755 : 0o600,
        flag: 'wx',
      });
      fs.renameSync(temporary, path.join(rootDir, name));
    }
    atomicWrite(fs, path, path.join(rootDir, '.treseko-runtime-manifest.json'),
      JSON.stringify({ source: 'legacy-payload', version: release.version }), 0o600);
    atomicWrite(fs, path, path.join(rootDir, '.treseko-active-worker-release.json'),
      JSON.stringify({ schema: 1, release: release.releaseId }), 0o600);
  }

  async function checkAndApply({ activeJobs, pendingResults, unresolvedClaims = 0 } = {}) {
    for (const count of [activeJobs, pendingResults, unresolvedClaims]) {
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid Worker update activity counters');
    }
    if (activeJobs || pendingResults || unresolvedClaims) return { status: 'deferred' };
    const status = await api('/automation-runners/me/update-status');
    if (status?.status === 'current') return { status: 'current', version: status.desired_version };
    if (status?.status !== 'update_required') {
      return { status: status?.status || 'version_unknown', version: status?.desired_version || null };
    }
    const desired = String(status.desired_version || '').trim();
    const observed = String(status.observed_version || '').trim();
    const desiredBuildId = String(status.desired_build_id || '').trim().toLowerCase();
    if (!VERSION.test(desired) || !VERSION.test(observed) || !BUILD_ID.test(desiredBuildId)) {
      throw new Error('La version o huella reportada no permite una actualizacion segura.');
    }
    const downloaded = await downloadWorkerUpdate();
    if (downloaded.version !== desired || downloaded.buildId !== desiredBuildId
        || !BUILD_ID.test(downloaded.checksum)) {
      throw new Error('La oferta del paquete no coincide con el estado autorizado por Treseko.');
    }
    const actualChecksum = createHash('sha256').update(downloaded.bytes).digest('hex');
    if (actualChecksum !== downloaded.checksum) throw new Error('El SHA-256 del paquete del Worker no coincide.');
    const release = prepareCandidate(downloaded.bytes, desired, actualChecksum, desiredBuildId);
    activate(release);
    fs.unlinkSync(release.archive);
    log.info?.(`Worker ${observed} actualizado a ${desired}; reiniciando para activar el runtime entregado por Treseko y verificado por SHA-256.`);
    process.exit(75);
    return { status: 'restarting', version: desired };
  }

  async function deferIfRequired() {
    const result = await checkAndApply(getActivity());
    if (result.status === 'current') return false;
    if (result.status !== 'restarting') {
      log.warn?.(`Worker en pausa hasta actualizarse o verificar su version (estado: ${result.status}).`);
    }
    await sleep(pollIntervalMs);
    return true;
  }

  return { checkAndApply, deferIfRequired };
}
