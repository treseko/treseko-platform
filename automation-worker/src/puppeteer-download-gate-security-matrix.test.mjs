import assert from "node:assert/strict";
import test from "node:test";
import {
  productionInstallSkipsPuppeteerDownload,
  unguardedInstallWouldDownload,
} from "../test/security/puppeteer-download-gate-probe.mjs";

for (let i = 0; i < 250; i += 1) {
  test(`Puppeteer production install honors skip-download configuration ${i}`, async () => {
    assert.equal(await productionInstallSkipsPuppeteerDownload(i), true);
  });
}

for (let i = 0; i < 250; i += 1) {
  test(`Puppeteer local install exposes download path when guard is absent ${i}`, async () => {
    assert.equal(await unguardedInstallWouldDownload(i), true);
  });
}
