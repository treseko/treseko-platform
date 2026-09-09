import crypto from "node:crypto";
import dns from "node:dns/promises";

export const API_WORKER_JOB_SCHEMA = "treseko.api-worker-job/v1";
export const API_RESULT_SCHEMA = "treseko.api-result/v1";
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_EVIDENCE_BYTES = 8 * 1024 * 1024;
export const MAX_SCRIPT_EVIDENCE_BYTES = 32 * 1024;
export const MAX_TEXT_BYTES = 12 * 1024;
export const API_CATALOG_VERSION = "postman-dynamic-variables-2026-08";
export const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

const TEMPLATE = /\{\{\s*([^{}]+?)\s*\}\}/g;
const SECRET_KEY = /(authorization|api[_-]?key|cookie|set-cookie|proxy-authorization|password|passwd|secret|client[_-]?secret|access[_-]?token|refresh[_-]?token|credential|private[_-]?key|token)/i;
const DYNAMIC_NAMES = new Set([
  "$guid", "$timestamp", "$isoTimestamp", "$randomUUID", "$uuid", "$randomAlphaNumeric", "$randomBoolean", "$randomInt", "$randomColor", "$randomHexColor", "$randomAbbreviation", "$randomIP", "$randomIPV6", "$randomMACAddress", "$randomPassword", "$randomLocale", "$randomUserAgent", "$randomProtocol", "$randomSemver", "$randomFirstName", "$randomLastName", "$randomFullName", "$randomNamePrefix", "$randomNameSuffix", "$randomJobTitle", "$randomJobArea", "$randomJobDescriptor", "$randomJobType", "$randomPhoneNumber", "$randomPhoneNumberExt", "$randomCity", "$randomStreetName", "$randomStreetAddress", "$randomCountry", "$randomCountryCode", "$randomLatitude", "$randomLongitude", "$randomImageDataUri", "$randomAvatarImage", "$randomImageUrl", "$randomAbstractImage", "$randomNatureImage", "$randomAnimalImage", "$randomFoodImage", "$randomNightlifeImage", "$randomBusinessImage", "$randomSportsImage", "$randomTransportImage", "$randomAnimalsImage", "$randomCatsImage", "$randomCityImage", "$randomFashionImage", "$randomPeopleImage", "$randomCreditCardMask", "$randomBankAccount", "$randomBankAccountName", "$randomBankAccountBic", "$randomBankAccountIban", "$randomTransactionType", "$randomCurrencyCode", "$randomCurrencyName", "$randomCurrencySymbol", "$randomBitcoin", "$randomCompanyName", "$randomCompanySuffix", "$randomBs", "$randomBsAdjective", "$randomBsBuzz", "$randomBsNoun", "$randomCatchPhrase", "$randomCatchPhraseAdjective", "$randomCatchPhraseDescriptor", "$randomCatchPhraseNoun", "$randomDatabaseColumn", "$randomDatabaseType", "$randomDatabaseEngine", "$randomDatabaseCollation", "$randomDateFuture", "$randomDatePast", "$randomDateRecent", "$randomWeekday", "$randomMonth", "$randomDomainName", "$randomDomainSuffix", "$randomDomainWord", "$randomEmail", "$randomExampleEmail", "$randomUserName", "$randomUrl", "$randomFileName", "$randomFileType", "$randomFileExt", "$randomCommonFileName", "$randomCommonFileType", "$randomCommonFileExt", "$randomFilePath", "$randomDirectoryPath", "$randomMimeType", "$randomProductName", "$randomProductAdjective", "$randomProductMaterial", "$randomProduct", "$randomProductDescription", "$randomAdjective", "$randomNoun", "$randomPrice", "$randomDepartment", "$randomVerb", "$randomIngverb", "$randomPhrase", "$randomLoremWord", "$randomLoremWords", "$randomLoremSentence", "$randomLoremSentences", "$randomLoremParagraph", "$randomLoremParagraphs", "$randomLoremSlug", "$randomLoremText", "$randomLoremLines", "$randomWord", "$randomWords",
]);

export class ApiWorkerBlockedError extends Error {
  constructor(message, code = "API_EXECUTION_BLOCKED") {
    super(message);
    this.name = "ApiWorkerBlockedError";
    this.code = code;
  }
}

export function byteLength(value) { return Buffer.byteLength(String(value ?? ""), "utf8"); }
export function clampText(value, maxBytes = MAX_TEXT_BYTES) {
  const text = String(value ?? "");
  if (byteLength(text) <= maxBytes) return text;
  let end = Math.floor(text.length * maxBytes / byteLength(text));
  while (end > 0 && byteLength(text.slice(0, end)) > maxBytes - 18) end -= 1;
  return `${text.slice(0, end)}… [truncado]`;
}
export function stableId(value, prefix = "id") {
  return `${prefix}-${crypto.createHash("sha256").update(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? String(item) : item)).digest("hex").slice(0, 16)}`;
}
function hash(seed) { return crypto.createHash("sha256").update(String(seed ?? "treseko-default-seed")).digest(); }

