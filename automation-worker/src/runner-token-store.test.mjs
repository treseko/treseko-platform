import test from "node:test";
import assert from "node:assert/strict";
import {readRunnerToken} from "./runner-token-store.mjs";

test("el token persistido y rotado prevalece sobre el bootstrap del entorno", () => {
  const fs = {
    existsSync: () => true,
    readFileSync: () => "rotated-token\n",
  };
  assert.equal(readRunnerToken(fs, "/state/.runner-token", "revoked-bootstrap-token"), "rotated-token");
});

test("usa el token bootstrap si todavía no existe un token persistido", () => {
  const fs = {existsSync: () => false};
  assert.equal(readRunnerToken(fs, "/state/.runner-token", "initial-token"), "initial-token");
});

test("un archivo persistido vacío no oculta el token bootstrap", () => {
  const fs = {existsSync: () => true, readFileSync: () => "  \n"};
  assert.equal(readRunnerToken(fs, "/state/.runner-token", "initial-token"), "initial-token");
});
