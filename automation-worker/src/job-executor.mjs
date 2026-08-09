import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

function cleanupWorkspace(workspace) {
  try {
    fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    // La limpieza no debe reemplazar el resultado del job ni sacar al worker del loop.
    console.warn(`No se pudo limpiar el workspace temporal ${workspace}: ${error?.message || error}`);
  }
}

export function createJobExecutor(deps) {
  const {
    RUNNER_NAME, ROOT_DIR, state,
    playwrightBrowserForJob, scriptFileForJob, preparePlaywrightTestSource,
    shouldRunHeadless, getPlaywrightCliPath, runCommand, parsePlaywrightJsonReport,
    summarizePlaywrightReport, compactPlaywrightMetadata, classifyPlaywrightFailure, withCorrelation,
    collectArtifacts, playwrightReportArtifact, getPlaywrightVersion, isDebugMode,
    processResultPayload, prepareNodeScriptSource, getPackageBinPath,
    serializeJsonForSource, prepareSeleniumPythonSource, getPythonCommand,
    compileScript, normalizeDataset, normalizeStepResult, normalizeJobStatus,
    isAssertionLike, artifactFromBuffer, formatLogArg, formatErrorDetail,
    redact, replacePlaceholders, frameworkKey, languageKey, localWorkerSupports,
    detectScriptFormat, setActiveCorrelationId,
  } = deps;

async function executePlaywrightTestJob(job, script, variables, started) {
  const payload = job.payload_congelado || {};
  const browserName = playwrightBrowserForJob(job, variables);
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "qa-worker-"));
  const specFile = scriptFileForJob(job, script).endsWith(".ts") ? "job.spec.ts" : "job.spec.js";
  const specPath = path.join(workspace, specFile);
  const configPath = path.join(workspace, "playwright.config.cjs");
  const timeoutMs = Math.max(1, Number(job.timeout_seconds || payload.timeout_seconds || 300)) * 1000;
  try {
    fs.writeFileSync(specPath, preparePlaywrightTestSource(script, variables), "utf8");
    fs.writeFileSync(configPath, [
      "module.exports = {",
      `  timeout: ${timeoutMs},`,
      "  use: {",
      `    browserName: ${JSON.stringify(browserName)},`,
      `    headless: ${shouldRunHeadless(job) ? "true" : "false"},`,
      "    screenshot: 'only-on-failure'",
      "  }",
      "};",
    ].join("\n"), "utf8");
    const playwrightCli = getPlaywrightCliPath();
    const result = await runCommand(
      process.execPath,
      [
        playwrightCli,
        "test",
        specFile,
        "--reporter=json",
        "--config",
        configPath,
        shouldRunHeadless(job) ? "" : "--headed",
      ].filter(Boolean),
      {
        cwd: workspace,
        timeoutMs,
        env: {
          ...process.env,
          QA_WORKER_JOB_ID: job.id,
          QA_WORKER_DRY_RUN: payload.dry_run ? "true" : "false",
          QA_ARTIFACTS_DIR: workspace,
        },
      }
    );
    const report = parsePlaywrightJsonReport(result.stdout);
    const summary = summarizePlaywrightReport(report, result.stderr);
    const combined = [
      summary?.text,
      !report ? result.stdout : null,
      result.stderr,
    ].filter(Boolean).join("\n");
    const testStatuses = summary?.tests?.map((test) => test.status) || [];
    const hasFunctionalFailure = testStatuses.some((status) => ["failed", "timedOut", "interrupted"].includes(status));
    const status = result.code === 0
      ? "PASSED"
      : report && hasFunctionalFailure
        ? "FAILED"
        : classifyPlaywrightFailure(combined, result.timedOut);
    return withCorrelation({
      status,
      duration_seconds: Math.round((performance.now() - started) / 1000),
      observations: status === "PASSED"
        ? "Playwright Test finalizo correctamente."
        : result.timedOut
          ? "La ejecucion supero el timeout configurado."
          : "Playwright Test finalizo con errores.",
      logs: redact(combined),
      error_message: status === "PASSED" ? null : redact(combined),
      metadata: {
        worker: RUNNER_NAME,
        framework: payload.framework || "playwright",
        browser: browserName,
        framework_version: getPlaywrightVersion(),
        script_format: "playwright_test",
        playwright_report: report ? compactPlaywrightMetadata(report, summary?.tests || []) : null,
        headless: shouldRunHeadless(job),
        debug_mode: isDebugMode(job),
        os: os.type(),
      },
      artifacts: [
        playwrightReportArtifact(report, job),
        ...collectArtifacts(workspace),
      ].filter(Boolean),
      steps: [],
    });
  } finally {
    cleanupWorkspace(workspace);
  }
}

