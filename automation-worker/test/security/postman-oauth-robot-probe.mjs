import readline from "node:readline";
import { closeOauthProbe, hostileOauthQueryIsBounded, validOauthQuerySerializes } from "./postman-oauth-probe.mjs";

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  try {
    const { kind, index } = JSON.parse(line);
    const passed = kind === "valid"
      ? await validOauthQuerySerializes(Number(index))
      : await hostileOauthQueryIsBounded(Number(index));
    process.stdout.write(`${JSON.stringify({ passed })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ error: String(error.message || error) })}\n`);
  }
}
await closeOauthProbe();
