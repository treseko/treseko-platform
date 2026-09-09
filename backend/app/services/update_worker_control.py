"""Transaction-owned worker pause request. Called only under participant lock."""
from pathlib import PurePosixPath
import re

from .update_component_probe import DockerContainerProbe
from .update_transaction import TransactionFailure


CONTROL = r'''
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const [directory, transaction, action] = process.argv.slice(1);
const safe = s => !(s.mode & 0o022) && [0,process.getuid()].includes(s.uid);
if(action==='pause') fs.mkdirSync(directory,{recursive:true,mode:0o700});
const dir=fs.lstatSync(directory);
if(!dir.isDirectory() || dir.isSymbolicLink() || !safe(dir)) throw Error();
const request=path.join(directory,'request.json');
function read() {
  let fd;
  try {
    fd=fs.openSync(request,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    const stat=fs.fstatSync(fd);
    if(!stat.isFile() || !safe(stat) || stat.size>4096) throw Error();
    const b=Buffer.alloc(4097), n=fs.readSync(fd,b);
    const v=JSON.parse(b.subarray(0,n).toString('utf8'));
    if(v.schema!==1 || v.transaction!==transaction || Object.keys(v).sort().join(',')!=='schema,transaction') throw Error();
    return true;
  } catch(e) { if(e.code==='ENOENT') return false; throw e; }
  finally { if(fd!==undefined) fs.closeSync(fd); }
}
if(action==='pause' && !read()) {
  const tmp=path.join(directory,'.request-'+crypto.randomUUID());
  try {
    const fd=fs.openSync(tmp,'wx',0o600);
    try {fs.writeFileSync(fd,JSON.stringify({schema:1,transaction}));fs.fsyncSync(fd);}
    finally {fs.closeSync(fd);}
    try {fs.linkSync(tmp,request);} catch(e) {if(e.code!=='EEXIST') throw e;}
    if(!read()) throw Error();
  } finally {try {fs.unlinkSync(tmp);}catch{}}
} else if(action==='resume' && read()) fs.unlinkSync(request);
const fd=fs.openSync(directory,'r');
try {fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
process.stdout.write(JSON.stringify({ok:true,transaction,action}));
'''


class DockerWorkerControl(DockerContainerProbe):
    def __init__(self, docker, directory):
        super().__init__(docker)
        if not PurePosixPath(directory).is_absolute() or directory == '/' or '..' in PurePosixPath(directory).parts:
            raise ValueError("Explicit private worker control path required")
        self.directory = directory

    def change(self, action, context):
        if (action not in {'pause', 'resume'} or context.get('component') != 'automation_worker'
                or not re.fullmatch(r'[a-f0-9]{64}', context.get('container_id', ''))
                or not re.fullmatch(r'sha256:[a-f0-9]{64}', context.get('image_id', ''))
                or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}', context.get('transaction', ''))):
            raise ValueError("Pinned worker transaction required")
        before = self._identity(context)
        response = self._run(['exec', context['container_id'], 'node', '-e', CONTROL,
                              self.directory, context['transaction'], action])
        if (response != {'ok': True, 'transaction': context['transaction'], 'action': action}
                or self._identity(context) != before):
            raise TransactionFailure("Worker control outcome is uncertain")
