import http from "node:http";
import axios from "axios";
import readline from "node:readline";

const server = http.createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/plain" });
  response.end(request.method);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/method`;
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

for await (const line of input) {
  try {
    const { explicitMethod, shorthand } = JSON.parse(line);
    Object.prototype.method = "DELETE";
    let response;
    try {
      const config = { url, ...(explicitMethod ? { method: "GET" } : {}) };
      response = await (shorthand ? axios(config) : axios.request(config));
    } finally {
      delete Object.prototype.method;
    }
    process.stdout.write(`${JSON.stringify({ method: response.data, version: axios.VERSION })}\n`);
  } catch (error) {
    delete Object.prototype.method;
    process.stdout.write(`${JSON.stringify({ error: String(error.message || error) })}\n`);
  }
}

server.close();
