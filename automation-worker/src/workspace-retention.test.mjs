import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createJobWorkspace,confirmJobWorkspaces} from './workspace-retention.mjs';
test('job evidence survives restart and only confirmed job workspaces are removed',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'treseko-workspace-retention-'));
 try{
  const first=createJobWorkspace('job-one','function',root);
  const second=createJobWorkspace('job-two','function',root);
  fs.writeFileSync(path.join(first,'evidence.txt'),'password=original');
  assert.equal(fs.readFileSync(path.join(first,'evidence.txt'),'utf8'),'password=original');
  confirmJobWorkspaces('job-one',root);
  assert.equal(fs.existsSync(first),false);assert.ok(fs.existsSync(second));
  confirmJobWorkspaces('job-one',root);assert.ok(fs.existsSync(second));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('workspace has an explicit CommonJS package boundary for generated Node scripts',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'treseko-workspace-module-'));
 try{const workspace=createJobWorkspace('module-check','node',root);assert.equal(JSON.parse(fs.readFileSync(path.join(workspace,'package.json'),'utf8')).type,'commonjs');}
 finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('acknowledging a retry cannot delete an earlier unconfirmed attempt',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'treseko-workspace-attempts-'));
 try{
  const earlier=createJobWorkspace('same-job','old',root);
  fs.writeFileSync(path.join(earlier,'original.txt'),'unconfirmed original');
  const current=createJobWorkspace('same-job','current',root);
  confirmJobWorkspaces('same-job',root);
  assert.equal(fs.readFileSync(path.join(earlier,'original.txt'),'utf8'),'unconfirmed original');
  assert.equal(fs.existsSync(current),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