async function executePuppeteerJob(job, script, variables, started) {
  const payload = job.payload_congelado || {};
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "qa-worker-puppeteer-"));
  const scriptFile = scriptFileForJob(job, script);
  const scriptPath = path.join(workspace, scriptFile);
  const timeoutMs = Math.max(1, Number(job.timeout_seconds || payload.timeout_seconds || 300)) * 1000;
  try {
    fs.writeFileSync(scriptPath, prepareNodeScriptSource(script, variables, job, "puppeteer"), "utf8");
    const tsxCli = getPackageBinPath("tsx", "dist/cli.mjs");
    const result = await runCommand(process.execPath, [tsxCli, scriptPath], {
      cwd: workspace,
      timeoutMs,
      env: {
        ...process.env,
        NODE_PATH: path.join(ROOT_DIR, "node_modules"),
        QA_WORKER_JOB_ID: job.id,
        QA_WORKER_DRY_RUN: payload.dry_run ? "true" : "false",
        QA_HEADLESS: shouldRunHeadless(job) ? "true" : "false",
        QA_ARTIFACTS_DIR: workspace,
      },
    });
    return processResultPayload({
      job,
      framework: "puppeteer",
      started,
      result,
      successObservation: "Puppeteer finalizo correctamente.",
      failureObservation: "Puppeteer finalizo con errores.",
      metadata: { script_format: "node_script" },
      artifacts: collectArtifacts(workspace),
    });
  } finally {
    cleanupWorkspace(workspace);
  }
}

async function executeCypressJob(job, script, variables, started) {
  const payload = job.payload_congelado || {};
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "qa-worker-cypress-"));
  const specPath = path.join(workspace, scriptFileForJob(job, script).endsWith(".ts") ? "job.cy.ts" : "job.cy.js");
  const configPath = path.join(workspace, "cypress.config.cjs");
  const timeoutMs = Math.max(1, Number(job.timeout_seconds || payload.timeout_seconds || 300)) * 1000;
  try {
    fs.writeFileSync(specPath, String(script || "").trim(), "utf8");
    fs.writeFileSync(configPath, [
      "const { defineConfig } = require('cypress');",
      "module.exports = defineConfig({",
      "  video: false,",
      "  screenshotOnRunFailure: true,",
      `  screenshotsFolder: ${JSON.stringify(path.join(workspace, "cypress", "screenshots").replace(/\\/g, "/"))},`,
      "  e2e: {",
      "    supportFile: false,",
      `    specPattern: ${JSON.stringify(specPath.replace(/\\/g, "/"))},`,
      `    baseUrl: ${JSON.stringify(variables.base_url || variables.BASE_URL || variables["ENV.BASE_URL"] || null)},`,
      `    env: ${serializeJsonForSource(variables)}`,
      "  }",
      "});",
    ].join("\n"), "utf8");
    const cypressBin = getPackageBinPath("cypress", path.join("bin", "cypress"));
    const result = await runCommand(process.execPath, [
      cypressBin,
      "run",
      "--config-file",
      configPath,
      "--spec",
      specPath,
      "--browser",
      "chromium",
      shouldRunHeadless(job) ? "--headless" : "--headed",
    ], {
      cwd: workspace,
      timeoutMs,
      env: {
        ...process.env,
        NODE_PATH: path.join(ROOT_DIR, "node_modules"),
        QA_WORKER_JOB_ID: job.id,
        QA_WORKER_DRY_RUN: payload.dry_run ? "true" : "false",
        QA_ARTIFACTS_DIR: workspace,
      },
    });
    return processResultPayload({
      job,
      framework: "cypress",
      started,
      result,
      successObservation: "Cypress finalizo correctamente.",
      failureObservation: "Cypress finalizo con errores.",
      metadata: { script_format: "cypress_spec" },
      artifacts: collectArtifacts(workspace),
    });
  } finally {
    cleanupWorkspace(workspace);
  }
}

async function executeSeleniumPythonJob(job, script, variables, started) {
  const payload = job.payload_congelado || {};
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "qa-worker-selenium-"));
  const scriptPath = path.join(workspace, "job.py");
  const timeoutMs = Math.max(1, Number(job.timeout_seconds || payload.timeout_seconds || 300)) * 1000;
  try {
    fs.writeFileSync(scriptPath, prepareSeleniumPythonSource(script, variables, job), "utf8");
    const result = await runCommand(getPythonCommand(), [scriptPath], {
      cwd: workspace,
      timeoutMs,
      env: {
        ...process.env,
        QA_WORKER_JOB_ID: job.id,
        QA_WORKER_DRY_RUN: payload.dry_run ? "true" : "false",
        QA_HEADLESS: shouldRunHeadless(job) ? "true" : "false",
        QA_ARTIFACTS_DIR: workspace,
      },
    });
    return processResultPayload({
      job,
      framework: "selenium",
      started,
      result,
      successObservation: "Selenium Python finalizo correctamente.",
      failureObservation: "Selenium Python finalizo con errores.",
      metadata: {
        script_format: "python_script",
        language: "python",
        python_bin: getPythonCommand(),
      },
      artifacts: collectArtifacts(workspace),
    });
  } finally {
    cleanupWorkspace(workspace);
  }
}

