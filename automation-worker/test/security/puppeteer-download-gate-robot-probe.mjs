import readline from "node:readline";
import {
  productionInstallSkipsPuppeteerDownload,
  unguardedInstallWouldDownload,
} from "./puppeteer-download-gate-probe.mjs";

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  try {
    const { kind, index } = JSON.parse(line);
    const passed = kind === "guarded"
      ? await productionInstallSkipsPuppeteerDownload(Number(index))
      : await unguardedInstallWouldDownload(Number(index));
    process.stdout.write(`${JSON.stringify({ passed })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ error: String(error.message || error) })}\n`);
  }
}
