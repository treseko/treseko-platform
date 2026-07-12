import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ENGINE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(ENGINE_ROOT, '..');
const TRACE_DIR = path.join(REPO_ROOT, 'logs', 'test-trace');

export function traceEnabled() {
  return /^(1|true|yes|on)$/i.test(process.env.QA_TEST_TRACE_ENABLED || '');
}

export function traceRequestId(prefix = 'engine') {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function jsonSafe(value: any): any {
  if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Buffer.isBuffer(value)) return { buffer_base64: value.toString('base64'), bytes: value.length };
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return String(value);
}

export function traceEntry(event: string, payload: Record<string, any> = {}) {
  if (!traceEnabled()) return;
  fs.mkdirSync(TRACE_DIR, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const entry = {
    ts: new Date().toISOString(),
    source: 'engine',
    event,
    ...payload,
  };
  fs.appendFileSync(path.join(TRACE_DIR, `engine-${day}.jsonl`), `${JSON.stringify(jsonSafe(entry))}\n`, 'utf8');
}

