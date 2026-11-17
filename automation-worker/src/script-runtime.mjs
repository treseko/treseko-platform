import {runIsolatedCommand} from './process-runtime.mjs';
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
  const source = String(script || '').trim();
  if (!source) throw new Error('El job no incluye script automatizado');
  const compiler = require('esbuild');
  try {
    const code = compiler.transformSync(`(${source})`, {loader:'ts',target:'es2022'}).code.trim().replace(/;$/, '');
    const candidate = new Function(`return ${code};`)();
    if (typeof candidate === 'function') return candidate;
  } catch (error) {
    // Statement scripts are compiled as a TypeScript async function as well.
  }
  const code = compiler.transformSync(`async function __job(context) { const {page,browser,variables,dataset,job,assert,log} = context; ${source} }`, {loader:'ts',target:'es2022'}).code;
  return new Function(`${code}; return __job;`)();
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

async function getPuppeteerExecutablePath(){
  return process.env.PUPPETEER_EXECUTABLE_PATH || await require("puppeteer").executablePath();
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

function preferRecordedPlaywrightBaseUrl(script) {
  return String(script || '').replace(
    /(\b(?:const|let|var)\s+baseUrl\s*=\s*)variables\.base_url\s*\|\|\s*variables\.BASE_URL\s*\|\|\s*(["'])(https?:\/\/[^"'\\\s]+)\2/g,
    (match, declaration, _quote, recordedUrl) => {
      try {
        return `${declaration}${JSON.stringify(new URL(recordedUrl).origin)}`;
      } catch {
        return match;
      }
    },
  );
}

function preparePlaywrightTestSource(script, variables) {
  // Older Treseko Flow scripts let environment variables replace the URL
  // captured in the script. Keep that recorded origin authoritative even when
  // the case was saved before the editor-side import fix.
  let source = preferRecordedPlaywrightBaseUrl(script).trim();
  // Older Flow exports treated a card's combined title and description as one
  // exact text locator. If that exact text does not exist, try the card's link
  // title while keeping the normal uniqueness/visibility checks below.
  source = source.replace(
    /else if \(candidate\.kind === 'role'\) locator = page\.getByRole\(candidate\.role, \{ name: candidate\.name, exact: true \}\);/g,
    `else if (candidate.kind === 'role') { locator = page.getByRole(candidate.role, { name: candidate.name, exact: true }); const matchCount = await locator.count(); if (matchCount > 1 && candidate.matchCount === matchCount && Number.isInteger(candidate.matchIndex) && candidate.matchIndex >= 0 && candidate.matchIndex < matchCount) locator = locator.nth(candidate.matchIndex); }`
  );
  source = source.replace(
    /const (target\d+) = await resolve\((page\d*), \[(\{"kind":"text","value":"[^"\n]*Skip to content[^"\n]*"\})\]\);\s*\n(\s*)await \1\.hover\(\);/g,
    (_match, target, page, _candidate, indent) => `const ${target} = ${page}.locator('body');\n${indent}await ${target}.hover();`,
  );
  source = source.replace(
    /else if \(candidate\.kind === 'text'\) locator = page\.getByText\(candidate\.value, \{ exact: true \}\);/g,
    `else if (candidate.kind === 'text') { locator = page.getByText(candidate.value, { exact: true }); if (await locator.count() !== 1) { const selectMatches = await page.locator('select').evaluateAll((selects, value) => selects.map((element, index) => ({ index, options: Array.from(element.options).map(option => (option.textContent || '').trim()).filter(Boolean).join(' ') })).filter(item => item.options === String(value).trim()).map(item => item.index), candidate.value); if (selectMatches.length === 1) locator = page.locator('select').nth(selectMatches[0]); } if (await locator.count() !== 1) { const partialText = page.getByText(candidate.value); if (await partialText.count() === 1) locator = partialText; } if (await locator.count() !== 1 && String(candidate.value).includes(' - ')) { const linkName = String(candidate.value).split(' - ', 1)[0].trim(); if (linkName) { const link = page.getByRole('link', { name: linkName, exact: true }); if (await link.count() === 1) locator = link; } } }`
  );
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
  const serializedVariables = JSON.stringify(variables || {});
  return [
    `const variables = ${serializedVariables};`,
    "const dataset = variables;",
    source,
  ].join("\n\n");
}

function playwrightTestScriptLineOffset(script) {
  const source = preferRecordedPlaywrightBaseUrl(script).trim();
  const hasPlaywrightImport = /(?:@playwright\/test|playwright\/test)/.test(source);
  const leadingLines = String(script || '').match(/^\s*\n+/)?.[0].split('\n').length - 1 || 0;
  return 4 + (hasPlaywrightImport ? 0 : 1) - leadingLines;
}

function preparedScriptLineOffset(preparedSource, script) {
  const authored = String(script || '').trim();
  if (!authored) return 0;
  const index = String(preparedSource || '').lastIndexOf(authored);
  if (index < 0) return 0;
  return String(preparedSource).slice(0, index).split('\n').length - 1;
}

function runCommand(command, args, options = {}) {
  return runIsolatedCommand({spawn, process, sanitizeChildEnv}, command, args, options);
}

function sanitizeChildEnv(source = {}) {
  const secretName = /(TOKEN|SECRET|PASSWORD|API[_-]?KEY|CREDENTIAL|PRIVATE[_-]?KEY|AUTHORIZATION)/i;
  return Object.fromEntries(Object.entries(source).filter(([key]) => !secretName.test(key)));
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
  const {lease_token, ...businessJob} = job || {};
  return [
    `globalThis.variables = ${serializeJsonForSource(variables)};`,
    "globalThis.dataset = globalThis.variables;",
    `globalThis.job = ${serializeJsonForSource(businessJob)};`,
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
  const {lease_token, ...businessJob} = job || {};
  return [
    "import json",
    "import os",
    `variables = json.loads(${JSON.stringify(JSON.stringify(variables || {}))})`,
    "dataset = variables",
    `job = json.loads(${JSON.stringify(JSON.stringify(businessJob))})`,
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
    getPlaywrightCliPath, getPuppeteerExecutablePath, getPackageBinPath, getPlaywrightTestRequirePath,
    preferRecordedPlaywrightBaseUrl, preparePlaywrightTestSource, playwrightTestScriptLineOffset, preparedScriptLineOffset, runCommand, sanitizeChildEnv, executableScriptFile, scriptFileForJob,
    serializeJsonForSource, prepareNodeScriptSource, prepareSeleniumPythonSource,
  };
}
