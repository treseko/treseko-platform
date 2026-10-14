import {readResultFile} from './result-file.mjs';
import {createJobWorkspace} from './workspace-retention.mjs';
import {fileURLToPath} from 'node:url';
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { executeApiWorkerJob } from "./native-api-runtime.mjs";

export function createJobExecutor(deps) {
  const {
    RUNNER_NAME, ROOT_DIR, state,
    playwrightBrowserForJob, scriptFileForJob, preparePlaywrightTestSource,
    shouldRunHeadless, getPlaywrightCliPath, getPuppeteerExecutablePath, runCommand, parsePlaywrightJsonReport,
    summarizePlaywrightReport, compactPlaywrightMetadata, classifyPlaywrightFailure, withCorrelation,
    collectArtifacts, playwrightReportArtifact, getPlaywrightVersion, isDebugMode,
    processResultPayload, prepareNodeScriptSource, getPackageBinPath,
    serializeJsonForSource, prepareSeleniumPythonSource, getPythonCommand,
    compileScript, normalizeDataset, normalizeStepResult, normalizeJobStatus,
    isAssertionLike, artifactFromBuffer, formatLogArg, formatErrorDetail,
    redact, replacePlaceholders, frameworkKey, languageKey, localWorkerSupports,
    detectScriptFormat, setActiveCorrelationId, allowLoopbackForTests,
  } = deps;

async function executePlaywrightTestJob(job, script, variables, started, signal) {
  const payload = job.payload_congelado || {};
  const browserName = playwrightBrowserForJob(job, variables);
  const workspace = createJobWorkspace(job.id,'qa-worker-');
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
      "    screenshot: 'only-on-failure',",
      `    video: ${payload.record_video === false ? "'off'" : "'on'"}`,
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
        timeoutMs, signal,
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
    const status = result.cancelled ? "BLOCKED" : result.timedOut ? "TIMEOUT" : result.code === 0
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
        ...collectArtifacts(workspace,{workerWorkspace:true}),
      ].filter(Boolean),
      steps: [],
    });
  } finally {
    // Keep original files until the backend acknowledges the complete result.
  }
}

async function executePuppeteerJob(job, script, variables, started, signal) {
  const payload = job.payload_congelado || {};
  const workspace = createJobWorkspace(job.id,'qa-worker-puppeteer-');
  const scriptFile = scriptFileForJob(job, script);
  const scriptPath = path.join(workspace, scriptFile);
  const timeoutMs = Math.max(1, Number(job.timeout_seconds || payload.timeout_seconds || 300)) * 1000;
  try {
    fs.writeFileSync(scriptPath, prepareNodeScriptSource(script, variables, job, "puppeteer"), "utf8");
    const tsxCli = getPackageBinPath("tsx", "dist/cli.mjs");
    const result = await runCommand(process.execPath, [tsxCli, scriptPath], {
      cwd: workspace,
      timeoutMs, signal,
      env: {
        ...process.env,
        NODE_PATH: path.join(ROOT_DIR, "node_modules"),
        PUPPETEER_EXECUTABLE_PATH: getPuppeteerExecutablePath?.() || process.env.PUPPETEER_EXECUTABLE_PATH,
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
      artifacts: collectArtifacts(workspace,{workerWorkspace:true}),
    });
  } finally {
    // Keep original files until the backend acknowledges the complete result.
  }
}

async function executeCypressJob(job, script, variables, started, signal) {
  const payload = job.payload_congelado || {};
  const workspace = createJobWorkspace(job.id,'qa-worker-cypress-');
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
      timeoutMs, signal,
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
      artifacts: collectArtifacts(workspace,{workerWorkspace:true}),
    });
  } finally {
    // Keep original files until the backend acknowledges the complete result.
  }
}

async function executeSeleniumPythonJob(job, script, variables, started, signal) {
  const payload = job.payload_congelado || {};
  const workspace = createJobWorkspace(job.id,'qa-worker-selenium-');
  const scriptPath = path.join(workspace, "job.py");
  const timeoutMs = Math.max(1, Number(job.timeout_seconds || payload.timeout_seconds || 300)) * 1000;
  try {
    fs.writeFileSync(scriptPath, prepareSeleniumPythonSource(script, variables, job), "utf8");
    const result = await runCommand(getPythonCommand(), [scriptPath], {
      cwd: workspace,
      timeoutMs, signal,
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
      artifacts: collectArtifacts(workspace,{workerWorkspace:true}),
    });
  } finally {
    // Keep original files until the backend acknowledges the complete result.
  }
}

