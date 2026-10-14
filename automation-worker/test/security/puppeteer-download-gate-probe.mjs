import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const { downloadBrowsers } = require("../../node_modules/puppeteer/lib/cjs/puppeteer/node/install.js");
const { getConfiguration } = require("../../node_modules/puppeteer/lib/cjs/puppeteer/getConfiguration.js");
const dockerfile = fs.readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");
const entrypoint = fs.readFileSync(new URL("../../entrypoint.sh", import.meta.url), "utf8");
assert.match(dockerfile, /PUPPETEER_SKIP_DOWNLOAD=1[^\n]*npm ci/);
assert.match(entrypoint, /PUPPETEER_SKIP_DOWNLOAD=1[^\n]*npm ci/);

async function withEnv(name, value, callback) {
  const prior = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try { return await callback(); }
  finally {
    if (prior === undefined) delete process.env[name];
    else process.env[name] = prior;
  }
}

export async function productionInstallSkipsPuppeteerDownload(index) {
  return withEnv("PUPPETEER_SKIP_DOWNLOAD", ["1", "true", "yes", "on"][index % 4], () =>
    withEnv("npm_config_loglevel", "silent", async () => {
      assert.equal(getConfiguration().skipDownload, true);
      await downloadBrowsers();
      return true;
    }));
}

export function unguardedInstallWouldDownload(index) {
  return withEnv("PUPPETEER_SKIP_DOWNLOAD", [undefined, "0", "false", "off"][index % 4], async () => {
    assert.equal(Boolean(getConfiguration().skipDownload), false);
    return true;
  });
}