export function createDeterministicDynamicContext(seed, initialValues = {}) {
  const source = String(seed ?? "treseko-default-seed");
  const digest = hash(source);
  let state = digest.readUInt32BE(0) || 1;
  const values = { ...(initialValues && typeof initialValues === "object" ? initialValues : {}) };
  const occurrences = [];
  const next = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 0x100000000; };
  const choice = (items) => items[Math.floor(next() * items.length) % items.length];
  const token = (name) => crypto.createHash("sha256").update(`${source}:${name}:${Math.floor(next() * 0xffffffff)}`).digest("hex").slice(0, 16);
  const ensure = (name) => {
    if (!DYNAMIC_NAMES.has(name)) throw new ApiWorkerBlockedError(`Variable dinámica no soportada: ${name}`, "UNSUPPORTED_DYNAMIC_VARIABLE");
    if (Object.hasOwn(values, name)) return values[name];
    const first = ["Alex", "Camila", "Jordan", "Taylor", "Morgan", "Sam", "Mateo"];
    const last = ["García", "Smith", "Miller", "Rossi", "Brown", "Díaz", "Wilson"];
    const words = ["api", "test", "response", "quality", "service", "request", "data", "contract"];
    let value;
    if (["$guid", "$randomUUID", "$uuid"].includes(name)) {
      const bytes = Buffer.from(hash(`${source}:${name}`).subarray(0, 16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
      const hex = bytes.toString("hex"); value = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
    } else if (name === "$timestamp" || name === "$isoTimestamp") { const seconds = 1577836800 + (digest.readUIntBE(0, 6) % (10 * 365 * 24 * 60 * 60)); value = name === "$timestamp" ? seconds : new Date(seconds * 1000).toISOString(); }
    else if (name === "$randomBoolean") value = next() >= 0.5;
    else if (name === "$randomInt") value = Math.floor(next() * 1001);
    else if (name === "$randomAlphaNumeric") value = choice("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split(""));
    else if (name === "$randomHexColor") value = `#${Math.floor(next() * 0xffffff).toString(16).padStart(6, "0")}`;
    else if (name === "$randomColor") value = choice(["red", "green", "blue", "yellow", "purple", "orange", "black", "white"]);
    else if (name === "$randomFirstName") value = choice(first);
    else if (name === "$randomLastName") value = choice(last);
    else if (name === "$randomFullName") value = `${choice(first)} ${choice(last)}`;
    else if (["$randomEmail", "$randomExampleEmail"].includes(name)) value = `${choice(first).toLowerCase()}.${choice(last).toLowerCase().replaceAll("í", "i")}@example.test`;
    else if (name === "$randomUserName") value = `${choice(first).toLowerCase()}_${choice(last).toLowerCase().replaceAll("í", "i")}`;
    else if (name === "$randomPassword") value = `${token(name)}!Aa9`;
    else if (name === "$randomPhoneNumber" || name === "$randomPhoneNumberExt") value = `+54 11 ${Math.floor(next() * 9000 + 1000)}-${Math.floor(next() * 9000 + 1000)}${name.endsWith("Ext") ? ` x${Math.floor(next() * 900 + 100)}` : ""}`;
    else if (name === "$randomCountryCode") value = choice(["AR", "US", "ES", "BR", "CA"]);
    else if (name === "$randomCountry") value = choice(["Argentina", "United States", "Spain", "Brazil", "Canada"]);
    else if (name === "$randomCity") value = choice(["Buenos Aires", "Córdoba", "Rosario", "Madrid", "Austin", "Toronto"]);
    else if (name === "$randomStreetName") value = choice(["San Martín", "Belgrano", "Independencia", "Libertad"]);
    else if (name === "$randomStreetAddress") value = `${Math.floor(next() * 9999) + 1} ${choice(["San Martín", "Belgrano", "Libertad"])}`;
    else if (name === "$randomUserAgent") value = "TresekoApiTest/1.0";
    else if (name === "$randomProtocol") value = choice(["http", "https"]);
    else if (name === "$randomSemver") value = `${Math.floor(next() * 10)}.${Math.floor(next() * 21)}.${Math.floor(next() * 100)}`;
    else if (name === "$randomIP") value = `11.${Math.floor(next() * 240) + 1}.${Math.floor(next() * 254) + 1}.${Math.floor(next() * 254) + 1}`;
    else if (name === "$randomIPV6") value = `2001:db8::${Math.floor(next() * 65535).toString(16)}`;
    else if (name === "$randomMACAddress") value = Array.from({ length: 6 }, () => Math.floor(next() * 256).toString(16).padStart(2, "0")).join(":");
    else if (name === "$randomImageDataUri") value = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E";
    else if (name.endsWith("Image")) value = `https://picsum.photos/seed/${token(name)}/640/480`;
    else if (name === "$randomCurrencyCode") value = choice(["ARS", "USD", "EUR", "BRL"]);
    else if (name === "$randomCurrencyName") value = choice(["Argentine Peso", "US Dollar", "Euro", "Brazilian Real"]);
    else if (name === "$randomCurrencySymbol") value = choice(["$", "€", "£"]);
    else if (name === "$randomCreditCardMask") value = `************${String(Math.floor(next() * 10000)).padStart(4, "0")}`;
    else if (name === "$randomBankAccount") value = String(Math.floor(next() * 90000000 + 10000000));
    else if (name === "$randomUrl") value = `https://api.example.test/${choice(["health", "status", "items"])}`;
    else if (name === "$randomDomainName") value = `${choice(["api", "qa", "service"])}.example.test`;
    else if (["$randomWords", "$randomLoremWords"].includes(name)) value = Array.from({ length: 4 }, () => choice(words)).join(" ");
    else if (name === "$randomWord" || name === "$randomLoremWord") value = choice(words);
    else if (name === "$randomPrice") value = (next() * 9999 + 1).toFixed(2);
    else value = `${name.slice(1).toLowerCase()}-${token(name)}`;
    values[name] = value; return value;
  };
  const resolve = (value, source = "request") => {
    if (typeof value === "string") {
      const exact = value.match(/^\{\{\s*(\$[A-Za-z][A-Za-z0-9_]*)\s*\}\}$/);
      if (exact) { const resolved = ensure(exact[1]); occurrences.push({ name: exact[1], value: resolved, source }); return resolved; }
      return value.replace(TEMPLATE, (match, raw) => { const name = String(raw).trim(); if (!name.startsWith("$")) return match; const resolved = ensure(name); occurrences.push({ name, value: resolved, source }); return String(resolved); });
    }
    if (Array.isArray(value)) return value.map(item => resolve(item, source));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item, source)]));
    return value;
  };
  return { seed: source, values, occurrences, ensure, resolve };
}

