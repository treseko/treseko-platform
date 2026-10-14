import readline from "node:readline";
import { closeSanitizerDom, sanitizeAndCheck } from "./monaco-sanitizer-probe.mjs";

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  try {
    const { html, category } = JSON.parse(line);
    process.stdout.write(`${JSON.stringify(sanitizeAndCheck(html, category))}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ error: String(error.message || error) })}\n`);
  }
}
closeSanitizerDom();
