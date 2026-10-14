import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerRunRoutes } from './run-routes.ts';

test('protected temporary upload, range playback and disk deletion', async () => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'treseko-video-routes-'));
 process.env.AI_VIDEO_DIR=root;
 process.env.AI_VIDEO_DISK_RESERVE_MB='0';
 const app=express();
 registerRunRoutes(app,{protectedStoryEndpoint:(req:any,res:any)=> {
  if(req.headers['x-engine-internal-token']!=='controlled-token'){res.sendStatus(401);return false;}return true;
 }});
 const server=app.listen(0,'127.0.0.1');
 await new Promise<void>(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${(server.address() as any).port}`;
 const headers={'x-engine-internal-token':'controlled-token','content-type':'video/webm'};
 try {
  assert.equal((await fetch(base+'/internal/videos/temporary',{method:'POST',body:'invalid'})).status,401);
  assert.equal((await fetch(base+'/internal/videos/temporary',{method:'POST',headers,body:'invalid'})).status,400);
  const bytes=Buffer.from('1a45dfa301020304','hex');
  const upload=await fetch(base+'/internal/videos/temporary',{method:'POST',headers,body:bytes});
  assert.equal(upload.status,201);
  const ref=await upload.json() as any;
  assert.equal(ref.temporary,true);
  assert.ok(fs.existsSync(path.join(root,ref.id,'video.webm')));
  const range=await fetch(base+'/internal/videos/'+ref.id,{headers:{...headers,range:'bytes=0-3'}});
  assert.equal(range.status,206);
  assert.equal(Buffer.from(await range.arrayBuffer()).toString('hex'),'1a45dfa3');
  assert.equal((await fetch(base+'/internal/videos/'+ref.id,{method:'DELETE'})).status,401);
  assert.equal((await fetch(base+'/internal/videos/'+ref.id,{method:'DELETE',headers})).status,204);
  assert.equal(fs.existsSync(path.join(root,ref.id)),false);
  assert.equal((await fetch(base+'/internal/videos/'+ref.id,{headers})).status,404);
 } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));fs.rmSync(root,{recursive:true,force:true});}
});
