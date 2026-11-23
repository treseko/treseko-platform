import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const launcherSource = path.join(path.dirname(fileURLToPath(import.meta.url)), 'worker-launcher.mjs');

test('launcher selects the active release while retaining runner identity and shared state paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'treseko-worker-launcher-'));
  try {
    const release = '1.0.8-abcdef123456';
    const entry = path.join(root, '.worker-releases', release, 'src', 'worker.mjs');
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.copyFileSync(launcherSource, path.join(root, 'worker-launcher.mjs'));
    fs.writeFileSync(path.join(root, '.treseko-active-worker-release.json'), JSON.stringify({ schema: 1, release }));
    fs.writeFileSync(path.join(root, '.env'), 'QA_API_BASE=https://api.example.test\n');
    fs.writeFileSync(entry, [
      "import fs from 'node:fs';",
      "fs.writeFileSync(process.env.QA_LAUNCHER_OUTPUT, JSON.stringify({api:process.env.QA_API_BASE, token:process.env.QA_RUNNER_TOKEN_FILE, instance:process.env.QA_WORKER_INSTANCE_ID_FILE, spool:process.env.QA_RESULT_SPOOL_DIR, runtime:process.env.QA_WORKER_RUNTIME_DIR, cwd:process.cwd()}));",
    ].join('\n'));
    const outputPath = path.join(root, 'output.json');
    const result = spawnSync(process.execPath, [path.join(root, 'worker-launcher.mjs')], {
      cwd: root,
      env: { ...process.env, QA_LAUNCHER_OUTPUT: outputPath },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    const resolvedRoot = fs.realpathSync(root);
    assert.equal(output.api, 'https://api.example.test');
    assert.equal(output.token, path.join(resolvedRoot, '.runner-token'));
    assert.equal(output.instance, path.join(resolvedRoot, '.worker-instance-id'));
    assert.equal(output.spool, path.join(resolvedRoot, '.state', 'result-spool'));
    assert.equal(output.runtime, resolvedRoot);
    assert.equal(output.cwd, path.join(resolvedRoot, '.worker-releases', release, 'src'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('launcher rejects an active release pointer that escapes its versioned directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'treseko-worker-launcher-invalid-'));
  try {
    fs.copyFileSync(launcherSource, path.join(root, 'worker-launcher.mjs'));
    fs.writeFileSync(path.join(root, '.treseko-active-worker-release.json'), JSON.stringify({ schema: 1, release: '../outside' }));
    const result = spawnSync(process.execPath, [path.join(root, 'worker-launcher.mjs')], {
      cwd: root, encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('launcher starts the newly active release when the old runtime requests a restart', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'treseko-worker-launcher-restart-'));
  try {
    const previous = '1.0.8-abcdef123456';
    const next = '1.0.8-fedcba654321';
    const oldEntry = path.join(root, '.worker-releases', previous, 'src', 'worker.mjs');
    const nextEntry = path.join(root, '.worker-releases', next, 'src', 'worker.mjs');
    fs.mkdirSync(path.dirname(oldEntry), { recursive: true });
    fs.mkdirSync(path.dirname(nextEntry), { recursive: true });
    fs.copyFileSync(launcherSource, path.join(root, 'worker-launcher.mjs'));
    fs.writeFileSync(path.join(root, '.treseko-active-worker-release.json'), JSON.stringify({ schema: 1, release: previous }));
    fs.writeFileSync(oldEntry, [
      "import fs from 'node:fs';",
      "fs.writeFileSync(process.env.QA_LAUNCHER_ROOT + '/.treseko-active-worker-release.json', JSON.stringify({schema:1,release:'1.0.8-fedcba654321'}));",
      'process.exit(75);',
    ].join('\n'));
    fs.writeFileSync(nextEntry, "import fs from 'node:fs'; fs.writeFileSync(process.env.QA_LAUNCHER_MARKER, 'new-release');\n");
    const marker = path.join(root, 'launched-release');
    const result = spawnSync(process.execPath, [path.join(root, 'worker-launcher.mjs')], {
      cwd: root,
      env: { ...process.env, QA_LAUNCHER_ROOT: root, QA_LAUNCHER_MARKER: marker },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'new-release');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
