import assert from "node:assert/strict";
import test from "node:test";

import {
  artifactFromBuffer,
  classifyPlaywrightFailure,
  classifyProcessFailure,
  collectPlaywrightTests,
  compactPlaywrightMetadata,
  contentTypeForFile,
  detectScriptFormat,
  frameworkKey,
  getValue,
  isAssertionLike,
  languageKey,
  normalizeDataset,
  normalizeJobStatus,
  normalizeStepResult,
  normalizeStepStatus,
  parsePlaywrightJsonReport,
  playwrightReportStatus,
  redact,
  replacePlaceholders,
  safeJsonParse,
} from "./worker.mjs";

const jobStatuses = new Map([
  ["PASS", "PASSED"], ["PASO", "PASSED"], ["PASSED", "PASSED"], ["OK", "PASSED"],
  ["FAIL", "FAILED"], ["FALLO", "FAILED"], ["FAILED", "FAILED"],
  ["BLOCK", "BLOCKED"], ["BLOQUEADO", "BLOCKED"], ["BLOCKED", "BLOCKED"],
  ["ERROR", "ERROR"], ["TIMEOUT", "TIMEOUT"], ["CANCELLED", "CANCELLED"],
]);

for (const [input, expected] of jobStatuses) {
  for (const decorated of [input, input.toLowerCase(), `  ${input}  `]) {
    test(`normaliza estado de job ${JSON.stringify(decorated)}`, () => {
      assert.equal(normalizeJobStatus(decorated), expected);
    });
  }
}

const stepStatuses = new Map([
  ["PASS", "PASO"], ["PASSED", "PASO"], ["PASO", "PASO"], ["OK", "PASO"],
  ["FAIL", "FALLO"], ["FAILED", "FALLO"], ["FALLO", "FALLO"],
  ["BLOCK", "BLOQUEADO"], ["BLOCKED", "BLOQUEADO"], ["BLOQUEADO", "BLOQUEADO"],
  ["SIN_CORRER", "SIN_CORRER"],
]);

for (const [input, expected] of stepStatuses) {
  test(`normaliza estado de paso ${input}`, () => assert.equal(normalizeStepStatus(input), expected));
}

const contentTypes = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  txt: "text/plain", json: "application/json", csv: "text/csv", xml: "application/xml",
  pdf: "application/pdf", zip: "application/zip", xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", mp4: "video/mp4", webm: "video/webm",
};

for (const [extension, expected] of Object.entries(contentTypes)) {
  test(`content type controlado .${extension}`, () => {
    assert.equal(contentTypeForFile(`/tmp/EVIDENCE.${extension.toUpperCase()}`), expected);
  });
}

for (let seed = 1; seed <= 128; seed += 1) {
  test(`reemplazo de variables controlado ${seed}`, () => {
    const variables = { id: seed, [`value-${seed}`]: `result-${seed}`, nested: `short-${seed}` };
    const template = `id={{ id }} value={{ value-${seed} }} nested={{scope.nested}} missing={{missing}}`;
    assert.equal(replacePlaceholders(template, variables), `id=${seed} value=result-${seed} nested=short-${seed} missing=`);
    assert.equal(getValue(variables, "scope.nested"), `short-${seed}`);
  });

  test(`dataset controlado ${seed}`, () => {
    assert.deepEqual(normalizeDataset([{ key: `key-${seed}`, value: seed }, { key: "empty" }]), {
      [`key-${seed}`]: seed,
      empty: "",
    });
    assert.deepEqual(normalizeDataset({ seed, active: seed % 2 === 0 }), { seed, active: seed % 2 === 0 });
  });
}

test("redacción cubre secretos comunes sin destruir el resto", () => {
  const value = "password=uno token=dos secret=tres key=cuatro visible=cinco";
  assert.equal(redact(value), "password=[redacted] token=[redacted] secret=[redacted] key=[redacted] visible=cinco");
});

