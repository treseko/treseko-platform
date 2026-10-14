import {describe,it,expect,vi} from 'vitest'
import {createExecutionActions} from './executionActions'

describe('manual execution details loading',()=>{
 it('does not refresh an unsaved draft',async()=>{
  const fetchWithAuth=vi.fn()
  const actions=createExecutionActions({fetchWithAuth,executionDraftRef:{current:{dirty:true,version:1}}} as any)
  expect(await actions.loadExecutionDetails('run','case')).toBeNull()
  expect(fetchWithAuth).not.toHaveBeenCalled()
 })
 it('does not replace a draft edited while details were loading',async()=>{
  let release!:()=>void
  const waiting=new Promise<void>(resolve=>{release=resolve})
  const draft={current:{dirty:false,version:0}}
  const setters=Object.fromEntries(['setCurrentExecutionRun','setCurrentExecutionCase','setExecutionSnapshots','setGeneralExecutionSnapshot','setSnapshotAttachments','setGeneralExecutionAttachments','setStepResults','setSnapshotNotes','setGeneralExecutionStatus','setGeneralExecutionNote'].map(name=>[name,vi.fn()]))
  let count=0
  const responses=[{},[{id:'execution',caso_id:'case',estado_resultado:'SIN_CORRER'}],[{id:'snapshot',numero_paso:1,estado_paso:'SIN_CORRER'}],{}]
  const fetchWithAuth=vi.fn(async()=>{
   const index=count++
   if(index===3)await waiting
   return {ok:true,json:async()=>responses[index]}
  })
  const actions=createExecutionActions({fetchWithAuth,...setters,executionDraftRef:draft,t:(key:string)=>key} as any)
  const load=actions.loadExecutionDetails('run','case')
  await vi.waitFor(()=>expect(fetchWithAuth).toHaveBeenCalledTimes(4))
  draft.current.dirty=true;draft.current.version++
  release()
  expect(await load).toBeNull()
  for(const setter of Object.values(setters))expect(setter).not.toHaveBeenCalled()
 })
 it.each([false,true])('loads an unchanged draft or an explicitly replaced draft (replace=%s)',async(replaceDraft)=>{
  const setStepResults=vi.fn()
  const setterNames=['setCurrentExecutionRun','setCurrentExecutionCase','setExecutionSnapshots','setGeneralExecutionSnapshot','setSnapshotAttachments','setGeneralExecutionAttachments','setSnapshotNotes','setGeneralExecutionStatus','setGeneralExecutionNote']
  const setters=Object.fromEntries(setterNames.map(name=>[name,vi.fn()]))
  const responses=[{},[{id:'execution',caso_id:'case',estado_resultado:'PASO'}],[{id:'snapshot',numero_paso:1,estado_paso:'PASO'}],{}]
  let count=0
  const fetchWithAuth=vi.fn(async()=>({ok:true,json:async()=>responses[count++]}))
  const actions=createExecutionActions({fetchWithAuth,...setters,setStepResults,executionDraftRef:{current:{dirty:replaceDraft,version:1}},t:(key:string)=>key} as any)
  const result=await actions.loadExecutionDetails('run','case',{replaceDraft})
  expect(result?.ejecucion.id).toBe('execution')
  expect(setStepResults).toHaveBeenCalledWith({1:'PASO'})
 })

})
