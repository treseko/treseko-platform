import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { sanitizeRecordedPlaywrightScript, hasRecordedPlaywrightAction, createPlaywrightRecorder } from "./playwright-recorder.mjs";

test("sanitizes entered values and replaces the recorded entry URL with the environment variable", () => {
  const generated = [
    "import { test, expect } from '@playwright/test';",
    "test('test', async ({ page }) => {",
    "  await page.goto('https://qa.example.test/login?access_token=do-not-keep');",
    "  await page.getByLabel('Password').fill('real-password');",
    "  await page.getByLabel('One time code').pressSequentially('123456');",
    "  await page.getByLabel('Country').selectOption('private-value');",
    "  await page.locator('input[type=file]').setInputFiles('/Users/jose/private/report.pdf');",
    "  await page.goto('https://qa.example.test/continue?access_token=second-secret#private');",
    "});",
  ].join("\n");

  const sanitized = sanitizeRecordedPlaywrightScript(generated);
  assert.match(sanitized, /page\.goto\(variables\.base_url\)/);
  assert.match(sanitized, /Password'\)\.fill\(''\)/);
  assert.match(sanitized, /One time code'\)\.pressSequentially\(''\)/);
  assert.match(sanitized, /Country'\)\.selectOption\(''\)/);
  assert.match(sanitized, /setInputFiles\(''\)/);
  assert.match(sanitized, /https:\/\/qa\.example\.test\/continue\/?'/);
  assert.doesNotMatch(sanitized, /do-not-keep|real-password|123456|private-value|second-secret|private\/report\.pdf/);
});

test("recognizes only real browser interactions, not Codegen's navigation scaffold", () => {
  assert.equal(hasRecordedPlaywrightAction("await page.goto(variables.base_url);"), false);
  assert.equal(hasRecordedPlaywrightAction("await page.getByRole('button').click();"), true);
  assert.equal(hasRecordedPlaywrightAction("await page.getByLabel('Name').fill('');"), true);
});

test("returns a sanitized Codegen script and removes the temporary workspace", async () => {
  const events = new EventEmitter();
  const writes = [];
  let removed = false;
  const fs = {
    mkdtempSync: () => "/tmp/treseko-recorder-test",
    chmodSync: () => {},
    existsSync: () => true,
    readFileSync: () => "await page.goto('https://qa.example.test'); await page.getByLabel('Password').fill('secret');",
    rmSync: (_dir, options) => { removed = options.recursive && options.force; },
  };
  const record = createPlaywrightRecorder({
    fs,
    spawn: (_executable, args) => {
      writes.push(args);
      queueMicrotask(() => events.emit("close", 0, null));
      return events;
    },
    cliPath: () => "/worker/node_modules/playwright/cli.js",
    api: async () => ({ action: "STOP" }),
    sleep: async () => {},
    now: (() => { let value = 1000; return () => value++; })(),
  });

  const result = await record({
    id: "recording-id",
    lease_token: "valid-lease",
    timeout_seconds: 60,
    payload_congelado: { url: "https://qa.example.test" },
  });

  assert.equal(result.status, "PASSED");
  assert.match(result.metadata.recorded_script, /variables\.base_url/);
  assert.doesNotMatch(result.metadata.recorded_script, /secret/);
  assert.equal(writes[0][1], "codegen");
  assert.equal(removed, true);
});

test("rejects a recording with navigation only and removes the temporary workspace", async () => {
  const events = new EventEmitter();
  let removed = false;
  const fs = {
    mkdtempSync: () => "/tmp/treseko-recorder-empty-test",
    chmodSync: () => {},
    existsSync: () => true,
    readFileSync: () => "import { test } from '@playwright/test'; test('test', async ({ page }) => { await page.goto('https://qa.example.test'); });",
    rmSync: (_dir, options) => { removed = options.recursive && options.force; },
  };
  const record = createPlaywrightRecorder({
    fs,
    spawn: () => { queueMicrotask(() => events.emit("close", 0, null)); return events; },
    cliPath: () => "/worker/node_modules/playwright/cli.js",
    api: async () => ({ action: "STOP" }),
    sleep: async () => {},
    now: (() => { let value = 1000; return () => value++; })(),
  });
  const result = await record({ id: "empty-recording", timeout_seconds: 60, payload_congelado: { url: "https://qa.example.test" } });
  assert.equal(result.status, "ERROR");
  assert.match(result.error_message, /No se detectaron interacciones/);
  assert.equal(removed, true);
});
