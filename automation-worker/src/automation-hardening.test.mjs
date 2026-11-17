// These native regression fixtures execute only controlled test scripts.
process.env.QA_ALLOW_TRUSTED_NATIVE_SCRIPTS='1';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createScriptRuntime} from './script-runtime.mjs';
import {createArtifactRuntime} from './artifact-runtime.mjs';
import {createLeaseHeartbeat} from './lease-manager.mjs';
const require=createRequire(import.meta.url);
const runtime=createScriptRuntime({require,path,spawn,process,capabilities:()=>({})});
test('legacy Flow Playwright scripts keep the captured origin over environment base_url',()=>{
 const source=runtime.preparePlaywrightTestSource(
  'const baseUrl = variables.base_url || variables.BASE_URL || "https://the-internet.herokuapp.com";\nelse if (candidate.kind === \'role\') locator = page.getByRole(candidate.role, { name: candidate.name, exact: true });\nelse if (candidate.kind === \'text\') locator = page.getByText(candidate.value, { exact: true });\nawait page.goto(new URL("/", baseUrl).toString());',
  {base_url:'http://127.0.0.1:18080'},
 );
 assert.match(source,/const baseUrl = "https:\/\/the-internet\.herokuapp\.com";/);
 assert.match(source,/await page\.goto\(new URL\("\/", baseUrl\)\.toString\(\)\);/);
 assert.match(source,/const selectMatches = await page\.locator\('select'\)\.evaluateAll/);
 assert.match(source,/candidate\.matchCount === matchCount/);
 assert.match(source,/locator = locator\.nth\(candidate\.matchIndex\)/);
 assert.match(source,/const partialText = page\.getByText\(candidate\.value\);/);
 assert.match(source,/String\(candidate\.value\)\.split\(' - ', 1\)/);
 assert.match(source,/"base_url":"http:\/\/127\.0\.0\.1:18080"/);
 assert.doesNotMatch(source,/const baseUrl = variables\.base_url/);
 const legacyHover=runtime.preparePlaywrightTestSource('const target17 = await resolve(page, [{"kind":"text","value":"Skip to content A/B Test Control plus description"}]);\n  await target17.hover();',{});
 assert.match(legacyHover,/const target17 = page\.locator\('body'\);\s+await target17\.hover\(\);/);
 assert.doesNotMatch(legacyHover,/const target17 = await resolve/);
});
test('Playwright scripts with an explicitly variable-driven baseUrl stay unchanged',()=>{
 const script='const baseUrl = variables.base_url; await page.goto(baseUrl);';
 assert.equal(runtime.preferRecordedPlaywrightBaseUrl(script),script);
});
test('generated worker source reports offsets back to authored script lines',()=>{
 assert.equal(runtime.playwrightTestScriptLineOffset('test("case", async ({page}) => {});'),5);
 assert.equal(runtime.playwrightTestScriptLineOffset('import {test} from "@playwright/test";\ntest("case", async ({page}) => {});'),4);
 const python=runtime.prepareSeleniumPythonSource('assert True\nraise RuntimeError("x")',{},{});
 assert.equal(runtime.preparedScriptLineOffset(python,'assert True\nraise RuntimeError("x")'),15);
 const node=runtime.prepareNodeScriptSource('await page.goto("https://example.com");\nthrow new Error("x")',{}, {},'puppeteer');
 assert.equal(runtime.preparedScriptLineOffset(node,'await page.goto("https://example.com");\nthrow new Error("x")'),node.slice(0,node.lastIndexOf('await page.goto')).split('\n').length-1);
});
test('TypeScript function definitions preserve all supplied data',async()=>{
 const fn=runtime.compileScript('async (context: {variables: any}) => ({status:"PASSED", observations: context.variables.password})');
 assert.equal((await fn({variables:{password:'synthetic-password'}})).observations,'synthetic-password');
});
test('loss of lease invokes execution cancellation once',async()=>{
 let lost=0;const heart=createLeaseHeartbeat({heartbeat:async()=>{let error=new Error('replaced');error.http_status=409;throw error;},onLeaseLost:()=>{lost++;},setIntervalFn:()=>({}),clearIntervalFn:()=>{}});
 heart.start();await heart.tick();await heart.tick();assert.equal(lost,1);heart.stop();
});
test('artifact collection preserves large videos and unmodified text',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'treseko-artifact-regression-'));
 try{
  const artifacts=createArtifactRuntime({fs,path,ARTIFACT_MAX_BYTES:10*1024*1024,ARTIFACT_EXTENSIONS:new Set(['.webm','.txt']),redactTraceText:()=> '[redacted]'});
  fs.writeFileSync(path.join(dir,'video.webm'),Buffer.alloc(11*1024*1024,1));
  fs.writeFileSync(path.join(dir,'log.txt'),'password=synthetic-password');
  const items=artifacts.collectArtifacts(dir);
  assert.equal(items.length,2);assert.equal(Buffer.from(items.find(x=>x.filename==='log.txt').base64,'base64').toString(),'password=synthetic-password');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('process runtime cancels all children on abort and keeps full output in a file',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'treseko-process-regression-'));
 try{
  const controller=new AbortController();const call=runtime.runCommand(process.execPath,['-e','console.log("password=synthetic-password");setInterval(()=>{},1000)'],{cwd:dir,timeoutMs:10000,signal:controller.signal});
  const readyUntil=Date.now()+5000;
  while(Date.now()<readyUntil && !fs.readdirSync(dir).some(name=>name.startsWith('.process-output-') && fs.readFileSync(path.join(dir,name,'stdout.txt'),'utf8').includes('synthetic-password'))) await new Promise(resolve=>setTimeout(resolve,10));
  controller.abort();const result=await call;assert.equal(result.cancelled,true);
  assert.ok(result.stdoutPath && fs.readFileSync(result.stdoutPath,'utf8').includes('synthetic-password'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Docker persists pending results and copies vendor before dependency installation',()=>{
 const docker=fs.readFileSync(new URL('../Dockerfile',import.meta.url),'utf8');assert.ok(docker.indexOf('COPY vendor')>=0 && docker.indexOf('COPY vendor')<docker.indexOf('npm ci'));
 const compose=fs.readFileSync(new URL('../../docker-compose.prod.yml',import.meta.url),'utf8');assert.ok(compose.includes('QA_RESULT_SPOOL_DIR: /worker/'));
});
test('declared capacity matches the serial worker',()=>{
 const source=fs.readFileSync(new URL('./worker.mjs',import.meta.url),'utf8');assert.match(source,/const MAX_PARALLEL_JOBS = 1;/);
});
test('isolated worker function enforces timeout and keeps coordinator credentials out',async()=>{
 const {createJobExecutor}=await import('./job-executor.mjs');
 const artifacts=createArtifactRuntime({fs,path,ARTIFACT_EXTENSIONS:new Set(['.webm','.txt','.png'])});
 const executor=createJobExecutor({RUNNER_NAME:'regression',runCommand:runtime.runCommand,playwrightBrowserForJob:()=> 'chromium',shouldRunHeadless:()=>true,normalizeDataset:()=>({}),normalizeJobStatus:x=>x,normalizeStepResult:x=>x,collectArtifacts:artifacts.collectArtifacts,replacePlaceholders:x=>x,frameworkKey:()=> 'playwright',languageKey:()=> 'typescript',localWorkerSupports:()=>true,detectScriptFormat:()=> 'worker_function',setActiveCorrelationId:()=>{},withCorrelation:x=>x});
 const result=await executor({id:'bounded-function',timeout_seconds:1,payload_congelado:{record_video:false,script:'async (context: any) => { await new Promise(resolve => setTimeout(resolve, 5000)); return {status:"PASSED"}; }'}});
 assert.equal(result.status,'TIMEOUT');assert.ok(result.duration_seconds<4);
 process.env.QA_RUNNER_TOKEN='synthetic-coordinator-token';
 try{
  const passed=await executor({id:'private-function',timeout_seconds:30,lease_token:'synthetic-lease',payload_congelado:{record_video:false,script:'async ({variables,job}: any) => { if(process.env.QA_RUNNER_TOKEN || job.lease_token) throw new Error("Coordinator credential reached script"); return {status:"PASSED",observations:variables.password}; }',variables:{password:'synthetic-password'}}});
  assert.equal(passed.status,'PASSED',JSON.stringify(passed));assert.equal(passed.observations,'synthetic-password');
 }finally{delete process.env.QA_RUNNER_TOKEN;}
});
test('availability excludes runtimes whose binaries are missing',async()=>{
 const {probeRuntimeAvailability}=await import('./runtime-availability.mjs');
 const availability=await probeRuntimeAvailability({require:()=>{throw new Error('missing');},fs:{existsSync:()=>false},path,spawnSync:()=>({status:1}),python:'missing'});
 assert.deepEqual(availability.frameworks,['treseko-api']);assert.deepEqual(availability.browsers,[]);assert.equal(availability.playwright_recorder_available,false);
});
test('Playwright Codegen can be available when native script execution remains isolated',async()=>{
 const {probeRuntimeAvailability}=await import('./runtime-availability.mjs');
 const availability=await probeRuntimeAvailability({
  require:(name)=>name==='playwright'?{chromium:{executablePath:()=>'/worker/chromium'},firefox:{executablePath:()=>'/worker/firefox'},webkit:{executablePath:()=>'/worker/webkit'}}:(()=>{throw new Error('missing')})(),
  fs:{existsSync:(candidate)=>candidate==='/worker/chromium'},path,spawnSync:()=>({status:1}),python:'missing',env:{},
 });
 assert.deepEqual(availability.frameworks,['treseko-api','playwright']);assert.deepEqual(availability.browsers,['chromium']);
 assert.equal(availability.playwright_recorder_available,true);
});
test('Puppeteer async executablePath is awaited before runtime availability is advertised',async()=>{
 const {probeRuntimeAvailability}=await import('./runtime-availability.mjs');
 const availability=await probeRuntimeAvailability({
  require:(name)=>name==='puppeteer'?{executablePath:async()=>'/worker/chrome'}:(()=>{throw new Error('missing')})(),
  fs:{existsSync:(candidate)=>candidate==='/worker/chrome'},path,spawnSync:()=>({status:1}),python:'missing',env:{},
 });
 assert.ok(availability.frameworks.includes('puppeteer'));assert.deepEqual(availability.browsers,['chrome (puppeteer)']);
});
test('Puppeteer async executablePath resolves to a string for child process environments',async()=>{
 const runtime=createScriptRuntime({require:()=>({executablePath:async()=>'/worker/chrome'}),path,spawn,process:{env:{}},capabilities:()=>({})});
 assert.equal(await runtime.getPuppeteerExecutablePath(),'/worker/chrome');
});
test('Puppeteer executor passes the resolved executable path to its child process',async()=>{
 const {createJobExecutor}=await import('./job-executor.mjs');
 let childEnv,workspace;
 const executor=createJobExecutor({
  RUNNER_NAME:'puppeteer-regression',ROOT_DIR:process.cwd(),setActiveCorrelationId:()=>{},
  scriptFileForJob:()=> 'job.js',shouldRunHeadless:()=>true,
  getPuppeteerExecutablePath:async()=>'/worker/chrome',
  runCommand:async(_command,_args,options)=>{childEnv=options.env;return {code:0,stdout:'',stderr:'',timedOut:false,cancelled:false};},
  processResultPayload:({framework})=>({status:'PASSED',framework}),
  prepareNodeScriptSource:()=> 'module.exports = {};',getPackageBinPath:()=> '/worker/node_modules/tsx/dist/cli.mjs',
  collectArtifacts:(directory)=>{workspace=directory;return [];},withCorrelation:(result)=>result,
  normalizeDataset:()=>({}),normalizeJobStatus:(value)=>value,normalizeStepResult:(value)=>value,
  replacePlaceholders:(value)=>value,frameworkKey:()=> 'puppeteer',languageKey:()=> 'javascript',localWorkerSupports:()=>true,
 });
 try{
  const result=await executor({id:'puppeteer-async-path',timeout_seconds:5,payload_congelado:{framework:'puppeteer',script:'async () => ({status:"PASSED"})'}});
  assert.equal(result.status,'PASSED');
  assert.equal(childEnv.PUPPETEER_EXECUTABLE_PATH,'/worker/chrome');
  assert.equal(typeof childEnv.PUPPETEER_EXECUTABLE_PATH,'string');
 }finally{if(workspace)fs.rmSync(workspace,{recursive:true,force:true});}
});
test('large result transfer resumes and delivers exact bytes without data replacement',async()=>{
 const {createResultTransport}=await import('./result-transport.mjs');
 const payload={result_event_id:'11111111-1111-4111-8111-111111111111',lease_token:'synthetic',logs:'password=original\n'+'x'.repeat(900000),artifacts:Array.from({length:25},(_,i)=>({filename:`${i}.txt`}))};
 const expected=Buffer.from(JSON.stringify(payload));let received=expected.subarray(0,128);let complete=false;
 const transfer=createResultTransport({api:async(url,options)=>{
  if(url.endsWith('/complete')){complete=true;return {status:'ack'};}
  if(options.method==='POST')return {offset:received.length};
  const offset=Number(url.split('/').pop());assert.equal(offset,received.length);received=Buffer.concat([received,options.body]);return {offset:received.length};
 }});
 await transfer('job',payload);assert.ok(complete);assert.equal(received.toString(),expected.toString());
});
test('Postman executor is a cancellable isolated process',async t=>{
 const http=await import('node:http');
 const server=http.createServer((req,res)=>{res.writeHead(200);res.write('pending');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const {createJobExecutor}=await import('./job-executor.mjs');
 const artifacts=createArtifactRuntime({fs,path,ARTIFACT_EXTENSIONS:new Set(['.json','.txt'])});
 const executor=createJobExecutor({RUNNER_NAME:'regression',runCommand:runtime.runCommand,normalizeDataset:()=>({}),normalizeJobStatus:x=>x,normalizeStepResult:x=>x,collectArtifacts:artifacts.collectArtifacts,replacePlaceholders:x=>x,frameworkKey:()=> 'postman',languageKey:()=> 'javascript',localWorkerSupports:()=>true,setActiveCorrelationId:()=>{},withCorrelation:x=>x,redact:String});
 const controller=new AbortController();setTimeout(()=>controller.abort(),150);
 const result=await executor({id:'postman-cancel',timeout_seconds:1,payload_congelado:{collection:{info:{name:'cancel'},item:[{name:'request',request:{method:'GET',url:`http://127.0.0.1:${server.address().port}/`}}]},allowed_hosts:['127.0.0.1']}},{signal:controller.signal});
 assert.equal(result.status,'BLOCKED');assert.equal(result.metadata.isolated_process,true);
});
test('native execution without filesystem isolation requires explicit trusted mode',async()=>{
 const {runIsolatedCommand}=await import('./process-runtime.mjs');
 await assert.rejects(runIsolatedCommand({spawn:()=>{throw new Error('must not spawn');},process:{platform:'win32',env:{}},sanitizeChildEnv:x=>x},'node',[],{}),error=>error.code==='SCRIPT_ISOLATION_REQUIRED');
});
test('hardened vendor dependencies resolve from the installation root in the lockfile',()=>{
 const lock=JSON.parse(fs.readFileSync(new URL('../package-lock.json',import.meta.url),'utf8'));
 for(const name of ['extract-zip','node-forge','@faker-js/faker'])assert.match(lock.packages[`node_modules/${name}`].resolved,/^(?:file:)?vendor\//);
});