async function executePlaywrightWorkerFunctionJob(job, script, variables, started, signal) {
  const payload=job.payload_congelado || {};
  const browserName=playwrightBrowserForJob(job,variables);
  const workspace=createJobWorkspace(job.id,'qa-worker-function-');
  const resultPath=path.join(workspace,'function-result.json');
  const inputPath=path.join(workspace,'function-input.json');
  try {
    const {lease_token, ...testJob}=job;
    fs.writeFileSync(inputPath,JSON.stringify({job:testJob,script,variables,dataset:normalizeDataset(payload.dataset),browserName,headless:shouldRunHeadless(job),resultPath,workspace}),{mode:0o600});
    const result=await runCommand(process.execPath,[fileURLToPath(new URL('./function-host.mjs',import.meta.url)),inputPath],{
      cwd:workspace,timeoutMs:Math.max(1,Number(job.timeout_seconds || payload.timeout_seconds || 300))*1000,signal,
      env:{...process.env,QA_ARTIFACTS_DIR:workspace},
    });
    const custom=readResultFile(resultPath);
    const status=result.cancelled?'BLOCKED':result.timedOut?'TIMEOUT':result.code!==0?'ERROR':normalizeJobStatus(custom.status);
    const artifacts=[...(Array.isArray(custom.artifacts)?custom.artifacts:[]),...collectArtifacts(workspace,{workerWorkspace:true}).filter(item=>!['function-input.json','function-result.json'].includes(item.filename))];
    return { ...custom,status,duration_seconds:Math.round((performance.now()-started)/1000),
      observations:result.cancelled?'El lease se perdió; se detuvo la ejecución.':result.timedOut?'La ejecución superó el timeout configurado.':custom.observations || 'Worker automatizado finalizó correctamente.',
      logs:custom.logs || result.stdout || '',error_message:custom.error_message || result.error || (status==='ERROR'?result.stderr:null),
      metadata:{...(custom.metadata || {}),worker:RUNNER_NAME,framework:'playwright',browser:browserName,script_format:'worker_function',isolated_process:true,
        video_status:payload.record_video===false?'DISABLED':artifacts.some(item=>item.content_type==='video/webm')?'AVAILABLE':'UNAVAILABLE'},
      steps:Array.isArray(custom.steps)?custom.steps.map(normalizeStepResult):[],artifacts};
  }finally{/* Original files are retained until backend acknowledgement. */}
}

async function executeIsolatedPostmanJob(job, started, signal) {
  const workspace=createJobWorkspace(job.id,'qa-worker-postman-');
  const inputPath=path.join(workspace,'postman-input.json');
  const resultPath=path.join(workspace,'postman-result.json');
  try {
    const {lease_token,...businessJob}=job;
    fs.writeFileSync(inputPath,JSON.stringify({job:businessJob,runnerName:RUNNER_NAME,resultPath}),{mode:0o600});
    const processResult=await runCommand(process.execPath,[fileURLToPath(new URL('./postman-host.mjs',import.meta.url)),inputPath],{
      cwd:workspace,timeoutMs:Math.max(1,Number(job.timeout_seconds || 300))*1000,signal,env:process.env});
    const custom=readResultFile(resultPath);
    const status=processResult.cancelled?'BLOCKED':processResult.timedOut?'TIMEOUT':processResult.code!==0?'ERROR':custom.status || 'ERROR';
    return {...custom,status,duration_seconds:Math.round((performance.now()-started)/1000),
      logs:custom.logs || processResult.stdout,error_message:custom.error_message || processResult.error || (status==='ERROR'?processResult.stderr:null),
      steps:Array.isArray(custom.steps)?custom.steps.map(normalizeStepResult):[],
      metadata:{...(custom.metadata || {}),worker:RUNNER_NAME,framework:'postman',isolated_process:true},
      artifacts:collectArtifacts(workspace,{workerWorkspace:true}).filter(item=>item.filename!=='postman-input.json')};
  }finally{/* Original files are retained until backend acknowledgement. */}
}

async function executeJob(job, {signal} = {}) {
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
  if (job.job_type === "API_EXECUTION" || framework === "treseko-api") {
    try {
      return withCorrelation(await executeApiWorkerJob({
        job,
        signal,
        allowLoopbackForTests: Boolean(allowLoopbackForTests),
      }));
    } catch (error) {
      return withCorrelation({
        status: "BLOCKED",
        duration_seconds: 0,
        observations: "El job API no pudo validarse.",
        logs: "",
        error_message: redact(error?.message || error),
        metadata: { worker: RUNNER_NAME, framework: "treseko-api", language: "declarative", runtime: "native-fetch" },
        steps: [],
        api_results: [],
      });
    }
  }
  if (framework === "postman") {
    try {
      return withCorrelation(await executeIsolatedPostmanJob(job,started,signal));
    } catch (error) {
      return withCorrelation({
        status: "ERROR",
        duration_seconds: 0,
        observations: "El runtime Postman no pudo completar la colección.",
        logs: "",
        error_message: redact(error?.message || error),
        metadata: { worker: RUNNER_NAME, framework: "postman", runtime: "postman-runtime" },
        steps: [],
      });
    }
  }
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
  if (framework === "puppeteer") return withCorrelation(await executePuppeteerJob(job, script, variables, started, signal));
  if (framework === "cypress") return withCorrelation(await executeCypressJob(job, script, variables, started, signal));
  if (framework === "selenium") return withCorrelation(await executeSeleniumPythonJob(job, script, variables, started, signal));
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
    return withCorrelation(await executePlaywrightTestJob(job, script, variables, started, signal));
  }
  return withCorrelation(await executePlaywrightWorkerFunctionJob(job, script, variables, started, signal));
}

  return executeJob;
}
