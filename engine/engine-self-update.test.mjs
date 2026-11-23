import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {engineBuildId, createEngineSelfUpdater} from './engine-self-update.mjs';

function seed(root, version) {
  fs.mkdirSync(path.join(root, 'src'), {recursive: true});
  fs.writeFileSync(path.join(root, 'VERSION'), `${version}\n`);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({name: 'treseko-engine', version}));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({name: 'treseko-engine', version, lockfileVersion: 3, packages: {}}));
  fs.writeFileSync(path.join(root, 'src/server.ts'), `export const version = '${version}';\n`);
  fs.writeFileSync(path.join(root, 'entrypoint.sh'), '#!/bin/sh\n');
  fs.writeFileSync(path.join(root, 'engine-launcher.mjs'), '// launcher\n');
  fs.writeFileSync(path.join(root, 'release-lifecycle.mjs'), '// lifecycle\n');
  fs.writeFileSync(path.join(root, 'engine-self-update.mjs'), '// updater\n');
  fs.writeFileSync(path.join(root, 'hash_component_tree.sh'), '#!/bin/sh\n');
}

test('Engine builds a stable digest excluding persistent control state', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'treseko-engine-digest-'));
  try {
    seed(root, '1.0.7');
    const expected = engineBuildId(fs, path, root);
    fs.mkdirSync(path.join(root, 'update-control'));
    fs.writeFileSync(path.join(root, 'update-control', '.treseko-engine-update-fence'), 'temporary');
    assert.equal(engineBuildId(fs, path, root), expected);
    fs.writeFileSync(path.join(root, 'src/server.ts'), 'export const changed = true;\n');
    assert.notEqual(engineBuildId(fs, path, root), expected);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('Engine fetches, verifies and stages its OTA release behind an admission fence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'treseko-engine-update-'));
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'treseko-engine-source-'));
  let fenced = false;
  let restartTransaction = null;
  try {
    seed(root, '1.0.7');
    seed(source, '1.0.8');
    const buildId = engineBuildId(fs, path, source);
    const archive = path.join(root, 'offer.tar.gz');
    const names = ['VERSION', 'package.json', 'package-lock.json', 'entrypoint.sh', 'engine-launcher.mjs', 'release-lifecycle.mjs', 'engine-self-update.mjs', 'hash_component_tree.sh', 'src/server.ts'];
    const tar = spawnSync('tar', ['-czf', archive, '-C', source, ...names], {encoding: 'utf8'});
    assert.equal(tar.status, 0, tar.stderr);
    const bytes = fs.readFileSync(archive);
    const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    const response = (body, headers = {}) => ({ok: true, status: 200, json: async () => body, headers: {get: name => headers[name.toLowerCase()] || null}, arrayBuffer: async () => bytes});
    let calls = 0;
    const updater = createEngineSelfUpdater({
      fs, path, spawnSync, process: {platform: process.platform, env: process.env}, rootDir: root,
      backendWsUrl: 'ws://backend.private:8000/ws/engine-sync', token: 'test-engine-token',
      fetchFn: async (url, options) => {
        assert.ok(['/engine-updates/me/status', '/engine-updates/me/package']
          .includes(new URL(url).pathname));
        assert.equal(options.headers['x-engine-internal-token'], 'test-engine-token');
        calls += 1;
        if (calls === 1) return response({status: 'update_required', desired_version: '1.0.8', desired_build_id: buildId});
        return response(null, {'x-engine-update-version': '1.0.8', 'x-engine-update-build-id': buildId, 'x-engine-update-sha256': checksum});
      },
      admission: {
        status: () => ({enabled: true, marker_state: fenced ? 'present' : 'absent', fenced,
          owner_transaction: fenced ? 'engine-self-update-test' : null, active_leases: 0,
          terminal_delivery: {pending_local_deliveries: 0, local_spool_state: 'empty'}}),
        acquireFence: transaction => { fenced = true; return transaction; },
        releaseFence: () => { fenced = false; },
      },
      restart: async transaction => { restartTransaction = transaction; },
      pollIntervalMs: 1,
      log: {info() {}, warn() {}, error() {}},
    });
    const result = await updater.checkAndApply();
    assert.equal(result.status, 'restarting');
    assert.equal(restartTransaction, 'engine-self-update-test');
    assert.equal(calls, 2);
    const pointer = JSON.parse(fs.readFileSync(path.join(root, '.treseko-active-engine-release.json'), 'utf8'));
    assert.equal(pointer.release, `1.0.8-${buildId.slice(0, 12)}`);
    assert.equal(fs.readFileSync(path.join(root, '.engine-releases', pointer.release, 'VERSION'), 'utf8').trim(), '1.0.8');
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
    fs.rmSync(source, {recursive: true, force: true});
  }
});

test('Engine does not update if its durable admission fence is unavailable', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'treseko-engine-no-fence-'));
  try {
    seed(root, '1.0.8');
    let networkCalls = 0;
    const updater = createEngineSelfUpdater({
      fs, path, spawnSync, process: {platform: process.platform, env: process.env}, rootDir: root,
      backendWsUrl: 'ws://backend.private:8000/ws/engine-sync', token: 'test-engine-token',
      fetchFn: async () => { networkCalls += 1; throw new Error('must not fetch'); },
      admission: {status: () => ({enabled: false})},
      restart: async () => assert.fail('must not restart'), log: {info() {}, warn() {}, error() {}},
    });
    assert.equal((await updater.checkAndApply()).status, 'admission_unavailable');
    assert.equal(networkCalls, 0);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});
