import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readOrCreateWorkerInstanceId } from "./worker-instance-id.mjs";

test("persists and reuses the worker identity across relink attempts", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "treseko-worker-id-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, ".worker-instance-id");
  const first = readOrCreateWorkerInstanceId({ fs, path, file });
  const second = readOrCreateWorkerInstanceId({ fs, path, file, randomId: () => assert.fail("must reuse persisted identity") });
  assert.equal(first, second);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test("does not silently replace a missing persistent identity store with a new ID", () => {
  const unavailableFs = { existsSync: () => false, writeFileSync: () => { const error = new Error("read only"); error.code = "EROFS"; throw error; } };
  assert.throws(() => readOrCreateWorkerInstanceId({
    fs: unavailableFs, path, file: "/readonly/worker/.worker-instance-id", randomId: randomUUID,
  }), /No se pudo leer o guardar la identidad persistente/);
});

test("rejects a corrupted identity instead of creating a duplicate registration", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "treseko-worker-id-corrupt-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, ".worker-instance-id");
  fs.writeFileSync(file, "not-a-uuid\n");
  assert.throws(() => readOrCreateWorkerInstanceId({ fs, path, file }), /identidad persistente del Worker no es válida/);
});

test("rejects a symbolic link as the persistent worker identity", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "treseko-worker-id-link-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const target = path.join(directory, "identity-target");
  const file = path.join(directory, ".worker-instance-id");
  fs.writeFileSync(target, `${randomUUID()}\n`);
  fs.symlinkSync(target, file);
  assert.throws(() => readOrCreateWorkerInstanceId({ fs, path, file }), /no es un archivo regular/);
});
