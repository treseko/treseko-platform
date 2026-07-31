export function createReportRuntime(deps) {
  const {
    performance, RUNNER_NAME, os, shouldRunHeadless, getPackageVersion,
    redactTraceText, artifactFromBuffer, getCorrelationId,
  } = deps;

function classifyProcessFailure(output, timedOut) {
  if (timedOut) return "TIMEOUT";
  const text = String(output || "");
  if (/AssertionError|assertion failed|expected .* to|Timed out retrying|cy\..*failed|expect\(.*\)/i.test(text)) {
    return "FAILED";
  }
  if (/SyntaxError|ReferenceError|ImportError|ModuleNotFoundError|Cannot find module|ERR_MODULE|No tests found|Can't run because|Executable doesn't exist|WebDriverException|SessionNotCreatedException/i.test(text)) {
    return "ERROR";
  }
  return "FAILED";
}

function processResultPayload({ job, framework, started, result, successObservation, failureObservation, metadata = {}, artifacts = [] }) {
  const output = redact([result.stdout, result.stderr].filter(Boolean).join("\n"));
  const status = result.code === 0 ? "PASSED" : classifyProcessFailure(output, result.timedOut);
  return {
    status,
    duration_seconds: Math.round((performance.now() - started) / 1000),
    observations: status === "PASSED"
      ? successObservation
      : result.timedOut
        ? "La ejecucion supero el timeout configurado."
        : failureObservation,
    logs: output,
    error_message: status === "PASSED" ? null : output,
    metadata: {
      worker: RUNNER_NAME,
      framework,
      framework_version: getPackageVersion(framework === "selenium" ? "selenium-webdriver" : framework),
      headless: shouldRunHeadless(job),
      os: os.type(),
      ...metadata,
    },
    artifacts,
    steps: [],
  };
}

function redact(text) {
  return redactTraceText(text || "");
}

function withCorrelation(result) {
  return {
    ...result,
    correlation_id: activeCorrelationId,
    ...(result.status === "ERROR" || result.status === "TIMEOUT"
      ? { error_code: result.error_code || (result.status === "TIMEOUT" ? "WORKER_TIMEOUT" : "WORKER_EXECUTION_ERROR") }
      : {}),
  };
}

function isAssertionLike(error) {
  const name = String(error?.name || "");
  const message = String(error?.message || "");
  return name.includes("Assertion") || message.includes("strictEqual") || message.includes("not ok");
}

function normalizeJobStatus(status) {
  const value = String(status || "PASSED").trim().toUpperCase();
  if (["PASS", "PASO", "PASSED", "OK"].includes(value)) return "PASSED";
  if (["FAIL", "FALLO", "FAILED"].includes(value)) return "FAILED";
  if (["BLOCK", "BLOQUEADO", "BLOCKED"].includes(value)) return "BLOCKED";
  if (["ERROR", "TIMEOUT", "CANCELLED"].includes(value)) return value;
  return "PASSED";
}

function normalizeStepStatus(status) {
  const value = String(status || "PASO").trim().toUpperCase();
  if (["PASS", "PASSED", "PASO", "OK"].includes(value)) return "PASO";
  if (["FAIL", "FAILED", "FALLO"].includes(value)) return "FALLO";
  if (["BLOCK", "BLOCKED", "BLOQUEADO"].includes(value)) return "BLOQUEADO";
  if (value === "SIN_CORRER") return "SIN_CORRER";
  return "PASO";
}

function normalizeStepResult(step, index) {
  return {
    number: Number(step?.number ?? step?.numero_paso ?? step?.step ?? index + 1),
    status: normalizeStepStatus(step?.status ?? step?.estado ?? step?.resultado),
    observations: step?.observations ?? step?.observaciones ?? step?.comment ?? step?.comentarios ?? null,
    evidence_url: step?.evidence_url ?? step?.evidencia_url ?? null,
    error_log: step?.error_log ?? step?.errorLog ?? step?.error ?? null,
  };
}

function classifyPlaywrightFailure(output, timedOut) {
  if (timedOut) return "TIMEOUT";
  const text = String(output || "");
  if (/SyntaxError|ReferenceError|Cannot find module|Executable doesn't exist|No tests found|Error: Cannot|ERR_MODULE/i.test(text)) {
    return "ERROR";
  }
  return "FAILED";
}

function parsePlaywrightJsonReport(stdout) {
  const text = String(stdout || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function decodePlaywrightOutputItem(item) {
  if (!item) return "";
  if (typeof item.text === "string") return item.text;
  if (typeof item.buffer === "string") {
    try {
      return Buffer.from(item.buffer, "base64").toString("utf8");
    } catch {
      return item.buffer;
    }
  }
  return "";
}

function collectPlaywrightTests(report) {
  const tests = [];
  const visitSuite = (suite, parents = []) => {
    const suiteTitle = suite?.title ? [...parents, suite.title] : parents;
    for (const spec of suite?.specs || []) {
      const titleParts = [...suiteTitle, spec.title].filter(Boolean);
      for (const test of spec.tests || []) {
        for (const result of test.results || []) {
          tests.push({
            title: titleParts.join(" > "),
            status: result.status || test.status || "unknown",
            expected_status: test.expectedStatus || "passed",
            duration_ms: Number(result.duration || 0),
            worker_index: result.workerIndex,
            retry: result.retry,
            errors: (result.errors || []).map((error) => error.message || error.stack || String(error)).filter(Boolean),
            stdout: (result.stdout || []).map(decodePlaywrightOutputItem).filter(Boolean),
            stderr: (result.stderr || []).map(decodePlaywrightOutputItem).filter(Boolean),
          });
        }
      }
    }
    for (const child of suite?.suites || []) {
      visitSuite(child, suiteTitle);
    }
  };
  for (const suite of report?.suites || []) {
    visitSuite(suite);
  }
  return tests;
}

function playwrightReportStatus(report, tests) {
  const explicitStatus = report?.stats?.status || report?.status;
  if (explicitStatus) return explicitStatus;
  if (!tests || tests.length === 0) {
    return (report?.errors || []).length > 0 ? "error" : "unknown";
  }
  const statuses = tests.map((test) => String(test.status || "").toLowerCase());
  if (statuses.some((status) => ["failed", "unexpected"].includes(status))) return "failed";
  if (statuses.some((status) => ["timedout", "timedOut".toLowerCase()].includes(status))) return "timedOut";
  if (statuses.some((status) => status === "interrupted")) return "interrupted";
  if (statuses.every((status) => status === "skipped")) return "skipped";
  if (statuses.every((status) => ["passed", "skipped"].includes(status))) return "passed";
  return "unknown";
}

function summarizePlaywrightReport(report, stderr = "") {
  if (!report) return null;
  const tests = collectPlaywrightTests(report);
  const stats = report.stats || {};
  const overallStatus = playwrightReportStatus(report, tests);
  const lines = [];
  lines.push("Respuesta de Playwright");
  lines.push("=======================");
  lines.push(`Estado general: ${String(overallStatus).toUpperCase()}`);
  lines.push(`Inicio: ${stats.startTime || "-"}`);
  lines.push(`Duracion: ${Math.round(Number(stats.duration || 0))} ms`);
  lines.push(`Tests detectados: ${tests.length}`);
  lines.push("");

  if (tests.length > 0) {
    lines.push("Resultados por test:");
    for (const test of tests) {
      lines.push(`- ${String(test.status).toUpperCase()} | ${test.title} | ${test.duration_ms} ms`);
      if (test.stdout.length > 0) {
        lines.push("  stdout:");
        for (const value of test.stdout) lines.push(`  ${value.trim()}`);
      }
      if (test.stderr.length > 0) {
        lines.push("  stderr:");
        for (const value of test.stderr) lines.push(`  ${value.trim()}`);
      }
      if (test.errors.length > 0) {
        lines.push("  errores:");
        for (const value of test.errors) lines.push(`  ${value.trim()}`);
      }
    }
  }

  if ((report.errors || []).length > 0) {
    lines.push("");
    lines.push("Errores del runner:");
    for (const error of report.errors) {
      lines.push(`- ${(error.message || error.stack || String(error)).trim()}`);
    }
  }

  if (stderr) {
    lines.push("");
    lines.push("stderr del proceso:");
    lines.push(String(stderr).trim());
  }

  return { text: lines.join("\n"), tests };
}

function compactPlaywrightMetadata(report, tests = []) {
  const stats = report?.stats || {};
  return {
    status: playwrightReportStatus(report, tests),
    stats: {
      start_time: stats.startTime || null,
      duration_ms: Math.round(Number(stats.duration || 0)),
      expected: Number(stats.expected || 0),
      unexpected: Number(stats.unexpected || 0),
      skipped: Number(stats.skipped || 0),
      flaky: Number(stats.flaky || 0),
    },
    tests: tests.slice(0, 50).map((test) => ({
      title: test.title,
      status: test.status,
      expected_status: test.expected_status,
      duration_ms: test.duration_ms,
      retry: test.retry,
      errors_count: Array.isArray(test.errors) ? test.errors.length : 0,
    })),
    errors_count: Array.isArray(report?.errors) ? report.errors.length : 0,
  };
}

function playwrightReportArtifact(report, job) {
  if (!report) return null;
  return artifactFromBuffer({
    filename: `playwright-report-${String(job.id).slice(0, 8)}.json`,
    contentType: "application/json",
    buffer: Buffer.from(JSON.stringify(report, null, 2), "utf8"),
    type: "report",
  });
}

  return {
    classifyProcessFailure, processResultPayload, redact, withCorrelation,
    isAssertionLike, normalizeJobStatus, normalizeStepStatus, normalizeStepResult,
    classifyPlaywrightFailure, parsePlaywrightJsonReport, decodePlaywrightOutputItem,
    collectPlaywrightTests, playwrightReportStatus, summarizePlaywrightReport,
    compactPlaywrightMetadata, playwrightReportArtifact,
  };
}
