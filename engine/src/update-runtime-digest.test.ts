import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const digestScript = path.resolve(import.meta.dirname, "../hash_component_tree.sh");

function digest(root: string): string {
  return execFileSync("sh", [digestScript, root], { encoding: "utf8" }).trim();
}

test("persistent Engine update-control bind state is excluded from the code digest", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "treseko-engine-runtime-digest-"));
  try {
    fs.writeFileSync(path.join(root, "VERSION"), "1.0.4\n");
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src", "server.ts"), "export const version = '1.0.4';\n");
    const codeDigest = digest(root);

    const control = path.join(root, "update-control");
    fs.mkdirSync(control);
    fs.writeFileSync(path.join(control, ".treseko-engine-update-fence"),
                     '{"schema":1,"transaction":"update-1"}\n', { mode: 0o600 });
    fs.writeFileSync(path.join(control, ".fixture-sentinel"), "operational state\n");
    assert.equal(digest(root), codeDigest);

    fs.writeFileSync(path.join(root, "src", "server.ts"), "export const version = '1.0.5';\n");
    assert.notEqual(digest(root), codeDigest);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
