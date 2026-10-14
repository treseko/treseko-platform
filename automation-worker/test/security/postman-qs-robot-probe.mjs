import readline from "node:readline";
import {
  normalQsSerialization,
  postmanRequestQsVersion,
  qsAdvisoryCasesAreHandled,
} from "./postman-qs-probe.mjs";

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  try {
    const { kind, index } = JSON.parse(line);
    const passed = kind === "positive"
      ? normalQsSerialization(index)
      : kind === "version"
        ? postmanRequestQsVersion === "6.16.0"
        : qsAdvisoryCasesAreHandled(index);
    process.stdout.write(`${JSON.stringify({ passed })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ error: String(error.message || error) })}\n`);
  }
}
