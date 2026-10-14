import assert from "node:assert/strict";
import test from "node:test";
import { acceptNormalArchive, cleanupArchiveCorpus, rejectEntryTraversal, rejectPreexistingSymlink, rejectSymlinkTraversal } from "../test/security/extract-zip-probe.mjs";

for (let i = 0; i < 250; i += 1) {
  test(`Puppeteer browser archive extracts contained file ${i}`, async () => {
    assert.equal(await acceptNormalArchive(i), true);
  });
}

for (let i = 0; i < 250; i += 1) {
  test(`Puppeteer browser archive blocks parent path traversal ${i}`, async () => {
    assert.equal(await rejectEntryTraversal(i), true, "archive entry overwrote a sentinel outside the extraction directory");
  });
}

for (let i = 0; i < 250; i += 1) {
  test(`Puppeteer browser archive does not follow a preexisting symlink ${i}`, async () => {
    assert.equal(await rejectPreexistingSymlink(i), true, "archive entry overwrote a sentinel through a preexisting destination symlink");
  });
}

for (let i = 0; i < 250; i += 1) {
  test(`Puppeteer browser archive blocks duplicate-name symlink write ${i}`, async () => {
    assert.equal(await rejectSymlinkTraversal(i), true, "outside sentinel was overwritten through the duplicate-name symlink");
  });
}

test.after(cleanupArchiveCorpus);
