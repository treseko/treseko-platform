import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VideoEvidenceStore } from './video-evidence.ts';

test('dry-run video expires; regular evidence survives temporary cleanup', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'treseko-video-test-'));
  try {
    const store = new VideoEvidenceStore(root, { dryRunTtlMs: 1000, dryRunMaxBytes: 20, reserveBytes: 0 });
    const temporary = store.begin(true);
    const permanent = store.begin(false);
    fs.writeFileSync(path.join(temporary.directory, 'capture.webm'), 'temporary');
    fs.writeFileSync(path.join(permanent.directory, 'capture.webm'), 'permanent');
    const tempRef = await store.finish(temporary);
    const regularRef = await store.finish(permanent);
    assert.equal(tempRef?.temporary, true);
    assert.equal(regularRef?.expires_at, null);
    store.cleanup(Date.now() + 2000);
    assert.equal(store.resolve(temporary.id), null);
    assert.ok(store.resolve(permanent.id));
    assert.equal(store.resolve('../escape'), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('temporary quota evicts oldest finished dry-runs, never active or regular recordings', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'treseko-video-test-'));
  try {
    const store = new VideoEvidenceStore(root, { dryRunTtlMs: 60000, dryRunMaxBytes: 10, reserveBytes: 0 });
    const active = store.begin(true);
    const first = store.begin(true);
    fs.writeFileSync(path.join(first.directory, 'capture.webm'), '12345678');
    await store.finish(first);
    const manifestFile = path.join(first.directory, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    manifest.created_at = '2020-01-01T00:00:00Z';
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    const second = store.begin(true);
    fs.writeFileSync(path.join(second.directory, 'capture.webm'), '12345678');
    await store.finish(second);
    assert.equal(store.resolve(first.id), null);
    assert.ok(store.resolve(second.id));
    assert.ok(fs.existsSync(active.directory));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('popup videos remain in the same reference and the primary page is first', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'treseko-video-test-'));
  try {
    const store = new VideoEvidenceStore(root, { dryRunTtlMs: 60000, dryRunMaxBytes: 100, reserveBytes: 0 });
    const recording = store.begin(true);
    const main = path.join(recording.directory, 'z-main.webm');
    fs.writeFileSync(main, 'main');
    fs.writeFileSync(path.join(recording.directory, 'a-popup.webm'), 'popup');
    const reference = await store.finish(recording, main);
    assert.equal(reference?.page_count, 2);
    assert.equal(fs.readFileSync(store.resolve(recording.id)!, 'utf8'), 'main');
    assert.equal(fs.readFileSync(store.resolve(recording.id, 1)!, 'utf8'), 'popup');
    assert.equal(store.resolve(recording.id, 2), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

 test('explicit deletion removes only finished temporary recordings and is idempotent', async () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'treseko-delete-video-'));
 try {
 const store = new VideoEvidenceStore(root, {dryRunTtlMs:60000,dryRunMaxBytes:100,reserveBytes:0});
 const temp=store.begin(true), regular=store.begin(false), active=store.begin(true);
 for (const item of [temp,regular]) { fs.writeFileSync(path.join(item.directory,'capture.webm'),'video'); await store.finish(item); }
 assert.equal(store.deleteTemporary(temp.id),true);
 assert.equal(fs.existsSync(temp.directory),false);
 assert.equal(store.deleteTemporary(temp.id),true);
 assert.equal(store.deleteTemporary(regular.id),false);
 assert.equal(store.deleteTemporary(active.id),false);
 assert.equal(store.deleteTemporary('../escape'),false);
 assert.ok(store.resolve(regular.id));
 } finally {fs.rmSync(root,{recursive:true,force:true});}
 });
