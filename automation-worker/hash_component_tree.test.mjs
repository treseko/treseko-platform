import assert from "node:assert/strict";
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import test from "node:test";

const hashScript = path.join(path.dirname(new URL(import.meta.url).pathname), "hash_component_tree.sh");

function digest(root) {
  const result = spawnSync("sh", [hashScript, root], {encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test("worker content digest ignores signed self-update overlays, not worker source", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "treseko-worker-digest-"));
  try {
    writeFileSync(path.join(root, "src-worker.mjs"), "stable source\n");
    const before = digest(root);

    writeFileSync(path.join(root, "VERSION"), "1.0.8\n");
    writeFileSync(path.join(root, "package.json"), '{"version":"1.0.8"}\n');
    writeFileSync(path.join(root, "package-lock.json"), "runtime lock\n");
    writeFileSync(path.join(root, "worker-launcher.mjs"), "signed runtime launcher\n");
    writeFileSync(path.join(root, "entrypoint.sh"), "signed runtime entrypoint\n");
    writeFileSync(path.join(root, ".treseko-active-worker-release.json"), '{"schema":1}\n');
    mkdirSync(path.join(root, ".worker-releases", "1.0.8-aaaaaaaaaaaa"), {recursive: true});
    writeFileSync(path.join(root, ".worker-releases", "1.0.8-aaaaaaaaaaaa", "src-worker.mjs"), "signed release source\n");

    assert.equal(digest(root), before);
    writeFileSync(path.join(root, "src-worker.mjs"), "changed source\n");
    assert.notEqual(digest(root), before);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
