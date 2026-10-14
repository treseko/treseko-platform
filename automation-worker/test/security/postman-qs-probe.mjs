import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const postmanRequestEntry = require.resolve("postman-request");
const postmanRequestRequire = createRequire(postmanRequestEntry);
export const postmanRequestQsVersion = postmanRequestRequire("qs/package.json").version;
const qs = postmanRequestRequire("qs");

export function normalQsSerialization(index) {
  const value = `Treseko ${index}`;
  const encoded = qs.stringify({ label: value, tags: ["one", "two"] });
  assert.equal(encoded, `label=Treseko%20${index}&tags%5B0%5D=one&tags%5B1%5D=two`);
  assert.deepEqual(qs.parse(encoded), { label: value, tags: ["one", "two"] });
  return true;
}

export function qsAdvisoryCasesAreHandled(index) {
  const failures = [];
  try {
    qs.stringify({ a: [null, `b${index}`] }, { arrayFormat: "comma", encodeValuesOnly: true });
  } catch {
    failures.push("null comma serialization threw");
  }

  try {
    const parsedArray = qs.parse("a[]=1,2,3,4", { comma: true, arrayLimit: 3, throwOnLimitExceeded: true });
    if (parsedArray.a?.[0]?.length > 3) failures.push("comma bracket input bypassed arrayLimit");
  } catch (error) {
    if (!(error instanceof RangeError)) failures.push("array limit produced an unexpected error");
  }

  try {
    const parsed = qs.parse(`x[constructor][isBuffer]=value-${index}`, { plainObjects: true });
    qs.stringify(parsed);
  } catch {
    failures.push("attacker controlled isBuffer shape threw");
  }

  assert.deepEqual(failures, []);
  return true;
}
