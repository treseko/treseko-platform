import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
for (const name of ["window", "document", "Node", "NodeFilter", "Element", "HTMLElement", "HTMLTemplateElement", "customElements", "MutationObserver", "Document", "DocumentFragment", "ShadowRoot", "CSS"]) {
  if (dom.window[name]) globalThis[name] = dom.window[name];
}
const { sanitizeHtml } = await import("../../node_modules/monaco-editor/esm/vs/base/browser/domSanitize.js");

export function sanitizeAndCheck(html, category) {
  const output = String(sanitizeHtml(html));
  const template = document.createElement("template");
  template.innerHTML = output;
  const fragment = template.content;
  const badElement = fragment.querySelector("script, iframe, object, embed, svg, math");
  const badEvent = [...fragment.querySelectorAll("*")].some(element => [...element.attributes].some(attribute => /^on/i.test(attribute.name)));
  const badProtocol = [...fragment.querySelectorAll("[href], [src]")].some(element =>
    ["href", "src"].some(name => {
      const value = element.getAttribute(name) || "";
      return /^(javascript|vbscript|data):/i.test(value.trim());
    }),
  );
  const safe = !badElement && !badEvent && !badProtocol;
  const positivePreserved = category !== "positive" || (fragment.querySelector("a[href^='https://']")?.textContent === "safe link");
  return { safe: safe && positivePreserved, output };
}

export function closeSanitizerDom() {
  dom.window.close();
}
