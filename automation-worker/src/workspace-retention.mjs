import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
function workspaceRoot(){
 return process.env.QA_JOB_WORKSPACE_DIR || (process.env.QA_RESULT_SPOOL_DIR
  ? path.join(path.dirname(process.env.QA_RESULT_SPOOL_DIR),'job-workspaces')
  : path.join(os.tmpdir(),'treseko-worker-workspaces'));
}
function prefix(jobId){return createHash('sha256').update(String(jobId)).digest('hex')+'-';}
export function createJobWorkspace(jobId,label,root=workspaceRoot()){
 fs.mkdirSync(root,{recursive:true,mode:0o700});
 if(fs.lstatSync(root).isSymbolicLink())throw new Error('Unsafe job workspace directory');
 if(process.platform==='linux' && process.getuid?.()===0){
  // Traversal only; individual directories remain private to their job uid.
  fs.chmodSync(root,0o711);
  if(process.env.QA_RESULT_SPOOL_DIR)fs.chmodSync(path.dirname(root),0o711);
 }
 const workspace=fs.mkdtempSync(path.join(root,prefix(jobId)+String(label).replace(/[^a-z0-9-]/gi,'')+'-'));
 fs.writeFileSync(path.join(workspace,'package.json'),JSON.stringify({type:'commonjs'}),{mode:0o600});
 const registry=path.join(root,'.registry');fs.mkdirSync(registry,{recursive:true,mode:0o700});
 if(fs.lstatSync(registry).isSymbolicLink())throw new Error('Unsafe workspace registry');
 const entry=path.join(registry,prefix(jobId)+'.json');
 const temporary=entry+'.'+process.pid+'.tmp';
 fs.writeFileSync(temporary,JSON.stringify({workspace}),{mode:0o600});
 const descriptor=fs.openSync(temporary,'r');try{fs.fsyncSync(descriptor);}finally{fs.closeSync(descriptor);}
 fs.renameSync(temporary,entry);
 if(process.platform!=='win32'){const directory=fs.openSync(registry,'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}}
 return workspace;
}
export function confirmJobWorkspaces(jobId,root=workspaceRoot()){
 if(!fs.existsSync(root))return;
 if(fs.lstatSync(root).isSymbolicLink())throw new Error('Unsafe job workspace directory');
 const entry=path.join(root,'.registry',prefix(jobId)+'.json');
 if(!fs.existsSync(entry))return;
 if(fs.lstatSync(entry).isSymbolicLink())throw new Error('Unsafe workspace registry');
 const {workspace}=JSON.parse(fs.readFileSync(entry,'utf8'));
 if(path.dirname(workspace)!==root || !path.basename(workspace).startsWith(prefix(jobId)))throw new Error('Unsafe workspace acknowledgement');
 if(fs.existsSync(workspace) && fs.lstatSync(workspace).isDirectory() && !fs.lstatSync(workspace).isSymbolicLink())fs.rmSync(workspace,{recursive:true,force:true});
 fs.unlinkSync(entry);
}
