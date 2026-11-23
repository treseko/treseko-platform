import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync as realSpawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createWorkerSelfUpdater, validateWorkerArchiveListing} from './worker-self-update.mjs';

test('worker archive listing rejects traversal and absolute paths', () => {
  for (const listing of ['../outside\n', '/tmp/outside\n', 'C:/outside\n', 'src\\worker.mjs\n']) {
    assert.throws(() => validateWorkerArchiveListing(listing));
  }
  assert.deepEqual(validateWorkerArchiveListing('src/worker.mjs\npackage.json\n'), [
    'src/worker.mjs', 'package.json',
  ]);
});

test('current runner status never stages or exits', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'treseko-worker-update-current-'));
  try {
    let downloads = 0, exits = 0;
    const updater = createWorkerSelfUpdater({
      fs, path, spawnSync: realSpawnSync, process: { platform: 'linux', env: {}, exit: () => exits++ },
      rootDir: root, api: async () => ({ status: 'current', desired_version: '1.0.8' }),
      downloadWorkerUpdate: async () => { downloads++; },
    });
    assert.deepEqual(await updater.checkAndApply({ activeJobs: 0, pendingResults: 0 }), {
      status: 'current', version: '1.0.8',
    });
    assert.equal(downloads, 0);
    assert.equal(exits, 0);
    assert.equal(fs.existsSync(path.join(root, '.worker-releases')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('1.0.8 relinked runner stages verified 1.0.8 release, preserves identity data and requests supervisor restart', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'treseko-worker-update-stale-'));
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'treseko-worker-source-'));
  try {
    fs.mkdirSync(path.join(source, 'src'));
    fs.writeFileSync(path.join(source, 'src', 'worker.mjs'), 'console.log("new worker")\n');
    fs.writeFileSync(path.join(source, 'worker-launcher.mjs'), 'console.log("launcher")\n');
    fs.writeFileSync(path.join(source, 'entrypoint.sh'), '#!/bin/sh\n');
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ version: '1.0.8', scripts: { start: 'node worker-launcher.mjs' } }));
    fs.writeFileSync(path.join(source, 'package-lock.json'), JSON.stringify({ name: 'worker', lockfileVersion: 3 }));
    fs.writeFileSync(path.join(source, 'VERSION'), '1.0.8\n');
    const archive = path.join(os.tmpdir(), `treseko-worker-source-${Date.now()}.tar.gz`);
    const tar = realSpawnSync('tar', ['-czf', archive, '-C', source,
      'src/worker.mjs', 'worker-launcher.mjs', 'entrypoint.sh', 'package.json', 'package-lock.json', 'VERSION'], { encoding: 'utf8' });
    assert.equal(tar.status, 0, tar.stderr);
    const bytes = fs.readFileSync(archive);
    fs.unlinkSync(archive);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    fs.mkdirSync(path.join(root, '.state', 'result-spool'), { recursive: true });
    fs.writeFileSync(path.join(root, '.runner-token'), 'keep-me');
    fs.writeFileSync(path.join(root, '.worker-instance-id'), 'stable-instance');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.0.8', scripts: { start: 'node worker-launcher.mjs' } }));
    fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
    fs.writeFileSync(path.join(root, 'VERSION'), '1.0.8\n');
    let exited = null;
    const updater = createWorkerSelfUpdater({
      fs, path,
      spawnSync: (command, args, options) => command === 'npm'
        ? { status: 0, stdout: '', stderr: '' }
        : realSpawnSync(command, args, options),
      process: { platform: 'linux', env: {}, exit: code => { exited = code; } },
      rootDir: root,
      api: async () => ({ status: 'update_required', observed_version: '1.0.8', desired_version: '1.0.8',
        observed_build_id: 'b'.repeat(64), desired_build_id: 'a'.repeat(64) }),
      downloadWorkerUpdate: async () => ({ bytes, version: '1.0.8', checksum, buildId: 'a'.repeat(64) }),
      log: { info() {} },
    });
    const result = await updater.checkAndApply({ activeJobs: 0, pendingResults: 0, unresolvedClaims: 0 });
    assert.equal(result.status, 'restarting');
    assert.equal(exited, 75);
    assert.equal(fs.readFileSync(path.join(root, '.runner-token'), 'utf8'), 'keep-me');
    assert.equal(fs.readFileSync(path.join(root, '.worker-instance-id'), 'utf8'), 'stable-instance');
    const pointer = JSON.parse(fs.readFileSync(path.join(root, '.treseko-active-worker-release.json'), 'utf8'));
    assert.equal(pointer.schema, 1);
    const releaseRoot = path.join(root, '.worker-releases', pointer.release);
    assert.equal(JSON.parse(fs.readFileSync(path.join(releaseRoot, 'package.json'), 'utf8')).version, '1.0.8');
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(path.join(root, '.worker-releases')).mode & 0o001, 0o001,
        'isolated script users need to traverse the release store');
      assert.equal(fs.statSync(releaseRoot).mode & 0o001, 0o001,
        'isolated script users need to traverse the active release');
      assert.equal(fs.statSync(path.join(root, '.worker-releases')).mode & 0o004, 0,
        'isolated script users must not list the private release store');
    }
    assert.equal(fs.readFileSync(path.join(releaseRoot, '.treseko-content-digest'), 'utf8').trim(), 'a'.repeat(64));
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts.start, 'node worker-launcher.mjs');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.treseko-runtime-manifest.json'), 'utf8')).version, '1.0.8');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('busy runner defers before checking update offer', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'treseko-worker-update-busy-'));
  try {
    let checks = 0;
    const updater = createWorkerSelfUpdater({
      fs, path, spawnSync: realSpawnSync, process: { platform: 'linux', env: {}, exit() {} },
      rootDir: root, api: async () => { checks++; }, downloadWorkerUpdate: async () => {},
    });
    assert.deepEqual(await updater.checkAndApply({ activeJobs: 1, pendingResults: 0 }), { status: 'deferred' });
    assert.equal(checks, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
