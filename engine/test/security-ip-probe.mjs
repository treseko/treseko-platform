import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import fs from "node:fs";
import readline from "node:readline";

const source = fs.readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
assert.match(source, /client_ip:\s*req\.ip/);
assert.doesNotMatch(source, /app\.set\(\s*["']trust proxy["']/);
const app = express();
app.get("/whoami", (req, res) => res.json({ ip: req.ip }));
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
const port = server.address().port;
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  try {
    const { forwarded } = JSON.parse(line);
    const headers = forwarded === undefined ? {} : { "X-Forwarded-For": forwarded, "X-Real-IP": forwarded };
    const response = await fetch(`http://127.0.0.1:${port}/whoami`, { headers });
    const body = await response.json();
    process.stdout.write(`${JSON.stringify(body)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ error: String(error.message || error) })}\n`);
  }
}
server.close();
