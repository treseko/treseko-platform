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
  let installed,checkedAt=0,pending;
  const applyIsolationPolicy=(availability)=>{
    if(!supportsScriptIsolation() && process.env.QA_ALLOW_TRUSTED_NATIVE_SCRIPTS!=='1'){
      for(const framework of availability.frameworks.filter(x=>x!=='treseko-api'))availability.unavailable[framework]='Docker isolation required for script execution';
      return {...availability,frameworks:availability.frameworks.filter(x=>x==='treseko-api'),browsers:[]};
    }
    return availability;
  };
  const getAvailability=()=>{
    if((!installed || Date.now()-checkedAt>60000) && !pending) void getAvailability.refresh().catch(()=>{});
    return installed;
  };
  getAvailability.refresh=async()=>{
    if(installed && Date.now()-checkedAt<=60000)return installed;
    if(pending)return pending;
    pending=(async()=>{
      installed=applyIsolationPolicy(await probeRuntimeAvailability({require,python:getPythonCommand()}));
      checkedAt=Date.now();
      return installed;
    })();
    try{return await pending;}finally{pending=undefined;}
  };
  return getAvailability;
}
