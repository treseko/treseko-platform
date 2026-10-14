import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const createDOMPurify = require("dompurify");

test("IN_PLACE does not return a rawtext root that reparses attacker markup", () => {
  const window = new JSDOM("").window;
  const purify = createDOMPurify(window);
  const style = window.document.createElement("style");
  style.setAttribute("onclick", "window.__xss = true");
  style.textContent = "</style><img src=x onerror=window.__xss=true>";
  window.document.body.appendChild(style);

  assert.throws(
    () => purify.sanitize(style, { IN_PLACE: true }),
    /refusing to sanitize in place/,
  );
  assert.equal(style.getAttribute("onclick"), null);
  window.close();
});

test("IN_PLACE hook removal neutralizes retained descendant event handlers", () => {
  const window = new JSDOM("").window;
  const purify = createDOMPurify(window);
  const root = window.document.createElement("div");
  root.innerHTML = '<section id="remove-me"><img src="x" onload="window.__xss=true"></section>';
  const image = root.querySelector("img");
  purify.addHook("uponSanitizeElement", node => {
    if (node.id === "remove-me") node.remove();
  });

  purify.sanitize(root, { IN_PLACE: true });

  assert.equal(image.getAttribute("onload"), null);
  assert.equal(root.querySelector("#remove-me"), null);
  purify.removeAllHooks();
  window.close();
});

test("ordinary sanitization keeps allowed markup and removes event handlers", () => {
  const window = new JSDOM("").window;
  const purify = createDOMPurify(window);
  const clean = purify.sanitize('<b>safe</b><img src="x" onerror="window.__xss=true">');
  assert.match(clean, /<b>safe<\/b>/);
  assert.doesNotMatch(clean, /onerror/i);
  window.close();
});
