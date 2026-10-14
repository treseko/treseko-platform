import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const faker = require("@faker-js/faker/locale/en");
const fakerPackage = require("@faker-js/faker/package.json");

test("installed Faker surface does not expose vulnerable helpers.fake API", () => {
  assert.equal(fakerPackage.version, "5.5.3-treseko.0");
  assert.equal(fakerPackage.tresekoPatchBase, "@faker-js/faker@5.5.3");
  assert.equal(typeof faker.fake, "function");
  assert.equal(faker.helpers?.fake, undefined);
});

test("legacy Faker template resolution cannot execute a function constructor payload", () => {
  globalThis.__tresekoFakerConstructorProbe = false;
  faker.tresekoProbe = () => () => "nested function";

  try {
    assert.throws(
      () => faker.fake("{{tresekoProbe.constructor(globalThis.__tresekoFakerConstructorProbe=true)}}"),
      /Invalid method/,
    );
    assert.equal(globalThis.__tresekoFakerConstructorProbe, false);
  } finally {
    delete faker.tresekoProbe;
    delete globalThis.__tresekoFakerConstructorProbe;
  }
});
