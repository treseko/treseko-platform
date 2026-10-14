import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import test from "node:test";

const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(require.resolve("postman-runtime/package.json"));
const forge = runtimeRequire("node-forge");
const forgeVersion = runtimeRequire("node-forge/package.json").version;
const modulus = "E932AC92252F585B3A80A4DD76A897C8B7652952FE788F6EC8DD640587A1EE5647670A8AD4C2BE0F9FA6E49C605ADF77B5174230AF7BD50E5D6D6D6D28CCF0A886A514CC72E51D209CC772A52EF419F6A953F3135929588EBE9B351FCA61CED78F346FE00DBB6306E5C2A4C6DFC3779AF85AB417371CF34D8387B9B30AE46D7A5FF5A655B8D8455F1B94AE736989D60A6F2FD5CADBFFBD504C5A756A2E6BB5CECC13BCA7503F6DF8B52ACE5C410997E98809DB4DC30D943DE4E812A47553DCE54844A78E36401D13F77DC650619FED88D8B3926E3D8E319C80C744779AC5D6ABE252896950917476ECE5E8FC27D5F053D6018D91B502C4787558A002B9283DA7";
const forgedSignatureHex = "a4ae63dd5e7712b78f4870d0f51e294df5503d4f16c5d27ae33370981fb57f0de49f50f3d6a04666774cd984cd13972db9bf8e12bd294ef0ddc916c7c86cbae63efd7b6b97885e69760c208a40f1aecc76a90d7af5145177efce1bb55807a8d05c20b1596753ba710642fc9acdde6c160232654662c77cc4466c8257a38edb49f894e8845d0fd987b857ced88f4b62505a080bd87ef700d35d392a6e8f6fde34250c50b86fae606cb551215e8f4813239b77651d5565ad453698c071d48c31e8e526fb4a37610f64b3e1fb8e5be5898e408ad08197a0947794a530b54f84485377ce4a7488ed485ce4e5e105dd89698a472f390c3b1b76bc16b73276c4d1c81d";
const forgedPublicKey = forge.pki.setRsaPublicKey(
  new forge.jsbn.BigInteger(modulus, 16),
  new forge.jsbn.BigInteger("3", 10),
);
const forgedSignature = forge.util.hexToBytes(forgedSignatureHex);
const forgedDigest = forge.md.sha256.create();
forgedDigest.update("hello world!");
const forgedDigestBytes = forgedDigest.digest().getBytes();

const validPair = generateKeyPairSync("rsa", { modulusLength: 2048, publicExponent: 65537 });
const validPublicKey = forge.pki.publicKeyFromPem(validPair.publicKey.export({ type: "spki", format: "pem" }));
const validMessage = Buffer.from("node-forge valid signature regression control");
const validSignature = cryptoSign("sha256", validMessage, validPair.privateKey).toString("binary");
const validDigest = forge.md.sha256.create();
validDigest.update(validMessage.toString("binary"));
const validDigestBytes = validDigest.digest().getBytes();

test("node-forge version excludes nested DigestAlgorithm signature forgery", () => {
  const [majorText, minorText, patchText] = forgeVersion.split(".");
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number.parseInt(patchText, 10);
  assert.ok(major > 1 || (major === 1 && (minor > 4 || (minor === 4 && patch > 0))), `node-forge ${forgeVersion} is affected`);
});

for (let index = 0; index < 250; index += 1) {
  test(`reject forged RSA DigestInfo with nested garbage ${index}`, () => {
    assert.throws(
      () => forgedPublicKey.verify(forgedDigestBytes, forgedSignature, undefined, {
        _parseAllDigestBytes: false,
        _skipPaddingChecks: true,
      }),
      /ASN\.1 object does not contain a valid RSASSA-PKCS1-v1_5 DigestInfo value/,
    );
  });
}

for (let index = 0; index < 250; index += 1) {
  test(`accept valid RSA SHA-256 signature control ${index}`, () => {
    assert.equal(validPublicKey.verify(validDigestBytes, validSignature), true);
  });
}
