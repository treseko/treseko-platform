export function createWorkerCapabilities({
  os,
  process,
  fs,
  rootDir,
  workerVersion,
  apiBase,
  runnerName,
  tags,
  maxParallelJobs,
  startedAtIso,
  startedAt,
  localIps,
  getPlaywrightVersion,
  getPackageVersion,
  getPythonCommand,
  getSeleniumVersion,
  workerInstanceId,
  getActiveJobs,
  getActiveJobId,
}) {
  function resources() {
    const memoryUsedMb = Math.round((os.totalmem() - os.freemem()) / 1024 / 1024);
    let diskFreeMb = null;
    try {
      if (typeof fs.statfsSync === "function") {
        const stats = fs.statfsSync(rootDir);
        diskFreeMb = Math.round((stats.bavail * stats.bsize) / 1024 / 1024);
      }
    } catch {
      diskFreeMb = null;
    }
    return {
      memory_used_mb: memoryUsedMb,
      memory_total_mb: Math.round(os.totalmem() / 1024 / 1024),
      disk_free_mb: diskFreeMb,
      loadavg: os.loadavg?.() || [],
    };
  }

  function capabilities() {
    const frameworkLanguages = {
      "treseko-api": ["declarative"],
      postman: ["javascript"],
      playwright: ["javascript", "typescript"],
      puppeteer: ["javascript", "typescript"],
      cypress: ["javascript", "typescript"],
      selenium: ["python"],
    };
    const versions = {
      automation_worker: workerVersion,
      "treseko-api": workerVersion,
      playwright: getPlaywrightVersion(),
      puppeteer: getPackageVersion("puppeteer"),
      cypress: getPackageVersion("cypress"),
      postman_runtime: getPackageVersion("postman-runtime"),
      selenium: getSeleniumVersion(),
    };
    const activeJobs = getActiveJobs();
    const activeJobId = getActiveJobId();
    const payload = {
      frameworks: ["treseko-api", "postman", "playwright", "puppeteer", "cypress", "selenium"],
      component: "automation-worker",
      component_version: workerVersion,
      worker_version: workerVersion,
      framework_languages: frameworkLanguages,
      languages: frameworkLanguages,
      language_status: {
        "treseko-api": { declarative: "local_worker_supported" },
        postman: { javascript: "local_worker_supported" },
        playwright: { javascript: "local_worker_supported", typescript: "local_worker_supported" },
        puppeteer: { javascript: "local_worker_supported", typescript: "local_worker_supported" },
        cypress: { javascript: "local_worker_supported", typescript: "local_worker_supported" },
        selenium: { python: "local_worker_supported" },
      },
      versions,
      playwright_version: getPlaywrightVersion(),
      puppeteer_version: versions.puppeteer,
      cypress_version: versions.cypress,
      selenium_version: versions.selenium,
      selenium_language: "python",
      python_bin: getPythonCommand(),
      browsers: ["chromium", "firefox", "webkit", "chrome (puppeteer)", "cypress"],
      os: `${os.type()} ${os.release()}`,
      platform: process.platform,
      arch: process.arch,
      hostname: os.hostname(),
      local_ips: localIps(),
      pid: process.pid,
      api_base: apiBase,
      started_at: startedAtIso,
      node_version: process.version,
      tags,
      max_parallel_jobs: maxParallelJobs,
      active_jobs: activeJobs,
      current_job_id: activeJobId || null,
      uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
    };
    if (workerInstanceId) payload.worker_instance_id = workerInstanceId;
    return payload;
  }

  return { capabilities, resources };
}
