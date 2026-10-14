import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
let sequence = 0;
const PREVIEW_BYTES = 2 * 1024 * 1024;

export function supportsScriptIsolation(runtimeProcess=process){
  return runtimeProcess.platform==='linux' && runtimeProcess.getuid?.()===0 && fs.existsSync('/proc/self/status');
}
export function runIsolatedCommand({spawn, process: runtimeProcess, sanitizeChildEnv}, command, args, options = {}) {
  return new Promise((resolve, reject) => {
    if(!supportsScriptIsolation(runtimeProcess) && runtimeProcess.env?.QA_ALLOW_TRUSTED_NATIVE_SCRIPTS!=='1'){
      const error=new Error('La ejecución de scripts requiere el Worker Docker. El modo nativo solo admite scripts confiables con QA_ALLOW_TRUSTED_NATIVE_SCRIPTS=1.');
      error.code='SCRIPT_ISOLATION_REQUIRED';reject(error);return;
    }
    const directory = fs.mkdtempSync(path.join(options.cwd || os.tmpdir(), '.process-output-'));
    const stdoutPath = path.join(directory, 'stdout.txt');
    const stderrPath = path.join(directory, 'stderr.txt');
    const out = fs.openSync(stdoutPath, 'wx', 0o600);
    const err = fs.openSync(stderrPath, 'wx', 0o600);
    let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), timedOut = false, cancelled = false;
    const settings = {cwd:options.cwd, env:sanitizeChildEnv(options.env || runtimeProcess.env), windowsHide:true, detached:runtimeProcess.platform !== 'win32'};
    // A root container coordinator keeps its credentials private while every
    // script runs under a distinct unprivileged uid, including parallel jobs.
    try {
    if (runtimeProcess.platform === 'linux' && runtimeProcess.getuid?.() === 0 && options.cwd) {
      const retainedUids=new Set(fs.readdirSync(path.dirname(options.cwd)).map(name=>{
        try{return fs.lstatSync(path.join(path.dirname(options.cwd),name)).uid;}catch{return 0;}
      }));
      let uid;
      for(let attempt=0;attempt<40000;attempt++){
        const candidate=20000+(sequence++ % 40000);
        if(!retainedUids.has(candidate)){uid=candidate;break;}
      }
      if(!uid){fs.closeSync(out);fs.closeSync(err);reject(new Error('No hay un usuario de aislamiento disponible'));return;}
      const own = entry => {const stat=fs.lstatSync(entry);if(stat.isSymbolicLink())return;if(stat.isDirectory())for(const name of fs.readdirSync(entry))own(path.join(entry,name));fs.chownSync(entry,uid,uid);};
      const runtimeHome=path.join(options.cwd,'.treseko-runtime');
      fs.mkdirSync(runtimeHome,{recursive:true,mode:0o700});
      if(fs.lstatSync(runtimeHome).isSymbolicLink())throw new Error('Unsafe runtime home directory');
      own(options.cwd); settings.uid=uid;settings.gid=uid; settings.env.HOME=runtimeHome;
    }
    } catch(error) {fs.closeSync(out);fs.closeSync(err);reject(error);return;}
    let child;
    try {child = spawn(command,args,settings);} catch(error){fs.closeSync(out);fs.closeSync(err);reject(error);return;}
    let forceTimer,termination;
    const stopUid=signal=>{
      if(runtimeProcess.platform!=='linux' || settings.uid===undefined)return;
      for(const identifier of fs.readdirSync('/proc').filter(name=>/^\d+$/.test(name))){
        try{
          const status=fs.readFileSync(`/proc/${identifier}/status`,'utf8');
          const uid=Number(status.match(/^Uid:\s+(\d+)/m)?.[1]);
          if(uid===settings.uid)runtimeProcess.kill(Number(identifier),signal);
        }catch{/* Process may have exited between enumeration and signal. */}
      }
    };
    const terminate = () => {
      if(termination)return;
      termination=new Promise(done=>{
        if (runtimeProcess.platform === 'win32') {
          const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
          killer.on('error',()=>{try{child.kill();}catch{}done();});killer.on('close',done);
        } else {
          stopUid(cancelled?'SIGKILL':'SIGTERM');
          try{runtimeProcess.kill(-child.pid,cancelled?'SIGKILL':'SIGTERM');}catch{try{child.kill('SIGTERM');}catch{}}
          forceTimer=setTimeout(()=>{stopUid('SIGKILL');try{runtimeProcess.kill(-child.pid,'SIGKILL');}catch{}done();},cancelled?0:1000);
        }
      });
    };
    const abort=()=>{cancelled=true;terminate();};
    const timer=setTimeout(()=>{timedOut=true;terminate();},options.timeoutMs || 300000);
    options.signal?.addEventListener('abort',abort,{once:true});
    if(options.signal?.aborted)abort();
    let closed=false;
    let storageError;
    const finish=async(code,error)=>{
      if(closed)return;closed=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);
      if(termination)await termination;
      stopUid('SIGKILL');
      fs.closeSync(out);fs.closeSync(err);
      // A completed job cannot leave detached processes under its private uid.
      if(storageError){reject(storageError);return;}
      resolve({code:code ?? 1,stdout:stdout.toString(),stderr:stderr.toString(),stdoutPath,stderrPath,timedOut,cancelled,error});
    };
    const capture=(fd,chunk,kind)=>{try{let offset=0;while(offset<chunk.length){const written=fs.writeSync(fd,chunk,offset,chunk.length-offset);if(!written)throw new Error("No se pudo conservar la salida completa del proceso");offset+=written;}}catch(error){storageError=error;terminate();return;}const current=kind==='out'?stdout:stderr;const available=PREVIEW_BYTES-current.length;if(available>0){const updated=Buffer.concat([current,chunk.subarray(0,available)]);if(kind==='out')stdout=updated;else stderr=updated;}};
    child.stdout.on('data',chunk=>capture(out,chunk,'out'));child.stderr.on('data',chunk=>capture(err,chunk,'err'));
    child.on('error',error=>finish(1,error.message));child.on('close',code=>finish(code));
  });
}
