import test from 'node:test'
import assert from 'node:assert/strict'
import { downloadCompleteEvidence } from './downloadCompleteEvidence'
const job='11111111-1111-4111-8111-111111111111'
const route=`/automation-jobs/${job}/complete-evidence/22222222-2222-4222-8222-222222222222`
test('complete evidence download uses authenticated fetch and preserves the blob',async()=>{
 const expected=new Blob(['password=original'])
 let fetched='',clicked=false,blob:Blob|undefined
 const anchor={href:'',download:'',click(){clicked=true},remove(){}}
 await downloadCompleteEvidence({jobId:job,url:route,apiBase:'http://backend',fetchWithAuth:async url=>{fetched=url;return {ok:true,blob:async()=>expected} as Response},document:{createElement:()=>anchor,body:{appendChild(){}}} as any,urlApi:{createObjectURL(value){blob=value;return 'blob:controlled'},revokeObjectURL(){}} as any,defer:()=>{}})
 assert.equal(fetched,'http://backend'+route);assert.equal(blob,expected);assert.equal(clicked,true)
 assert.equal(anchor.download,`automation-${job}.json`)
})
test('foreign URLs cannot receive the authenticated request',async()=>{
 let called=false
 await assert.rejects(downloadCompleteEvidence({jobId:job,url:'https://foreign.example/data',apiBase:'http://backend',fetchWithAuth:async()=>{called=true;throw Error()}}))
 assert.equal(called,false)
})
