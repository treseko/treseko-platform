"""Read-only Docker worker drain check; pause request is owned by coordinator."""
import argparse
import json
from pathlib import PurePosixPath
import re
import sys

from .update_component_probe import DockerContainerProbe
from .update_transaction import TransactionFailure


CHECK = r'''
const fs = require('fs');
const path = require('path');
const [directory, script, transaction, mode] = process.argv.slice(1);
function safe(stat) { return !(stat.mode & 0o022) && [0, process.getuid()].includes(stat.uid); }
function read(name) {
  const fd = fs.openSync(path.join(directory, name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || !safe(stat) || stat.size > 4096) throw Error();
    const buffer = Buffer.alloc(4097);
    const count = fs.readSync(fd, buffer);
    return JSON.parse(buffer.subarray(0, count).toString('utf8'));
  } finally { fs.closeSync(fd); }
}
const dir = fs.lstatSync(directory);
if (!dir.isDirectory() || dir.isSymbolicLink() || !safe(dir)) throw Error();
const probing = mode === 'probe';
const receipt = read(probing ? 'runtime.json' : 'status.json');
if(!probing) {
const request = read('request.json');
if (request.schema !== 1 || request.transaction !== transaction
    || Object.keys(request).sort().join(',') !== 'schema,transaction'
    || receipt.schema !== 1 || receipt.transaction !== transaction || receipt.ready !== true
    || receipt.active_jobs !== 0 || receipt.pending_results !== 0 || receipt.unresolved_claims !== 0) throw Error();
const age = Date.now() - Date.parse(receipt.observed_at);
if (!Number.isFinite(age) || age < 0 || age > 5000) throw Error();
}
if(receipt.schema !== 1 || !Number.isSafeInteger(receipt.pid) || receipt.pid <= 0
    || typeof receipt.process_start_ticks !== 'string' || !/^[0-9]+$/.test(receipt.process_start_ticks)) throw Error();
if(probing && (typeof receipt.version !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9.-]+)?$/.test(receipt.version))) throw Error();
const stat = fs.readFileSync(`/proc/${receipt.pid}/stat`, 'utf8');
const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
if (fields[0] === 'Z' || fields[19] !== receipt.process_start_ticks) throw Error();
const argv = fs.readFileSync(`/proc/${receipt.pid}/cmdline`, 'utf8').split('\0');
if (!argv.includes(script)) throw Error();
if (!probing && read('request.json').transaction !== transaction) throw Error();
process.stdout.write(JSON.stringify({ready:true, version:receipt.version}));
'''


class DockerWorkerDrain(DockerContainerProbe):
    def __init__(self, docker, directory, script):
        super().__init__(docker)
        for value in (directory, script):
            if not PurePosixPath(value).is_absolute() or value == '/' or '..' in PurePosixPath(value).parts:
                raise ValueError("Explicit absolute worker control paths required")
        self.directory, self.script = directory, script

    def drain(self, context):
        self._check(context)
        return True

    def probe(self, context):
        return self._check(context, probing=True)['version']

    def _check(self, context, probing=False):
        if (context.get("component") != "automation_worker"
                or not re.fullmatch(r"[a-f0-9]{64}", context.get("container_id", ""))
                or not re.fullmatch(r"sha256:[a-f0-9]{64}", context.get("image_id", ""))
                or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}", context.get("transaction", ""))):
            raise ValueError("Pinned worker/transaction identity required")
        before = self._identity(context)
        receipt = self._run(["exec", context["container_id"], "node", "-e", CHECK,
                             self.directory, self.script, context["transaction"], *(['probe'] if probing else [])])
        if receipt.get("ready") is not True or self._identity(context) != before:
            raise TransactionFailure("Worker drain was not confirmed")
        return receipt


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--docker', required=True)
    parser.add_argument('--directory', required=True)
    parser.add_argument('--script', required=True)
    parser.add_argument('--probe', action='store_true')
    args = parser.parse_args()
    try:
        raw = sys.stdin.buffer.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise ValueError("Oversized drain envelope")
        request = json.loads(raw)
        context = request['context']
        operation, check = ('verify', 'probe') if args.probe else ('quiesce', 'drain')
        if request.get('schema') != 1 or request.get('operation') != operation or context.get('check') != check:
            raise ValueError("Drain check required")
        checker = DockerWorkerDrain(args.docker, args.directory, args.script)
        result = {'version': checker.probe(context)} if args.probe else {'drained': checker.drain(context)}
        print(json.dumps({**result, 'schema': 1, 'ok': True, 'operation': operation,
                          'transaction': context['transaction'], 'participant': context['participant']}))
        return 0
    except Exception:
        print(json.dumps({'ok': False, 'error': 'worker_drain_unconfirmed'}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
