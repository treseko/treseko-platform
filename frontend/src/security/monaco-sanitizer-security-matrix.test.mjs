import assert from "node:assert/strict";
import test from "node:test";
import { closeSanitizerDom, sanitizeAndCheck } from "./monaco-sanitizer-probe.mjs";

for (let i = 0; i < 250; i += 1) {
  test(`Monaco keeps safe editor documentation markup ${i}`, () => {
    const result = sanitizeAndCheck(`<p>Case ${i}</p><a href="https://docs.example.test/${i}">safe link</a><code>snippet-${i}</code>`, "positive");
    assert.equal(result.safe, true);
    assert.match(result.output, /safe link/);
  });
}

for (let i = 0; i < 250; i += 1) {
  const attacks = [
    `<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" onerror="window.__xss_${i}=1">`,
    `<a href="javascript:window.__xss_${i}=1">bad link</a>`,
    `<svg onload="window.__xss_${i}=1"><script>window.__xss_${i}=1</script></svg>`,
    `<iframe srcdoc="&lt;script&gt;window.__xss_${i}=1&lt;/script&gt;"></iframe>`,
    `<video><source src="data:text/html,window.__xss_${i}=1"></video>`,
  ];
  test(`Monaco removes unsafe markup and protocols ${i}`, () => {
    const result = sanitizeAndCheck(attacks[i % attacks.length], "negative");
    assert.equal(result.safe, true);
    assert.doesNotMatch(result.output, /onerror|onload|javascript:|data:text\/html|<script|<iframe|<svg/i);
  });
}

test.after(closeSanitizerDom);
