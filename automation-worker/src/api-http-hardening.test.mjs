import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {requestWithRedirects} from './api-native-http.mjs';
async function fixture(t,handler){const server=http.createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});const url=`http://127.0.0.1:${server.address().port}`;return {url,environment:{url},config:{},allowLoopbackForTests:true,method:'GET',timeoutMs:200};}
test('response bodies above two MiB arrive complete',async t=>{const bytes=Buffer.alloc(3*1024*1024,120);const options=await fixture(t,(_,r)=>r.end(bytes));const result=await requestWithRedirects(options);assert.equal(result.size_bytes,bytes.length);assert.equal(result.body,bytes.toString());});
test('body transfer is covered by the request timeout',async t=>{const options=await fixture(t,(_,r)=>{r.writeHead(200);r.write('partial');});await assert.rejects(requestWithRedirects(options),e=>e.code==='API_TIMEOUT');});
test('lease cancellation aborts an active body transfer',async t=>{const controller=new AbortController();const options=await fixture(t,(_,r)=>{r.writeHead(200);r.write('partial');setTimeout(()=>controller.abort(),20);});await assert.rejects(requestWithRedirects({...options,timeoutMs:1000,signal:controller.signal}),e=>e.code==='LEASE_LOST');});
