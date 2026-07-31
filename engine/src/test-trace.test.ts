import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeTracePayload, traceEnabled } from './test-trace.ts';

test('trazas del Engine permanecen deshabilitadas por defecto', () => {
  assert.equal(traceEnabled(), false);
});

test('la implementación de trazas contiene redacción de secretos', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile(new URL('./test-trace.ts', import.meta.url), 'utf8'));
  assert.match(source, /SECRET_KEY/);
  assert.match(source, /\[redacted\]/);
});

test('las trazas redactan secretos dentro de strings y por nombre de campo', () => {
  const sanitized = sanitizeTracePayload({
    request: 'authorization: Bearer super-secret-token',
    headers: { authorization: 'Bearer another-secret' },
    message: 'safe diagnostic',
  });

  assert.equal(sanitized.request, 'authorization: [redacted]');
  assert.equal(sanitized.headers.authorization, '[redacted]');
  assert.equal(sanitized.message, 'safe diagnostic');
});
