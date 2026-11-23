import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {getActiveEngineRelease, removeStaleEngineReleases} from './release-lifecycle.mjs';

function seedRelease(root, name, version = '1.0.8') {
  const release = path.join(root, name);
  fs.mkdirSync(path.join(release, 'src'), {recursive: true});
  fs.mkdirSync(path.join(release, 'node_modules', 'tsx', 'dist'), {recursive: true});
  for (const file of ['package.json', 'package-lock.json', 'src/server.ts', 'node_modules/tsx/dist/cli.mjs']) {
    fs.writeFileSync(path.join(release, file), 'fixture');
  }
  fs.writeFileSync(path.join(release, 'VERSION'), `${version}\n`);
  return release;
}

test('launcher cleanup preserves the active Engine release and its rollback release', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'treseko-engine-launcher-'));
  const releases = path.join(root, '.engine-releases');
  const activeName = '1.0.8-aaaaaaaaaaaa';
  const previousName = '1.0.7-bbbbbbbbbbbb';
  try {
    fs.mkdirSync(releases);
    const activePath = seedRelease(releases, activeName);
    const previousPath = seedRelease(releases, previousName, '1.0.7');
    seedRelease(releases, '1.0.6-cccccccccccc', '1.0.6');
    const backupRoot = path.join(releases, '.treseko-remote-docker-backups');
    const legacyBackup = path.join(backupRoot, 'engine-test', 'engine-launcher.mjs');
    fs.mkdirSync(path.dirname(legacyBackup), {recursive: true});
    fs.writeFileSync(legacyBackup, 'legacy runtime snapshot');
    const pointerFile = path.join(root, '.treseko-active-engine-release.json');
    fs.writeFileSync(pointerFile, JSON.stringify({schema: 1, release: activeName, previous_release: previousName}));

    const active = getActiveEngineRelease({fs, path, pointerFile, releases});
    assert.equal(active.release, activeName);
    removeStaleEngineReleases({fs, path, releases}, active.release, active.previous_release);

    assert.equal(fs.existsSync(activePath), true);
    assert.equal(fs.existsSync(previousPath), true);
    assert.equal(fs.existsSync(path.join(releases, '1.0.6-cccccccccccc')), false);
    assert.equal(fs.readFileSync(legacyBackup, 'utf8'), 'legacy runtime snapshot');
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
