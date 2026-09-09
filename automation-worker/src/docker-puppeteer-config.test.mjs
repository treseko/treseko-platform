import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('./docker-puppeteer-config.cjs', import.meta.url), 'utf8');
function config(platform, arch, env = {}) {
  const sandbox = {module: {exports: {}}, process: {platform, arch, env}, require(name) {
    assert.equal(name, '/worker/node_modules/playwright');
    assert.equal(platform, 'linux');
    assert.equal(arch, 'arm64');
    return {chromium: {executablePath: () => '/native/chromium'}};
  }};
  vm.runInNewContext(source, sandbox);
  return sandbox.module.exports;
}
test('Docker ARM64 uses the native installed Chromium', () => {
  assert.equal(config('linux', 'arm64').executablePath, '/native/chromium');
});
test('AMD64 and native non-Linux defaults are not replaced', () => {
  for (const [platform, arch] of [['linux', 'x64'], ['darwin', 'arm64'], ['win32', 'x64']]) {
    assert.equal(Object.keys(config(platform, arch)).length, 0);
  }
});
test('An explicit Firefox selection is not given a Chromium executable', () => {
  assert.equal(Object.keys(config('linux', 'arm64', {PUPPETEER_BROWSER:'firefox'})).length, 0);
});
test('Operator-managed cache or Chrome version is not silently replaced', () => {
  for (const env of [{PUPPETEER_CACHE_DIR:'/operator/cache'}, {PUPPETEER_CHROME_VERSION:'custom'}]) {
    assert.equal(Object.keys(config('linux', 'arm64', env)).length, 0);
  }
});
