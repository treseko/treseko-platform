import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Local operator control only, outside the code/runtime volume. No HTTP API.
export function createUpdateAdmission({ directory, version, pid = process.pid }) {
  if (!path.isAbsolute(directory) || path.parse(directory).root === directory) {
    throw new Error('A dedicated absolute update-control directory is required');
  }
  const instance = randomUUID();
  // Linux container identity: PID alone may be reused after a process exits.
  let processStartTicks = null;
  if (process.platform === 'linux' && pid === process.pid) {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    processStartTicks = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  }
  const requestPath = path.join(directory, 'request.json');
  const receiptPath = path.join(directory, 'status.json');
  const privateOwner = stat => !(stat.mode & 0o022)
    && [0, process.getuid?.()].includes(stat.uid);
  function request() {
    let descriptor;
    try {
      const dir = fs.lstatSync(directory);
      if (!dir.isDirectory() || dir.isSymbolicLink() || !privateOwner(dir)) throw new Error('Unsafe control directory');
      descriptor = fs.openSync(requestPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile() || !privateOwner(stat) || stat.size > 4096) throw new Error('Unsafe control request');
      const buffer = Buffer.alloc(4097);
      const count = fs.readSync(descriptor, buffer);
      const value = JSON.parse(buffer.subarray(0, count).toString('utf8'));
      if (!value || value.schema !== 1 || Object.keys(value).sort().join(',') !== 'schema,transaction'
          || typeof value.transaction !== 'string'
          || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value.transaction)) throw new Error('Invalid update request');
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }
  function pause({ activeJobs, pendingResults, unresolvedClaims = 0 }) {
    let temporary;
    try {
      if (![activeJobs, pendingResults, unresolvedClaims].every(n => Number.isSafeInteger(n) && n >= 0)) {
        throw new Error('Invalid activity counters');
      }
      const intent = request();
      if (!intent) {
        // A stale response must not look like an acknowledgement after resume.
        try {
          const stat = fs.lstatSync(receiptPath);
          if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= 4096
              && JSON.parse(fs.readFileSync(receiptPath, 'utf8')).instance === instance) fs.unlinkSync(receiptPath);
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        return false;
      }
      const ready = activeJobs === 0 && pendingResults === 0 && unresolvedClaims === 0;
      const receipt = { schema: 1, transaction: intent.transaction, instance, pid, version,
        ready, active_jobs: activeJobs, pending_results: pendingResults,
        unresolved_claims: unresolvedClaims, process_start_ticks: processStartTicks,
        observed_at: new Date().toISOString() };
      temporary = path.join(directory, '.status-' + randomUUID());
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(receipt)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temporary, receiptPath);
      temporary = null;
      const dir = fs.openSync(directory, 'r');
      try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
      return true;
    } catch {
      // The control directory is dedicated to this process. Never leave an old
      // ready receipt after failing to validate the current request/activity.
      try {
        const dir = fs.lstatSync(directory);
        if (dir.isDirectory() && !dir.isSymbolicLink() && privateOwner(dir)) {
          fs.unlinkSync(receiptPath); // unlink a final symlink, never its target
        }
      } catch { /* host must also validate freshness and current request */ }
      // A corrupt/unreadable control must never enable new claims or acknowledge
      // readiness. Keep pending delivery processing independent of this gate.
      return true;
    } finally {
      if (temporary) { try { fs.unlinkSync(temporary); } catch { /* retain safe pause */ } }
    }
  }
  function publishIdentity() {
    let temporary;
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const stat = fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || !privateOwner(stat)) throw new Error('Unsafe control directory');
      temporary = path.join(directory, '.runtime-' + randomUUID());
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify({ schema: 1, instance, pid, version,
          process_start_ticks: processStartTicks }));
        fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
      fs.renameSync(temporary, path.join(directory, 'runtime.json'));
      temporary = null;
      const dir = fs.openSync(directory, 'r');
      try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
      return true;
    } catch { return false; }
    finally { if (temporary) { try { fs.unlinkSync(temporary); } catch {} } }
  }
  return { pause, publishIdentity };
}
