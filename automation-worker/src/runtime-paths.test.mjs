import assert from "node:assert/strict";
import test from "node:test";
import { resultSpoolDirectory } from "./runtime-paths.mjs";

test("defaults the legacy Docker worker to its already-persistent runtime volume", () => {
  assert.equal(resultSpoolDirectory({ env: {}, rootDir: "/worker" }), "/worker/.state/result-spool");
});

test("preserves an explicitly configured result spool", () => {
  assert.equal(
    resultSpoolDirectory({ env: { QA_RESULT_SPOOL_DIR: "/custom/spool" }, rootDir: "/worker" }),
    "/custom/spool",
  );
});
