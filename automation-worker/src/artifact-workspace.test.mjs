import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createArtifactRuntime} from './artifact-runtime.mjs';
const runtime=createArtifactRuntime({fs,path,ARTIFACT_EXTENSIONS:new Set(['.json','.txt','.png'])});
test('worker-owned runtime files are excluded while user evidence names are preserved',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'treseko-artifact-contract-'));
 try{
  fs.mkdirSync(path.join(root,'.treseko-runtime','.pki'),{recursive:true});fs.mkdirSync(path.join(root,'reports'));
  fs.writeFileSync(path.join(root,'package.json'),'{"type":"commonjs"}');
  fs.writeFileSync(path.join(root,'.treseko-runtime','.pki','pkcs11.txt'),'browser configuration');
  fs.writeFileSync(path.join(root,'reports','package.json'),'user business payload');
  fs.writeFileSync(path.join(root,'reports','pkcs11.txt'),'user test evidence');
  fs.writeFileSync(path.join(root,'execution-final.png'),'test image bytes');
  const artifacts=runtime.collectArtifacts(root,{workerWorkspace:true});
  assert.equal(artifacts.length,3);
  assert.equal(artifacts.find(x=>x.filename==='package.json').base64,Buffer.from('user business payload').toString('base64'));
  assert.equal(artifacts.find(x=>x.filename==='pkcs11.txt').base64,Buffer.from('user test evidence').toString('base64'));
  assert.equal(runtime.collectArtifacts(root).length,5,'generic collection has no reserved worker exclusions');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('unsafe runtime home rejects before spawn and closes process output files',async()=>{
 const {runIsolatedCommand}=await import('./process-runtime.mjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'treseko-runtime-home-'));
 const outside=fs.mkdtempSync(path.join(os.tmpdir(),'treseko-runtime-outside-'));
 const originalClose=fs.closeSync;const closed=[];let spawned=false;
 try{
  fs.symlinkSync(outside,path.join(root,'.treseko-runtime'),'dir');
  fs.closeSync=fd=>{closed.push(fd);return originalClose(fd);};
  await assert.rejects(runIsolatedCommand({spawn:()=>{spawned=true;},process:{platform:'linux',getuid:()=>0,env:{QA_ALLOW_TRUSTED_NATIVE_SCRIPTS:'1'}},sanitizeChildEnv:x=>x},'node',[],{cwd:root}),/Unsafe runtime home directory/);
  assert.equal(spawned,false);assert.equal(closed.length,2);
  assert.deepEqual(fs.readdirSync(outside),[]);
 }finally{fs.closeSync=originalClose;fs.rmSync(root,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true});}
});
