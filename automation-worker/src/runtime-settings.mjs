import {supportsScriptIsolation} from './process-runtime.mjs';
import {probeRuntimeAvailability} from './runtime-availability.mjs';
export function getPythonCommand(){
  return process.env.QA_PYTHON_BIN || (process.platform==='win32'?'python':'python3');
}
export function isInvalidRunnerTokenError(error){
  const code=String(error?.error_code || '').toUpperCase();
  const message=String(error?.message || '');
  return code==='UNAUTHORIZED' || code==='HTTP_401' || /runner token invalido/i.test(message);
}
export function createRuntimeAvailabilityCache(require){
  let installed,checkedAt=0;
  return ()=>{
    if(!installed || Date.now()-checkedAt>60000){
      installed=probeRuntimeAvailability({require,python:getPythonCommand()});checkedAt=Date.now();
      if(!supportsScriptIsolation() && process.env.QA_ALLOW_TRUSTED_NATIVE_SCRIPTS!=='1'){
        for(const framework of installed.frameworks.filter(x=>x!=='treseko-api'))installed.unavailable[framework]='Docker isolation required for script execution';
        installed={...installed,frameworks:installed.frameworks.filter(x=>x==='treseko-api'),browsers:[]};
      }
    }
    return installed;
  };
}
