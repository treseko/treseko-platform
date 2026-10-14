import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readResultFile} from './result-file.mjs';
test('coordinator reads complete ordinary results and rejects linked result files',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'treseko-result-file-'));
 try{
  const source=path.join(root,'original.json'),linked=path.join(root,'linked.json');
  fs.writeFileSync(source,JSON.stringify({logs:'password=original'}));
  assert.deepEqual(readResultFile(source),{logs:'password=original'});
  fs.symlinkSync(source,linked);assert.throws(()=>readResultFile(linked));fs.unlinkSync(linked);
  fs.linkSync(source,linked);assert.throws(()=>readResultFile(linked),/linked/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
