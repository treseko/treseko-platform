// These native regression fixtures execute only controlled test scripts.
process.env.QA_ALLOW_TRUSTED_NATIVE_SCRIPTS='1';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createJobExecutor } from './job-executor.mjs';
import { createArtifactRuntime } from './artifact-runtime.mjs';
import { createScriptRuntime } from './script-runtime.mjs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { parsePlaywrightJsonReport, compactPlaywrightMetadata } from './worker.mjs';

const require=createRequire(import.meta.url);
const processRuntime=createScriptRuntime({require,path,spawn,process,capabilities:()=>({})});
const artifacts = createArtifactRuntime({fs,path,ARTIFACT_MAX_BYTES:10*1024*1024,ARTIFACT_EXTENSIONS:new Set(['.webm','.png'])});
const execute = createJobExecutor({
 RUNNER_NAME:'Video validation', runCommand:processRuntime.runCommand,
 playwrightBrowserForJob:()=> 'chromium', shouldRunHeadless:()=>true,
 compileScript:()=>async ({page,assert})=> {
   await page.setContent('<h1>Worker video validation</h1>');
   await page.waitForTimeout(900);
   assert.equal(await page.locator('h1').textContent(),'Worker video validation');
   return {status:'PASSED'};
 },
 normalizeDataset:()=>({}), normalizeJobStatus:value=>value, normalizeStepResult:value=>value,
 formatLogArg:String, formatErrorDetail:value=>value||'', redact:value=>value,
 getPlaywrightVersion:()=> 'test', isDebugMode:()=>false, isAssertionLike:()=>false,
 artifactFromBuffer:artifacts.artifactFromBuffer, collectArtifacts:artifacts.collectArtifacts,
 replacePlaceholders:value=>value, frameworkKey:()=> 'playwright', languageKey:()=> 'javascript',
 localWorkerSupports:()=>true, detectScriptFormat:()=> 'worker_function',
 setActiveCorrelationId:()=>{}, withCorrelation:value=>value,
});
for (const record_video of [true,false]) test(`real worker browser video recording=${record_video}`,async()=>{
 const result=await execute({id:'video-check',payload_congelado:{script:'async ({page,assert}) => { await page.setContent("<h1>Worker video validation</h1>"); await page.waitForTimeout(900); assert.equal(await page.locator("h1").textContent(),"Worker video validation"); return {status:"PASSED"}; }',record_video}});
 assert.equal(result.status,'PASSED',result.error_message);
 const videos=result.artifacts.filter(item=>item.content_type==='video/webm');
 assert.equal(videos.length,record_video?1:0);
 if(record_video) assert.equal(Buffer.from(videos[0].base64,'base64').subarray(0,4).toString('hex'),'1a45dfa3');
 assert.equal(result.metadata.video_status,record_video?'AVAILABLE':'DISABLED');
});

for (const record_video of [true,false]) test(`real Playwright Test video recording=${record_video}`,async()=>{
 const runner=createJobExecutor({
  RUNNER_NAME:'Video validation', normalizeDataset:()=>({}), playwrightBrowserForJob:()=> 'chromium', shouldRunHeadless:()=>true,
  scriptFileForJob:()=> 'job.spec.js',
  preparePlaywrightTestSource:()=> `const {test,expect}=require(${JSON.stringify(require.resolve('playwright/test'))});test('recording',async({page})=>{await page.setContent('<h1>Recorded Playwright Test</h1>');await page.waitForTimeout(800);await expect(page.locator('h1')).toHaveText('Recorded Playwright Test');});`,
  getPlaywrightCliPath:()=> path.join(path.dirname(require.resolve('playwright/package.json')),'cli.js'),
  runCommand:(command,args,options)=>new Promise((resolve,reject)=>{
   const child=spawn(command,args,{cwd:options.cwd,env:options.env});let stdout='',stderr='';
   child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
   child.once('error',reject);child.once('close',code=>resolve({code,stdout,stderr}));
  }),
  parsePlaywrightJsonReport, summarizePlaywrightReport:()=>({text:'Controlled Playwright Test',tests:[]}),compactPlaywrightMetadata,
  classifyPlaywrightFailure:()=> 'ERROR',withCorrelation:value=>value,collectArtifacts:artifacts.collectArtifacts,
  playwrightReportArtifact:()=>null,getPlaywrightVersion:()=> 'test',isDebugMode:()=>false,redact:value=>value,
  replacePlaceholders:value=>value,frameworkKey:()=> 'playwright',languageKey:()=> 'javascript',localWorkerSupports:()=>true,
  detectScriptFormat:()=> 'playwright_test',setActiveCorrelationId:()=>{},
 });
 const result=await runner({id:'playwright-video-check',timeout_seconds:15,payload_congelado:{script:'controlled',script_format:'playwright_test',record_video}});
 assert.equal(result.status,'PASSED',result.error_message);
 assert.equal(result.artifacts.filter(item=>item.content_type==='video/webm').length,record_video?1:0);
});
