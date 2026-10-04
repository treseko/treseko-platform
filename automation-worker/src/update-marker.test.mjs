import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createUpdateMarker } from "./update-marker.mjs";

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "treseko-update-marker-"));
}

function quietLog() {
  return { info() {}, warn() {}, error() {} };
}

test("la marca de update se consume y termina el proceso sin heartbeat", () => {
  const directory = fixture();
  fs.writeFileSync(path.join(directory, ".treseko-update-restart"), "");
  const exits = [];
  const marker = createUpdateMarker({
    directory,
    getActiveJobs: () => 0,
    deps: { exit: code => exits.push(code), log: quietLog() },
  });

  assert.equal(marker.consumeIfReady(), true);
  assert.deepEqual(exits, [0]);
  assert.equal(fs.existsSync(marker.restartPath), false);
});

test("no se consume la marca mientras hay trabajos activos", () => {
  const directory = fixture();
  fs.writeFileSync(path.join(directory, ".treseko-update-restart"), "");
  const exits = [];
  const marker = createUpdateMarker({
    directory,
    getActiveJobs: () => 2,
    deps: { exit: code => exits.push(code), log: quietLog() },
  });

  assert.equal(marker.consumeIfReady(), false);
  assert.deepEqual(exits, []);
  assert.equal(fs.existsSync(marker.restartPath), true);
});

test("un rollback pendiente bloquea el consumo de la marca", () => {
  const directory = fixture();
  fs.writeFileSync(path.join(directory, ".treseko-update-restart"), "");
  fs.writeFileSync(path.join(directory, ".treseko-update-rollback"), "");
  const exits = [];
  const marker = createUpdateMarker({
    directory,
    getActiveJobs: () => 0,
    deps: { exit: code => exits.push(code), log: quietLog() },
  });

  assert.equal(marker.consumeIfReady(), false);
  assert.deepEqual(exits, []);
  assert.equal(fs.existsSync(marker.restartPath), true);
});

test("sin marca no hace nada", () => {
  const directory = fixture();
  const exits = [];
  const marker = createUpdateMarker({
    directory,
    getActiveJobs: () => 0,
    deps: { exit: code => exits.push(code), log: quietLog() },
  });

  assert.equal(marker.consumeIfReady(), false);
  assert.deepEqual(exits, []);
});

test("si la marca no se puede borrar no se termina el proceso", () => {
  const directory = fixture();
  fs.writeFileSync(path.join(directory, ".treseko-update-restart"), "");
  const exits = [];
  const marker = createUpdateMarker({
    directory,
    getActiveJobs: () => 0,
    deps: {
      exit: code => exits.push(code),
      unlinkSync() { throw new Error("EACCES"); },
      log: quietLog(),
    },
  });

  assert.equal(marker.consumeIfReady(), false);
  assert.deepEqual(exits, []);
});
