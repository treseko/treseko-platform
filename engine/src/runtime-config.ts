import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function envFlag(name: string, defaultValue = false): boolean {
  const value = process.env[name];
  if (value === undefined || value === '') return defaultValue;
  return /^(1|true|yes|on)$/i.test(value);
}

function readVersion(): string {
  const candidates = [
    process.env.TRESEKO_VERSION,
    process.env.npm_package_version,
    path.resolve(process.cwd(), 'VERSION'),
    path.resolve(__dirname, '../VERSION'),
    path.resolve(__dirname, '../../VERSION'),
    '/VERSION',
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (!candidate.includes('/') && !candidate.includes('\\')) return candidate.trim();
    try {
      if (fs.existsSync(candidate)) {
        const version = fs.readFileSync(candidate, 'utf8').trim();
        if (version) return version;
      }
    } catch (_) {
      // Version lookup must never prevent engine startup.
    }
  }
  return '0.9.0-rc.1';
}

export function safePathSegment(value: string | undefined, fallback = 'default'): string {
  const normalized = (value || fallback).toString().trim();
  return normalized.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || fallback;
}

export const ENGINE_VERSION = readVersion();
export const ENGINE_NAME = `Treseko Engine ${ENGINE_VERSION}`;
export const ENGINE_LOG_DIR = process.env.ENGINE_LOG_DIR || 'logs';
export const ENGINE_REPORTS_DIR = process.env.ENGINE_REPORTS_DIR || 'reports';
export const ENGINE_LOCAL_EVIDENCE_ENABLED =
  envFlag('ENGINE_LOCAL_EVIDENCE_ENABLED') || envFlag('ENGINE_LOCAL_REPORTS_ENABLED');

