import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

export function probeRuntimeAvailability({require, fs:files=fs, path:paths=path, spawnSync:command=spawnSync, python='python3'}={}) {
  const frameworks=['treseko-api'],browsers=[],unavailable={};
  const inspect=(name,check)=>{try{if(check()){frameworks.push(name);return;}unavailable[name]='Executable or runtime missing';}catch{unavailable[name]='Package or runtime missing';}};
  inspect('playwright',()=>{const installed=require('playwright');for(const name of ['chromium','firefox','webkit'])if(files.existsSync(installed[name].executablePath()))browsers.push(name);return browsers.length>0;});
  inspect('puppeteer',()=>{const runtime=require('puppeteer');const exists=files.existsSync(runtime.executablePath());if(exists)browsers.push('chrome (puppeteer)');return exists;});
  inspect('cypress',()=>{const runtime=require('cypress');const version=require('cypress/package.json').version;const root=paths.join(runtime.cache.path(),version,'Cypress');const exists=files.existsSync(paths.join(root,process.platform==='win32'?'Cypress.exe':'Cypress')) || files.existsSync(paths.join(root,'Cypress.app'));if(exists)browsers.push('cypress');return exists;});
  inspect('postman',()=>Boolean(require('postman-runtime') && require('postman-collection')));
  inspect('selenium',()=>command(python,['-c',"import selenium, shutil; assert (shutil.which('chromedriver') and (shutil.which('google-chrome') or shutil.which('chromium') or shutil.which('chrome'))) or (shutil.which('geckodriver') and shutil.which('firefox'))"],{timeout:3000,encoding:'utf8',windowsHide:true}).status===0);
  return {frameworks,browsers,unavailable};
}