test("formatos de script se detectan sin ejecución", () => {
  assert.equal(detectScriptFormat("test('x', async () => {})"), "playwright_test");
  assert.equal(detectScriptFormat("expect(value).toBe(true)"), "playwright_test");
  assert.equal(detectScriptFormat("async ({ page }) => page.goto('/')"), "worker_function");
});

test("framework y lenguaje respetan aliases controlados", () => {
  assert.equal(frameworkKey({ payload_congelado: { framework: "Playwright@1.60" } }), "playwright");
  assert.equal(frameworkKey({ required_framework: "selenium:4" }), "selenium");
  assert.equal(languageKey({ payload_congelado: { framework: "selenium", language: "py" } }), "py");
  assert.equal(languageKey({ payload_congelado: { framework: "playwright", language: "ts" } }), "typescript");
});

test("artefactos vacíos o sobredimensionados se rechazan", () => {
  assert.equal(artifactFromBuffer({ filename: "empty.png", buffer: Buffer.alloc(0) }), null);
  assert.equal(artifactFromBuffer({ filename: "large.png", buffer: Buffer.alloc(10 * 1024 * 1024 + 1) }), null);
  const artifact = artifactFromBuffer({ filename: "ok.txt", contentType: "text/plain", buffer: Buffer.from("ok"), type: "evidence", stepNumber: 2 });
  assert.deepEqual(artifact, { type: "evidence", filename: "ok.txt", content_type: "text/plain", base64: "b2s=", step_number: 2 });
});

test("parsers JSON controlados", () => {
  assert.deepEqual(safeJsonParse('{"ok":true}'), { ok: true });
  assert.equal(safeJsonParse("not-json"), "not-json");
  assert.equal(safeJsonParse(""), null);
  assert.deepEqual(parsePlaywrightJsonReport('prefix\n{"status":"passed"}\nsuffix'), { status: "passed" });
  assert.equal(parsePlaywrightJsonReport("invalid"), null);
});

test("clasificación de fallos distingue timeout, aserción e infraestructura", () => {
  assert.equal(classifyProcessFailure("", true), "TIMEOUT");
  assert.equal(classifyProcessFailure("AssertionError: expected 1 to equal 2", false), "FAILED");
  assert.equal(classifyProcessFailure("SyntaxError: unexpected token", false), "ERROR");
  assert.equal(classifyPlaywrightFailure("Executable doesn't exist", false), "ERROR");
  assert.equal(classifyPlaywrightFailure("expect(received).toBe(expected)", false), "FAILED");
  assert.equal(isAssertionLike({ name: "AssertionError", message: "boom" }), true);
});

test("reporte Playwright conserva jerarquía y metadatos acotados", () => {
  const report = {
    stats: { startTime: "2026-07-23T00:00:00Z", duration: 125, expected: 1, unexpected: 0, skipped: 0, flaky: 0 },
    suites: [{ title: "Raíz", specs: [{ title: "Caso", tests: [{ expectedStatus: "passed", results: [{ status: "passed", duration: 123, retry: 0, errors: [], stdout: [{ text: "ok" }], stderr: [] }] }] }] }],
    errors: [],
  };
  const tests = collectPlaywrightTests(report);
  assert.equal(tests.length, 1);
  assert.equal(tests[0].title, "Raíz > Caso");
  assert.equal(playwrightReportStatus(report, tests), "passed");
  assert.deepEqual(compactPlaywrightMetadata(report, tests), {
    status: "passed",
    stats: { start_time: "2026-07-23T00:00:00Z", duration_ms: 125, expected: 1, unexpected: 0, skipped: 0, flaky: 0 },
    tests: [{ title: "Raíz > Caso", status: "passed", expected_status: "passed", duration_ms: 123, retry: 0, errors_count: 0 }],
    errors_count: 0,
  });
});

test("resultado de paso acepta nombres en español e inglés", () => {
  assert.deepEqual(normalizeStepResult({ numero_paso: "3", estado: "fallo", observaciones: "dato", evidencia_url: "https://evidence.test/a", errorLog: "boom" }, 0), {
    number: 3,
    status: "FALLO",
    observations: "dato",
    evidence_url: "https://evidence.test/a",
    error_log: "boom",
  });
});
