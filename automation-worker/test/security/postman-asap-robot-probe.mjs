import readline from "node:readline";
import { closeAsapProbe, malformedAsapKeyDoesNotSign, validAsapSignature } from "./postman-asap-probe.mjs";

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  try {
    const { kind, index } = JSON.parse(line);
    const passed = kind === "valid" ? await validAsapSignature(Number(index)) : await malformedAsapKeyDoesNotSign(Number(index));
    process.stdout.write(`${JSON.stringify({ passed })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ error: String(error.message || error) })}\n`);
  }
}
await closeAsapProbe();
