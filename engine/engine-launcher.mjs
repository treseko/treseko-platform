import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {getActiveEngineRelease, removeStaleEngineReleases} from './release-lifecycle.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const pointerFile = path.join(root, '.treseko-active-engine-release.json');
const releases = path.join(root, '.engine-releases');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let child;
let stopping = false;

function loadRootEnv() {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const row = line.trim();
    if (!row || row.startsWith('#')) continue;
    const at = row.indexOf('=');
    if (at <= 0) continue;
    const key = row.slice(0, at).trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && !process.env[key]) process.env[key] = row.slice(at + 1).trim();
  }
}

function activeRelease() {
  return getActiveEngineRelease({fs, path, pointerFile, releases});
}

function readVersion() {
  const active = activeRelease();
  if (active) return active.version;
  return fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
}

async function healthy(version, proc) {
  const deadline = Date.now() + 45_000;
  const port = Number(process.env.ENGINE_PORT || 3010);
  while (!stopping && proc.exitCode === null && Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {signal: AbortSignal.timeout(1500)});
      const body = await response.json();
      if (response.ok && body?.status === 'ok' && body?.version === version) return true;
    } catch {}
    await delay(500);
  }
  return false;
}

function removeStaleReleases(active, previous) {
  removeStaleEngineReleases({fs, path, releases}, active, previous);
}

function setPointer(value) {
  const temporary = `${pointerFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), {mode: 0o600, flag: 'wx'});
  fs.renameSync(temporary, pointerFile);
}

loadRootEnv();
process.env.ENGINE_RUNTIME_DIR ||= root;
process.env.TRESEKO_ENGINE_DIR ||= root;
process.env.TRESEKO_ENGINE_UPDATE_CONTROL_DIR ||= path.join(root, 'update-control');

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => { stopping = true; child?.kill(signal); });
}

while (!stopping) {
  const release = activeRelease();
  const cwd = release?.path || root;
  const tsx = path.join(cwd, 'node_modules/tsx/dist/cli.mjs');
  if (!fs.existsSync(tsx)) throw new Error(`Falta el runtime tsx del Engine en ${cwd}`);
  const entry = process.execPath;
  const args = [tsx, 'src/server.ts'];
  const env = {...process.env, ENGINE_RUNTIME_DIR: root, TRESEKO_ENGINE_DIR: root,
    TRESEKO_ENGINE_UPDATE_CONTROL_DIR: path.join(root, 'update-control')};
  child = spawn(entry, args, {cwd, env, stdio: 'inherit', windowsHide: true});
  const runningVersion = release?.version || readVersion();
  const isHealthy = await healthy(runningVersion, child);
  if (isHealthy && release) removeStaleReleases(release.release, release.previous_release);
  if (!isHealthy && release) {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
      if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
    }
    if (release.previous_release) {
      const previous = path.join(releases, release.previous_release);
      if (fs.existsSync(previous) && fs.lstatSync(previous).isDirectory() && !fs.lstatSync(previous).isSymbolicLink()) {
        setPointer({schema: 1, release: release.previous_release});
        console.error(`Engine ${runningVersion} no alcanzo /health; se revierte a ${release.previous_release}.`);
      }
    } else {
      fs.unlinkSync(pointerFile);
      console.error(`Engine ${runningVersion} no alcanzo /health; se restaura el runtime anterior.`);
    }
    child = undefined;
    continue;
  }
  const code = await new Promise(resolve => child.once('exit', resolve));
  child = undefined;
  if (stopping) break;
  if (code === 75) console.info('Engine reiniciando para activar la release OTA verificada.');
  else console.warn(`Engine termino con codigo ${code}; se reinicia en 2 segundos.`);
  await delay(2000);
}
