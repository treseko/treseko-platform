import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserController } from './browser.ts';
import { videoEvidenceStore } from '../video-evidence.ts';

test('real Chromium finalizes a playable WebM for normal and dry-run browser sessions', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'treseko-browser-video-'));
  process.env.AI_VIDEO_DIR = root;
  process.env.AI_VIDEO_DISK_RESERVE_MB = '0';
  try {
    for (const temporary of [false, true]) {
      const browser = new BrowserController();
      try {
        await browser.init(true, { width: 960, height: 540 }, temporary);
        const page = browser.getPage();
        await page.setContent('<html><body><h1>Treseko video validation</h1><button>Run</button></body></html>');
        await page.waitForTimeout(900);
        await browser.close();
        const reference = browser.getVideoReference();
        assert.ok(reference);
        assert.equal(reference.temporary, temporary);
        assert.equal(Boolean(reference.expires_at), temporary);
        const video = videoEvidenceStore().resolve(reference.id);
        assert.ok(video);
        assert.equal(fs.readFileSync(video).subarray(0, 4).toString('hex'), '1a45dfa3');
        const playerBrowser = new BrowserController();
        try {
          await playerBrowser.init(true);
          const player = playerBrowser.getPage();
          await player.setContent(`<video controls src="data:video/webm;base64,${fs.readFileSync(video).toString('base64')}"></video>`);
          await player.waitForFunction(() => (document.querySelector('video')?.readyState || 0) >= 2);
          assert.ok(await player.locator('video').evaluate((element: HTMLVideoElement) => element.videoWidth > 0));
        } finally { await playerBrowser.close(); }
      } finally { await browser.close(); }
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('recording can be disabled without preventing browser execution', async () => {
 const browser = new BrowserController();
 try {
 await browser.init(true, {width:960,height:540}, true, false);
 await browser.getPage().setContent('<h1>No recording requested</h1>');
 assert.equal(await browser.getPage().locator('h1').textContent(),'No recording requested');
 } finally {await browser.close();}
 assert.equal(browser.getVideoReference(),null);
 assert.equal(browser.getVideoStatus(),'DISABLED');
});
