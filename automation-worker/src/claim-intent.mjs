import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// One private directory per worker process, outside replaceable source code.
// An unresolved intent is not proof that a job was claimed, only uncertainty.
export function createClaimIntent(directory) {
  if (!path.isAbsolute(directory) || path.parse(directory).root === directory) {
    throw new Error('A dedicated absolute claim-intent directory is required');
  }
  const filename = path.join(directory, 'claim.json');
  function ensureDirectory() {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o022)
        || ![0, process.getuid?.()].includes(stat.uid)) throw new Error('Unsafe claim-intent directory');
  }
  function syncDirectory() {
    const fd = fs.openSync(directory, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  function read() {
    ensureDirectory();
    let fd;
    try {
      fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > 4096 || (stat.mode & 0o077)) throw new Error('Unsafe claim intent');
      const buffer = Buffer.alloc(4097);
      const count = fs.readSync(fd, buffer);
      const value = JSON.parse(buffer.subarray(0, count).toString('utf8'));
      if (!value || typeof value.job_id !== 'string'
          || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value.job_id)) throw new Error('Invalid claim intent');
      const keys = Object.keys(value).sort().join(',');
      const legacy = value.schema === 1 && keys === 'job_id,schema';
      const current = value.schema === 2 && keys === 'attempt_id,job_id,schema'
        && typeof value.attempt_id === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.attempt_id);
      if (!legacy && !current) throw new Error('Invalid claim intent');
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  const pending = () => read()?.job_id || null;
  const attemptId = () => read()?.attempt_id || null;
  function begin(jobId) {
    if (typeof jobId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(jobId)) {
      throw new Error('Invalid claim job id');
    }
    ensureDirectory();
    // Exclusive create: a crash/partial write blocks, never silently overwrites.
    const fd = fs.openSync(filename, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify({ schema: 2, job_id: jobId, attempt_id: randomUUID() })); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    syncDirectory();
  }
  function confirmed(jobId) {
    if (pending() !== jobId) return;
    fs.unlinkSync(filename);
    syncDirectory();
  }
  function reconciled(receipt) {
    const current = read();
    if (!current?.attempt_id || !receipt || receipt.schema !== 1
        || receipt.job_id !== current.job_id || receipt.attempt_id !== current.attempt_id
        || !['WAIT', 'CLOSED'].includes(receipt.decision)) {
      throw new Error('Invalid claim reconciliation receipt');
    }
    if (receipt.decision === 'CLOSED') confirmed(current.job_id);
    return receipt.decision;
  }
  return { pending, attemptId, begin, confirmed, reconciled };
}
