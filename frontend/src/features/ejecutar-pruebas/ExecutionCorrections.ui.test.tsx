// @vitest-environment jsdom
import { cleanup, render, act, screen, fireEvent } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ApiAutomationMonitorModal } from './ApiAutomationMonitorModal'
import { ChatbotManualConsolePage } from './ChatbotManualConsolePage'
import { createExecutionActions } from '../ejecucion/executionActions'
import { createExecutionCaseSelectionActions } from '../ejecucion/executionCaseSelectionActions'
import { createEjecucionActionBundle } from '../ejecucion/ejecucionActionBundle'
import { createCaseActions } from '../casos/caseActions'
import { hydrateExecutionHistory } from '../ejecucion/executionHistoryState'
vi.mock('../../i18n',()=>({useI18n:()=>({t:(key:string)=>key})}))
afterEach(()=>{cleanup();vi.useRealTimers()})
const noop=()=>{}
function harness(values:any={}) {
 const state:any={CasosList:[],CurrentExecutionRun:values.currentExecutionRun};const config:any={beforeSelect:undefined,executionDraftRef:{current:{dirty:false,version:0}},...values}
 for(const key of ['setCurrentExecutionRun','setCurrentExecutionCase','setExecutionSnapshots','setGeneralExecutionSnapshot','setSnapshotAttachments','setGeneralExecutionAttachments','setStepResults','setSnapshotNotes','setGeneralExecutionStatus','setGeneralExecutionNote','setSelectedTest','setCasosList','setViewMode','setActiveExecutionCaseIds']) {
  if (!(key in config)) config[key]=(v:any)=>{const name=key.slice(3);state[name]=typeof v==='function'?v(state[name]):v}
 }
 const params=new Proxy(config,{get(o,k:any){if(k in o)return o[k];if(k==='t')return (s:any)=>s;if(k.startsWith('set'))return (v:any)=>{const key=k.slice(3);state[key]=typeof v==='function'?v(state[key]):v};return noop}})
 return {state,params}
}
const guard=()=>({current:{selection:0,details:0,context:'project'}})
it('restores persisted partial step results and notes before the case is finalized',async()=>{
 const snap={id:'s1',numero_paso:1,estado_paso:'PASO',comentarios:'Persisted note'}
 const h=harness({executionGuardRef:guard(),fetchWithAuth:async(url:string)=>new Response(JSON.stringify(url.includes('/detalle/')?{}:url.includes('/snapshot-attachments/')?{}:url.includes('/snapshots/')?[snap]:[{id:'e1',caso_id:'A',estado_resultado:'SIN_CORRER'}]))})
 await createExecutionActions(h.params).loadExecutionDetails('r1','A')
 expect(h.state.StepResults[1]).toBe('PASO');expect(h.state.SnapshotNotes[1]).toBe('Persisted note')
})
it('keeps the last selection after an older response resolves',async()=>{
 let release:any;const older=new Promise<void>(r=>{release=r})
 const h=harness({viewMode:'manual_exec',currentExecutionRun:{id:'r1'},executionGuardRef:guard(),loadCasoExecutionHistory:async(id:string)=>{if(id==='A')await older;return []},loadExecutionDetails:vi.fn()})
 const actions=createExecutionCaseSelectionActions(h.params)
 const a=actions.handleSelectTestForExecution({id:'A'});await actions.handleSelectTestForExecution({id:'B'});release();await a
 expect(h.state.SelectedTest.id).toBe('B');expect(h.params.loadExecutionDetails).toHaveBeenCalledTimes(1)
})
it('saves a partial prefix before switching cases and preserves the run as pending',async()=>{
 const dirty={current:{dirty:true,version:1}};const requests:any[]=[]
 const snapshots=[{id:'s1',numero_paso:1,estado_paso:'SIN_CORRER'},{id:'s2',numero_paso:2,estado_paso:'SIN_CORRER'}]
 const h=harness({executionDraftRef:dirty,executionGuardRef:guard(),aiEngineConfig:{},viewMode:'manual_exec',currentExecutionCase:{id:'e1'},currentExecutionRun:{id:'r1'},executionSnapshots:snapshots,stepResults:{1:'PASO',2:'SIN_CORRER'},snapshotNotes:{1:'draft'},loadCasoExecutionHistory:async()=>[],fetchWithAuth:async(url:string,options:any)=>{
  if(options?.method==='PATCH'){requests.push({url,payload:JSON.parse(options.body)});return new Response(JSON.stringify(snapshots))}
  return new Response(JSON.stringify(url.includes('/detalle/')?{}:url.includes('/snapshot-attachments/')?{}:url.includes('/snapshots/')?[]:[{id:'e2',caso_id:'B',estado_resultado:'SIN_CORRER'}]))
 }})
 await createEjecucionActionBundle(h.params).handleSelectTestForExecution({id:'B'})
 expect(requests).toHaveLength(1);expect(requests[0].payload.snapshots[0]).toMatchObject({estado:'PASO',comentarios:'draft'})
 expect(requests[0].url).toContain('/snapshots/');expect(h.state.SelectedTest.id).toBe('B');expect(dirty.current.dirty).toBe(false)
})
it('stays on the current case if saving progress fails',async()=>{
 const h=harness({executionDraftRef:{current:{dirty:true,version:1}},executionGuardRef:guard(),aiEngineConfig:{},viewMode:'manual_exec',currentExecutionCase:{id:'e1'},currentExecutionRun:{id:'r1'},executionSnapshots:[{id:'s1',numero_paso:1}],stepResults:{1:'PASO'},snapshotNotes:{1:'draft'},fetchWithAuth:async()=>new Response('{}',{status:500}),loadCasoExecutionHistory:vi.fn(),showFeedback:vi.fn()})
 await createEjecucionActionBundle(h.params).handleSelectTestForExecution({id:'B'})
 expect(h.params.loadCasoExecutionHistory).not.toHaveBeenCalled();expect(h.params.executionDraftRef.current.dirty).toBe(true)
})
it('marks failed history loading as an error without deleting previous statistics',async()=>{
 const h=harness({currentBuildId:'',fetchWithAuth:async()=>new Response('',{status:500})})
 const history=await createCaseActions(h.params).loadCasoExecutionHistory('A')
 const previous={id:'A',history:[{status:'PASO'}],historyTotal:9,historyStats:{passed:7}}
 const next=hydrateExecutionHistory(previous,history)
 expect(next.historyError).toContain('500');expect(next.historyTotal).toBe(9);expect(next.historyStats.passed).toBe(7)
})
it('polls sequentially and never replaces a completed run with an overlapping response',async()=>{
 vi.useFakeTimers();let release:any;const first=new Promise<Response>(r=>{release=r})
 const fetch=vi.fn().mockImplementationOnce(()=>first).mockResolvedValue(new Response(JSON.stringify({status:'COMPLETED',total:1,passed:1})))
 let monitor:any={run:{run_id:'r1',status:'PENDING'}};const setter=(update:any)=>{monitor=update(monitor)}
 render(<ApiAutomationMonitorModal show={false} run={monitor.run} fetchWithAuth={fetch} setAutomationMonitor={setter} onHide={noop} />)
 await act(async()=>{await vi.advanceTimersByTimeAsync(5000)})
 expect(fetch).toHaveBeenCalledTimes(1)
 await act(async()=>{release(new Response(JSON.stringify({status:'RUNNING'})));await first})
 await act(async()=>{await vi.advanceTimersByTimeAsync(2500)})
 expect(monitor.run.status).toBe('COMPLETED')
 await act(async()=>{await vi.advanceTimersByTimeAsync(10000)})
 expect(fetch).toHaveBeenCalledTimes(2)
})
it('uses frozen Chatbot turns and blocks passing an incomplete conversation',()=>{
 render(<ChatbotManualConsolePage selectedTest={{id:'A',configuracion_chatbot:{conversation:{turns:[{input:{mode:'fixed',text:'live changed'}}]}}}}
 currentExecutionRun={{id:'r1'}} currentExecutionCase={{id:'e1',estado_resultado:'SIN_CORRER',chatbot_config_snapshot:{config:{conversation:{turns:[{input:{mode:'fixed',text:'hello'}},{input:{mode:'fixed',text:'frozen second'}}]}}},chatbot_resultado:{turns:[{message:'hello',responseText:'ok',status:'PASSED'}]}}}
 fetchWithAuth={vi.fn()} returnToExecutionList={noop} showFeedback={noop} />)
 expect(screen.getByRole('textbox',{name:'ejecutarPruebas.currentTurnMessageAria'})).toHaveValue('frozen second')
 const finish=screen.getByRole('button',{name:'ejecutarPruebas.finishEvaluation'})
 expect(finish).toBeDisabled()
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'BLOQUEADO'}})
 const notes=screen.getAllByRole('textbox').find(item=>item.tagName==='TEXTAREA')!
 fireEvent.change(notes,{target:{value:'Endpoint unavailable'}})
 expect(finish).not.toBeDisabled()
})

it('clears stale statistics after a successful empty history response',()=>{
 const next=hydrateExecutionHistory({history:[{status:'PASO'}],historyTotal:9,historyStats:{passed:7},historyError:'500'},[])
 expect(next.history).toEqual([]);expect(next.historyTotal).toBe(0);expect(next.historyError).toBeNull();expect(next.lastResult).toBeNull()
})
