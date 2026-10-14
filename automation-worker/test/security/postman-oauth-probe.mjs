import assert from "node:assert/strict";
import http from "node:http";
import { runPostmanCollection } from "../../src/postman-runtime.mjs";

let lastAuthorization = null;
let lastUrl = null;
const server = http.createServer((request, response) => {
  lastAuthorization = request.headers.authorization || null;
  lastUrl = request.url;
  response.end("ok");
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/oauth`;

const hostileQueries = [
  "filter%5Bitems%5D%5B0%5D%5Bx%5D=a%2Cb&filter%5Bitems%5D%5B25%5D%5Bx%5D=z",
  "comma=a%2Cb%2Cc%2Cd&empty=&plus=a+b",
  "__proto__%5Bpolluted%5D=1&constructor%5Bprototype%5D%5Bpolluted%5D=1",
  "items%5B999999999%5D=value&items%5B-1%5D=negative",
  Array.from({ length: 16 }, (_, n) => `tag%5B%5D=${n}`).join("&"),
];

function collection(index, query) {
  return {
    info: { name: "Treseko Postman OAuth query serialization matrix" },
    item: [{
      name: `oauth-${index}`,
      request: {
        method: "GET",
        url: `${baseUrl}?case=${index}&${query}`,
        auth: { type: "oauth1", oauth1: [
          { key: "consumerKey", value: "treseko-test-key" },
          { key: "consumerSecret", value: "local-only-test-secret" },
          { key: "signatureMethod", value: "HMAC-SHA1" },
          { key: "addParamsToHeader", value: true },
        ] },
      },
    }],
  };
}

async function execute(index, query) {
  const result = await runPostmanCollection({
    collection: collection(index, query), allowedHosts: ["127.0.0.1"], timeoutMs: 5000,
  });
  assert.equal(result.status, "PASSED");
  assert.equal(result.requests[0]?.status, 200);
  assert.match(lastAuthorization || "", /^OAuth oauth_consumer_key=/);
  assert.equal({}.polluted, undefined);
  return result;
}

export async function validOauthQuerySerializes(index) {
  const result = await execute(index, `tag=one&tag=two&label=Treseko%20QA%20${index}`);
  assert.match(lastUrl || "", new RegExp(`case=${index}`));
  assert.equal(result.requests[0].request.method, "GET");
  return true;
}

export async function hostileOauthQueryIsBounded(index) {
  const result = await execute(index, hostileQueries[index % hostileQueries.length]);
  assert.equal(result.requests.length, 1);
  assert.ok((lastUrl || "").length < 20000);
  return true;
}

export function closeOauthProbe() {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