async function executePlaywrightWorkerFunctionJob(job, script, variables, started) {
  const logs = [];
  const payload = job.payload_congelado || {};
  const browserName = playwrightBrowserForJob(job, variables);
  let browser;
  let page;
  try {
    const { chromium, firefox, webkit } = await import("playwright");
    browser = await ({ chromium, firefox, webkit })[browserName].launch({ headless: shouldRunHeadless(job) });
    page = await browser.newPage();
    const fn = compileScript(script);
    const context = {
      page,
      browser,
      variables,
      dataset: normalizeDataset(payload.dataset),
      job,
      assert,
      log: (...args) => logs.push(args.map(formatLogArg).join(" ")),
    };
    const customResult = await fn(context);
    const steps = Array.isArray(customResult?.steps)
      ? customResult.steps.map(normalizeStepResult)
      : [];
    return {
      status: normalizeJobStatus(customResult?.status),
      duration_seconds: Math.round((performance.now() - started) / 1000),
      observations: customResult?.observations || "Worker automatizado finalizo correctamente.",
      logs: redact([logs.join("\n"), formatErrorDetail(customResult?.logs)].filter(Boolean).join("\n")),
      metadata: {
        worker: RUNNER_NAME,
        framework: payload.framework || "playwright",
        browser: browserName,
        framework_version: getPlaywrightVersion(),
        script_format: "worker_function",
        headless: shouldRunHeadless(job),
        debug_mode: isDebugMode(job),
        os: os.type(),
      },
      artifacts: Array.isArray(customResult?.artifacts) ? customResult.artifacts : [],
      steps,
    };
  } catch (error) {
    const functionalFailure = isAssertionLike(error);
    let screenshotArtifact = null;
    if (page) {
      try {
        screenshotArtifact = artifactFromBuffer({
          filename: `automation-${String(job.id).slice(0, 8)}-failure.png`,
          buffer: await page.screenshot({ fullPage: true }),
          type: "screenshot",
        });
      } catch {
        screenshotArtifact = null;
      }
    }
    return {
      status: functionalFailure ? "FAILED" : "ERROR",
      duration_seconds: Math.round((performance.now() - started) / 1000),
      observations: error?.message || "La prueba automatizada fallo.",
      logs: redact(logs.join("\n")),
      error_message: redact(error?.stack || String(error)),
      metadata: {
        worker: RUNNER_NAME,
        framework: payload.framework || "playwright",
        browser: browserName,
        framework_version: getPlaywrightVersion(),
        script_format: "worker_function",
        headless: shouldRunHeadless(job),
        debug_mode: isDebugMode(job),
        os: os.type(),
      },
      artifacts: screenshotArtifact ? [screenshotArtifact] : [],
      steps: [],
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function executeJob(job) {
  const payload = job.payload_congelado || {};
  setActiveCorrelationId(String(payload.correlation_id || payload.correlationId || job.correlation_id || `worker-job-${job.id}`));
  const variables = {
    ...(payload.variables || {}),
    ...normalizeDataset(payload.dataset),
    ...normalizeDataset(payload.case_variables),
  };
  const script = replacePlaceholders(payload.script, variables);
  const started = performance.now();

  const framework = frameworkKey(job);
  const language = languageKey(job);
  if (!localWorkerSupports(framework, language)) {
    return withCorrelation({
      status: "ERROR",
      duration_seconds: 0,
      observations: `Lenguaje no soportado por este worker: ${framework} + ${language}`,
      logs: "",
      error_message: `Este worker local no ejecuta ${framework} + ${language}. Vincula un worker especializado que anuncie esa capacidad.`,
      metadata: { worker: RUNNER_NAME, framework, language, os: os.type() },
      steps: [],
    });
  }
  if (framework === "puppeteer") return withCorrelation(await executePuppeteerJob(job, script, variables, started));
  if (framework === "cypress") return withCorrelation(await executeCypressJob(job, script, variables, started));
  if (framework === "selenium") return withCorrelation(await executeSeleniumPythonJob(job, script, variables, started));
  if (framework !== "playwright") {
    return withCorrelation({
      status: "ERROR",
      duration_seconds: 0,
      observations: `Framework no soportado por este worker: ${framework}`,
      logs: "",
      error_message: `Framework no soportado por este worker: ${framework}`,
      metadata: { worker: RUNNER_NAME, framework, os: os.type() },
      steps: [],
    });
  }

  const detectedScriptFormat = detectScriptFormat(script);
  const scriptFormat = payload.script_format === "playwright_test" || detectedScriptFormat === "playwright_test"
    ? "playwright_test"
    : "worker_function";
  if (scriptFormat === "playwright_test") {
    return withCorrelation(await executePlaywrightTestJob(job, script, variables, started));
  }
  return withCorrelation(await executePlaywrightWorkerFunctionJob(job, script, variables, started));
}

  return executeJob;
}