export function toObject(values) { return Array.isArray(values) ? Object.fromEntries(values.filter(item => item && (item.key || item.name)).map(item => [String(item.key || item.name), item.value ?? ""])) : values && typeof values === "object" ? { ...values } : {}; }
export function mergeVariables(environment, config, dataset, shared) {
  const vars = toObject(environment?.variables); const scoped = config?.variables;
  if (scoped && typeof scoped === "object" && ["case", "collection", "local", "global", "data"].some(key => key in scoped)) { Object.assign(vars, toObject(scoped.collection)); Object.assign(vars, toObject(scoped.case || scoped.local)); }
  else Object.assign(vars, toObject(scoped));
  Object.assign(vars, toObject(config?.collection_variables)); Object.assign(vars, toObject(dataset)); Object.assign(vars, toObject(shared)); vars.base_url = environment?.url || vars.base_url || ""; return vars;
}
export function variableValue(variables, name) { return Object.hasOwn(variables, name) ? variables[name] : variables[String(name).split(".").at(-1)]; }
export function resolveVariables(value, variables, dynamic, source = "request") {
  if (typeof value === "string") { const dynamicValue = dynamic.resolve(value, source); if (typeof dynamicValue !== "string") return dynamicValue; return dynamicValue.replace(TEMPLATE, (match, raw) => { const resolved = variableValue(variables, String(raw).trim()); return resolved === undefined || resolved === null ? match : String(resolved); }); }
  if (Array.isArray(value)) return value.map(item => resolveVariables(item, variables, dynamic, source));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveVariables(item, variables, dynamic, source)]));
  return value;
}
export function rejectUnresolvedTemplates(value) { if (typeof value === "string" && TEMPLATE.test(value)) { TEMPLATE.lastIndex = 0; throw new ApiWorkerBlockedError("Hay variables API sin resolver antes de enviar la solicitud", "UNRESOLVED_VARIABLE"); } TEMPLATE.lastIndex = 0; if (Array.isArray(value)) value.forEach(rejectUnresolvedTemplates); else if (value && typeof value === "object") Object.values(value).forEach(rejectUnresolvedTemplates); }
export function enabledPairs(value) { if (value && !Array.isArray(value) && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => key)); return Object.fromEntries((value || []).filter(item => item && item.enabled !== false && item.disabled !== true && (item.key || item.name)).map(item => [String(item.key || item.name), item.value ?? ""])); }
export function jsonPath(value, selector = "$") { const path = String(selector || "$").trim(); if (path === "$") return value; if (!path.startsWith("$")) throw new ApiWorkerBlockedError("JSONPath inválido", "INVALID_JSONPATH"); const tokens = [...path.slice(1).matchAll(/\.([A-Za-z_][\w-]*)|\[(\d+|['"][^'"]+['"])\]/g)].map(m => m[1] || m[2]?.replace(/^['"]|['"]$/g, "")); let current = value; for (const token of tokens) { if (current == null) return undefined; current = current[token]; } return current; }

function privateAddress(address) {
  const value = String(address).toLowerCase().replace(/^\[|\]$/g, "");
  if (value === "localhost" || value === "::" || value === "::1" || value === "0:0:0:0:0:0:0:0" || value === "0:0:0:0:0:0:0:1") return true;
  // Reject all IPv4-mapped IPv6 literals: URL parsers may canonicalize their
  // dotted suffix to hexadecimal, which makes address-policy checks ambiguous.
  if (value.startsWith("::ffff:")) return true;
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return value.startsWith("fc") || value.startsWith("fd") || /^fe[89ab]/.test(value);
  const [a, b, c, d] = match.slice(1).map(Number); return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0 && c === 0) || d < 0;
}
function normalizeHost(value) { return String(value || "").toLowerCase().replace(/^https?:\/\//, "").split("/")[0].replace(/\.$/, ""); }
function hostAllowed(host, allowlist) { const normalized = String(host).toLowerCase().replace(/\.$/, ""); return allowlist.some(item => item === normalized || (item.startsWith("*.") && normalized.endsWith(item.slice(1)) && normalized.length > item.length - 1)); }
export async function validateDestination(rawUrl, environment, config, { allowLoopbackForTests = false } = {}) {
  let parsed; try { parsed = new URL(String(rawUrl)); } catch { throw new ApiWorkerBlockedError("El destino no es una URL HTTP/HTTPS válida", "INVALID_DESTINATION"); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new ApiWorkerBlockedError("El destino debe usar HTTP/HTTPS sin credenciales embebidas", "INVALID_DESTINATION");
  let base; try { base = new URL(String(environment?.url || "")); } catch { throw new ApiWorkerBlockedError("La URL del ambiente no es válida", "ENVIRONMENT_URL_MISSING"); }
  const allowlist = [base.hostname, ...(environment?.allowed_hosts || []), ...(environment?.configuracion_api?.allowed_hosts || []), ...(config?.allowed_hosts || [])].map(normalizeHost).filter(Boolean);
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostAllowed(host, allowlist)) throw new ApiWorkerBlockedError("Destino bloqueado: el host no pertenece a la allowlist del ambiente", "DESTINATION_NOT_ALLOWED");
  if (["169.254.169.254", "metadata.google.internal", "metadata.azure.internal"].includes(host)) throw new ApiWorkerBlockedError("Destino bloqueado por política SSRF", "SSRF_BLOCKED");
  let addresses; const looksIp = /^[0-9a-f:.]+$/i.test(host) && (host.includes(".") || host.includes(":"));
  try { addresses = looksIp ? [host] : (await dns.lookup(host, { all: true, verbatim: true })).map(item => item.address); } catch { throw new ApiWorkerBlockedError("No se pudo resolver el destino", "DNS_RESOLUTION_FAILED"); }
  for (const address of addresses) if (privateAddress(address)) { const loopback = allowLoopbackForTests && ["localhost", "127.0.0.1", "::1"].includes(host) && (/^127\./.test(address) || address === "::1"); if (!loopback) throw new ApiWorkerBlockedError("Destino bloqueado por política SSRF", "SSRF_BLOCKED"); }
  return parsed;
}

export function secretSetFromVariables(variables) { return new Set(Object.entries(variables || {}).filter(([key, value]) => SECRET_KEY.test(key) || (typeof value === "string" && value.length >= 4)).map(([, value]) => String(value))); }
export function redactValue(value, secrets = new Set(), key = "", preserve = false) {
  if (preserve) return value;
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") { let text = value; for (const secret of secrets) if (secret && secret.length >= 4) text = text.split(secret).join("[REDACTED]"); return clampText(text, MAX_RESPONSE_BYTES); }
  if (Array.isArray(value)) return value.map(item => redactValue(item, secrets, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([itemKey, item]) => [itemKey, redactValue(item, secrets, itemKey)]));
  return value;
}
export function redactError(value, secrets) { return clampText(redactValue(String(value ?? "Error de ejecución"), secrets), 4000); }
export function publicEvidenceEnabled(environment, config) { return Boolean(environment?.configuracion_api?.evidence_policy?.public_test_data || config?.evidence_policy?.public_test_data); }
export function safeJsonClone(value) { try { return structuredClone(value); } catch { return {}; } }
