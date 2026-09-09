import assert from "node:assert/strict";
import test from "node:test";
import { createWorkerCapabilities } from "./worker-capabilities.mjs";

function fixture(active = { jobs: 0, id: "" }) {
  const os = {
    totalmem: () => 8 * 1024 * 1024 * 1024,
    freemem: () => 6 * 1024 * 1024 * 1024,
    statfsSync: () => ({ bavail: 4000, bsize: 1024 * 1024 }),
    loadavg: () => [1, 2, 3],
    type: () => "TestOS",
    release: () => "test-release",
    hostname: () => "worker-test",
  };
  const process = {
    platform: "test-platform",
    arch: "test-arch",
    pid: 42,
    version: "v-test",
    env: { QA_SELENIUM_VERSION: "selenium-test" },
  };
  const versions = {
    playwright: "pw-test", puppeteer: "puppet-test", cypress: "cypress-test",
    "postman-runtime": "postman-test",
  };
  const calls = [];
  return {
    calls,
    active,
    process,
    ...createWorkerCapabilities({
      os, process, fs: { statfsSync: os.statfsSync }, rootDir: "/worker",
      workerVersion: "1.0.3", apiBase: "http://api.test", runnerName: "worker-test",
      tags: ["local", "v1"], maxParallelJobs: 2,
      startedAtIso: "2026-09-09T00:00:00.000Z", startedAt: Date.now(),
      localIps: () => ["192.0.2.10"],
      getPlaywrightVersion: () => versions.playwright,
      getPackageVersion: (name) => { calls.push(name); return versions[name] || "unknown"; },
      getPythonCommand: () => "python-test",
      getSeleniumVersion: () => process.env.QA_SELENIUM_VERSION || "python",
      getActiveJobs: () => active.jobs,
      getActiveJobId: () => active.id,
    }),
  };
}

test("capabilities conserva payload y consulta las versiones mediante getters", () => {
  const fixtureData = fixture();
  const payload = fixtureData.capabilities();
  assert.deepEqual(payload.frameworks, ["treseko-api", "postman", "playwright", "puppeteer", "cypress", "selenium"]);
  assert.deepEqual(payload.framework_languages.playwright, ["javascript", "typescript"]);
  assert.deepEqual(payload.languages, payload.framework_languages);
  assert.deepEqual(payload.versions, {
    automation_worker: "1.0.3", "treseko-api": "1.0.3", playwright: "pw-test",
    puppeteer: "puppet-test", cypress: "cypress-test", postman_runtime: "postman-test",
    selenium: "selenium-test",
  });
  assert.equal(payload.python_bin, "python-test");
  assert.deepEqual(payload.local_ips, ["192.0.2.10"]);
  assert.equal(payload.active_jobs, 0);
  assert.equal(payload.current_job_id, null);
  assert.deepEqual(fixtureData.calls, ["puppeteer", "cypress", "postman-runtime"]);
  const { uptime_seconds: _uptime, ...stablePayload } = payload;
  assert.deepEqual(stablePayload, {
    frameworks: ["treseko-api", "postman", "playwright", "puppeteer", "cypress", "selenium"],
    component: "automation-worker", component_version: "1.0.3", worker_version: "1.0.3",
    framework_languages: payload.framework_languages, languages: payload.languages,
    language_status: payload.language_status, versions: payload.versions,
    playwright_version: "pw-test", puppeteer_version: "puppet-test", cypress_version: "cypress-test",
    selenium_version: "selenium-test", selenium_language: "python", python_bin: "python-test",
    browsers: ["chromium", "firefox", "webkit", "chrome (puppeteer)", "cypress"],
    os: "TestOS test-release", platform: "test-platform", arch: "test-arch", hostname: "worker-test",
    local_ips: ["192.0.2.10"], pid: 42, api_base: "http://api.test",
    started_at: "2026-09-09T00:00:00.000Z", node_version: "v-test", tags: ["local", "v1"],
    max_parallel_jobs: 2, active_jobs: 0, current_job_id: null,
  });
});

test("capabilities refleja activeJobs y activeJobId actuales, no un snapshot", () => {
  const fixtureData = fixture({ jobs: 0, id: "" });
  assert.equal(fixtureData.capabilities().active_jobs, 0);
  fixtureData.active.jobs = 1;
  fixtureData.active.id = "job-live";
  assert.equal(fixtureData.capabilities().active_jobs, 1);
  assert.equal(fixtureData.capabilities().current_job_id, "job-live");
  fixtureData.active.jobs = 0;
  fixtureData.active.id = "";
  assert.equal(fixtureData.capabilities().active_jobs, 0);
  assert.equal(fixtureData.capabilities().current_job_id, null);
});

test("resources conserva memoria, disco y carga dinámica", () => {
  const fixtureData = fixture();
  assert.deepEqual(fixtureData.resources(), {
    memory_used_mb: 2048,
    memory_total_mb: 8192,
    disk_free_mb: 4000,
    loadavg: [1, 2, 3],
  });
});
