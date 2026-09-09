// Image-only global fallback; not loaded by native installations.
// Chrome for Testing bundled with Puppeteer 23 is x86-64 on Linux. Reuse the
// native Chromium already installed by Playwright on Linux ARM64 instead.
module.exports = process.platform === 'linux' && process.arch === 'arm64'
  && (!process.env.PUPPETEER_BROWSER || process.env.PUPPETEER_BROWSER === 'chrome')
  && (!process.env.PUPPETEER_CACHE_DIR || process.env.PUPPETEER_CACHE_DIR === '/ms-puppeteer')
  && !process.env.PUPPETEER_CHROME_VERSION
  ? { executablePath: require('/worker/node_modules/playwright').chromium.executablePath() }
  : {};
