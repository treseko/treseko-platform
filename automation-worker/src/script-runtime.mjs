export function createScriptRuntime(deps) {
  const { capabilities, require, path, spawn, process } = deps;

function getValue(source, key) {
  if (!source || !key) return "";
  if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
  const shortKey = key.includes(".") ? key.split(".").pop() : key;
  return source[shortKey] ?? "";
}

function replacePlaceholders(text, variables) {
  return String(text || "").replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_, key) => {
    const value = getValue(variables, key);
    return String(value ?? "");
  });
}

function normalizeDataset(dataset) {
  const output = {};
  if (Array.isArray(dataset)) {
    for (const item of dataset) {
      if (item && item.key) output[item.key] = item.value ?? "";
    }
  } else if (dataset && typeof dataset === "object") {
    Object.assign(output, dataset);
  }
  return output;
}

function compileScript(script) {
  const source = String(script || "").trim();
  if (!source) throw new Error("El job no incluye script automatizado");
  try {
    const candidate = new Function(`return (${source});`)();
    if (typeof candidate === "function") return candidate;
  } catch {
    // Si no es una funcion, se ejecuta como cuerpo async.
  }
  return async (context) => {
    const runner = new Function("context", `with (context) { return (async () => {\n${source}\n})(); }`);
    return runner(context);
  };
}

function detectScriptFormat(script) {
  const source = String(script || "");
  if (/@playwright\/test/.test(source) || /\btest\s*\(/.test(source) || /\bexpect\s*\(/.test(source)) {
    return "playwright_test";
  }
  return "worker_function";
}

const PLAYWRIGHT_BROWSER_NAMES = new Set(["chromium", "firefox", "webkit"]);

function playwrightBrowserForJob(job, variables = {}) {
  const payload = job.payload_congelado || {};
  const requested = String(
    payload.browser
    || payload.browser_name
    || variables.browser
    || variables.BROWSER
    || payload.variables?.browser
    || payload.variables?.BROWSER
    || "chromium"
  ).trim().toLowerCase();
  const aliases = { chrome: "chromium", "google-chrome": "chromium", safari: "webkit" };
  const normalized = aliases[requested] || requested;
  return PLAYWRIGHT_BROWSER_NAMES.has(normalized) ? normalized : "chromium";
}

function frameworkKey(job) {
  const payload = job.payload_congelado || {};
  return String(payload.framework || job.required_framework || "playwright").split(":", 1)[0].split("@", 1)[0].trim().toLowerCase() || "playwright";
}

function languageKey(job) {
  const payload = job.payload_congelado || {};
  const framework = frameworkKey(job);
  const language = String(job.required_language || payload.language || payload.lenguaje || "").trim().toLowerCase();
  if (language) return language === "ts" ? "typescript" : language === "js" ? "javascript" : language;
  return framework === "selenium" ? "python" : "javascript";
}

function localWorkerSupports(framework, language) {
  const matrix = capabilities().framework_languages || {};
  return Array.isArray(matrix[framework]) && matrix[framework].includes(language);
}

function getPlaywrightCliPath() {
  const packagePath = require.resolve("playwright/package.json");
  return path.join(path.dirname(packagePath), "cli.js");
}

function getPackageBinPath(packageName, relativeBinPath) {
  const packagePath = require.resolve(`${packageName}/package.json`);
  return path.join(path.dirname(packagePath), relativeBinPath);
}

function getPlaywrightTestRequirePath() {
  return JSON.stringify(require.resolve("playwright/test"));
}

function preparePlaywrightTestSource(script, variables) {
  let source = String(script || "").trim();
  const playwrightTestRequirePath = getPlaywrightTestRequirePath();
  source = source.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"]@playwright\/test['"];?/g,
    `const {$1} = require(${playwrightTestRequirePath});`
  );
  source = source.replace(
    /import\s+\*\s+as\s+(\w+)\s+from\s+['"]@playwright\/test['"];?/g,
    `const $1 = require(${playwrightTestRequirePath});`
  );
  source = source.replace(
    /require\(\s*['"](?:@playwright\/test|playwright\/test)['"]\s*\)/g,
    `require(${playwrightTestRequirePath})`
  );
  if (!/(?:@playwright\/test|playwright\/test)/.test(source)) {
    source = `const { test, expect } = require(${playwrightTestRequirePath});\n` + source;
  }
  const serializedVariables = JSON.stringify(variables || {}, null, 2);
  return [
    `const variables = ${serializedVariables};`,
    "const dataset = variables;",
    source,
  ].join("\n\n");
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs || 300000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: `${stderr}\n${error.stack || error.message}`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr, timedOut });
    });
  });
}

function executableScriptFile(script) {
  const source = String(script || "");
  return /\b(import|export)\s|:\s*[A-Za-z_$][A-Za-z0-9_$<>,\s[\]]*(?:[=,)])|interface\s+\w+|type\s+\w+\s*=/.test(source)
    ? "job.ts"
    : "job.js";
}

function scriptFileForJob(job, script) {
  const payload = job.payload_congelado || {};
  return String(payload.language || payload.lenguaje || "").toLowerCase() === "typescript"
    ? "job.ts"
    : executableScriptFile(script);
}

function serializeJsonForSource(value) {
  return JSON.stringify(value || {}, null, 2).replace(/<\/script/gi, "<\\/script");
}

function prepareNodeScriptSource(script, variables, job, framework) {
  return [
    `globalThis.variables = ${serializeJsonForSource(variables)};`,
    "globalThis.dataset = globalThis.variables;",
    `globalThis.job = ${serializeJsonForSource(job)};`,
    `globalThis.QA_FRAMEWORK = ${JSON.stringify(framework)};`,
    "globalThis.QA_ARTIFACTS_DIR = process.env.QA_ARTIFACTS_DIR;",
    "globalThis.captureScreenshot = async (page, name = 'screenshot.png') => {",
    "  const path = await import('node:path');",
    "  const fileName = String(name).toLowerCase().endsWith('.png') ? String(name) : `${name}.png`;",
    "  const output = path.join(globalThis.QA_ARTIFACTS_DIR || '.', fileName);",
    "  return page.screenshot({ path: output, fullPage: true });",
    "};",
    String(script || "").trim(),
  ].join("\n\n");
}

function prepareSeleniumPythonSource(script, variables, job) {
  return [
    "import json",
    "import os",
    `variables = json.loads(${JSON.stringify(JSON.stringify(variables || {}))})`,
    "dataset = variables",
    `job = json.loads(${JSON.stringify(JSON.stringify(job || {}))})`,
    "QA_ARTIFACTS_DIR = os.environ.get('QA_ARTIFACTS_DIR')",
    "QA_HEADLESS = os.environ.get('QA_HEADLESS') == 'true'",
    "def capture_screenshot(driver, name='screenshot.png'):",
    "    if not QA_ARTIFACTS_DIR:",
    "        return None",
    "    filename = name if str(name).lower().endswith('.png') else f'{name}.png'",
    "    output = os.path.join(QA_ARTIFACTS_DIR, filename)",
    "    driver.save_screenshot(output)",
    "    return output",
    "",
    String(script || "").trim(),
  ].join("\n");
}

  return {
    getValue, replacePlaceholders, normalizeDataset, compileScript, detectScriptFormat,
    playwrightBrowserForJob, frameworkKey, languageKey, localWorkerSupports,
    getPlaywrightCliPath, getPackageBinPath, getPlaywrightTestRequirePath,
    preparePlaywrightTestSource, runCommand, executableScriptFile, scriptFileForJob,
    serializeJsonForSource, prepareNodeScriptSource, prepareSeleniumPythonSource,
  };
}
