import fs from 'node:fs';
import {executePostmanRuntimeJob} from './postman-runtime.mjs';
const {job,runnerName,resultPath}=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
let result;
try{result=await executePostmanRuntimeJob({job,runnerName});}
catch(error){result={status:'ERROR',error_message:error.stack || String(error),observations:error.message};}
fs.writeFileSync(resultPath,JSON.stringify(result),{mode:0o600});
