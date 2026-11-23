import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
import {readWorkerVersion} from "./worker-runtime-info.mjs";

test("la version del codigo activo prevalece sobre variables heredadas del proceso anterior", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "treseko-worker-version-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const activeRelease = path.join(root, ".worker-releases", "1.0.8-aaaaaaaaaaaa");
  fs.mkdirSync(activeRelease, {recursive: true});
  fs.writeFileSync(path.join(activeRelease, "VERSION"), "1.0.8\n");
  fs.writeFileSync(path.join(root, "VERSION"), "1.0.7\n");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({version: "1.0.7"}));

  assert.equal(readWorkerVersion({
    candidates: [
      path.join(activeRelease, "VERSION"),
      path.join(root, "VERSION"),
      "1.0.7",
      "1.0.7",
    ],
    fs,
    require: createRequire(import.meta.url),
    packagePath: path.join(root, "package.json"),
  }), "1.0.8");
});
