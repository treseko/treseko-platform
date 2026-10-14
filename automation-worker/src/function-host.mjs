import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {chromium,firefox,webkit} from 'playwright';
import {createScriptRuntime} from './script-runtime.mjs';
const require=createRequire(import.meta.url);
const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const {job,script,variables,browserName,headless,resultPath,workspace}=input;
const {compileScript}=createScriptRuntime({require});
const logPath=path.join(workspace,'function-console.txt');
fs.writeFileSync(logPath,'',{mode:0o600});
let browser,context,page,output;
const log=(...args)=>fs.appendFileSync(logPath,args.map(arg=>typeof arg==='string'?arg:arg instanceof Error?arg.stack:JSON.stringify(arg)).join(' ')+'\n');
const close=async()=>{await context?.close().catch(()=>{});await browser?.close().catch(()=>{});};
process.once('SIGTERM',()=>{void close().finally(()=>process.exit(143));});
try{
 browser=await ({chromium,firefox,webkit})[browserName].launch({headless});
 context=await browser.newContext(job.payload_congelado.record_video===false?{}:{recordVideo:{dir:workspace,size:{width:960,height:540}}});
 page=await context.newPage();
 const fn=compileScript(script);
 output=await fn({page,browser,variables,dataset:input.dataset || {},job,assert,log});
 output={...(output || {}),status:output?.status || 'PASSED',logs:[fs.readFileSync(logPath,'utf8'),output?.logs || ''].filter(Boolean).join('\n')};
}catch(error){
 let screenshot;
 try{if(page){const screenshotPath=path.join(workspace,'failure.png');await page.screenshot({path:screenshotPath,fullPage:true});screenshot=screenshotPath;}}catch{}
 output={status:/Assertion|strictEqual/.test(error?.name+' '+error?.message)?'FAILED':'ERROR',observations:error?.message,error_message:error?.stack || String(error),logs:fs.readFileSync(logPath,'utf8'),steps:[],failure_screenshot:screenshot};
}finally{
 // Preserve the observed final page even when a successful function does
 // not explicitly attach a screenshot. User-returned evidence is untouched.
 if(page && !output?.failure_screenshot){
  try{await page.screenshot({path:path.join(workspace,'execution-final.png'),fullPage:true});}
  catch{if(output)output.metadata={...(output.metadata || {}),final_screenshot_status:'UNAVAILABLE'};}
 }
 await close();if(output)fs.writeFileSync(resultPath,JSON.stringify(output),{mode:0o600});
}
