// @vitest-environment jsdom
import {act,renderHook,cleanup,render,screen,fireEvent} from '@testing-library/react'
import {afterEach,it,expect,vi} from 'vitest'
import {useSharedReportState} from './useSharedReportState'
import {useReportDataModel} from './useReportDataModel'
import {useQualityIntelligence} from './useQualityIntelligence'
import {buildReportTablesHtml} from './reportExportUtils'
import {ReportDetailWidgets} from './ReportDetailWidgets'
afterEach(()=>{cleanup();vi.useRealTimers()})
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222'
const reply=(data:any,status=200)=>new Response(JSON.stringify(data),{status})
const opts={t:(k:any)=>k,fetchWithAuth:vi.fn(),currentProjectId:A,currentBuildId:A,projectMetrics:{build_id:A},canShareReports:true,canViewSharedReports:true,showFeedback:vi.fn()}
it('keeps newer shared history after older response resolves',async()=>{
 const pending:any[]=[];const fetch=vi.fn(()=>new Promise<Response>(r=>pending.push(r)))
 const {result,rerender}=renderHook(p=>useSharedReportState(p),{initialProps:{...opts,fetchWithAuth:fetch}})
 rerender({...opts,currentProjectId:B,currentBuildId:B,projectMetrics:{build_id:B},fetchWithAuth:fetch})
 await act(async()=>pending[1](reply([{id:'new-B'}])))
 await act(async()=>pending[0](reply([{id:'old-A'}])))
 expect(result.current.sharedReportHistory[0].id).toBe('new-B');expect(result.current.sharedReportHistoryBuildId).toBe(B)
})
it('exposes failed history and permits retry',async()=>{
 const fetch=async()=>reply({},500)
 const {result}=renderHook(()=>useSharedReportState({...opts,fetchWithAuth:fetch}))
 await act(async()=>{})
 expect(result.current.sharedReportHistory).toEqual([]);expect(result.current.loadingSharedHistory).toBe(false)
 expect(result.current.sharedHistoryError).toBeTruthy()
})
it('suite filters keep evidence with persisted context',()=>{
 const {result}=renderHook(()=>useReportDataModel({projectMetrics:{failures_and_blockers:[{case_code:'CASE1',suite:'API',prioridad:'MEDIA'}],evidence_items:[{case_code:'CASE1',suite:'API',status:'completa',name:'request.json'}]},detailFilters:{suite:'API'},sharedReportHistory:[],t:opts.t}))
 expect(result.current.filteredFailures).toHaveLength(1);expect(result.current.filteredEvidenceItems).toHaveLength(1)
})
it('closed bug filter excludes failures with open linked bugs',()=>{
 const {result}=renderHook(()=>useReportDataModel({projectMetrics:{failures_and_blockers:[{case_code:'CASE1',bug:[{estado:'ABIERTO'}]}]},detailFilters:{bug:'closed'},sharedReportHistory:[],t:opts.t}))
 expect(result.current.filteredFailures).toHaveLength(0)
})
it('exports structured Chatbot expectations without object placeholders',()=>{
 const html=buildReportTablesHtml({suiteTree:[{nombre:'Chat',casos:[{codigo:'CHAT1',formato_prueba:'CONVERSACIONAL',chatbot:{transcription:[{message:'hola',expected:{must_include:['respuesta esperada']}}]}}]}],projectMetrics:{},reportStats:{},bugMetrics:{},t:opts.t})
 expect(html).not.toContain('[object Object]');expect(html).toContain('respuesta esperada')
})
it('shows all 12 bug records with explicit show-more control',()=>{
 const rows=Array.from({length:12},(_,i)=>({id:'b'+i,codigo:'BUG-'+i,is_open:true}))
 const nodes=ReportDetailWidgets({detailFilters:{},suiteFilterOptions:[],priorityFilterOptions:[],ownerFilterOptions:[],uniqueOptions:()=>[],allReportBugs:rows,failureItems:[],renderReportesWidget:(id:any,node:any)=>id==='bugs'?node:null,t:opts.t,formatInt:String,formatHours:String,formatPercent:String,bugTraceability:{},bugMetrics:{},filteredReportBugs:rows,filteredFailures:[],filteredEvidenceItems:[],isColumnVisible:()=>true,visibleColumnCount:()=>7,riskVariant:()=> 'danger',evidenceSummary:{},canViewBugs:true})
 render(<>{nodes}</>);expect(screen.getByText('12 registros')).toBeTruthy();expect(screen.queryByText('BUG-8')).toBeNull();expect(screen.getByText('BUG-7')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'reportes.showMoreRecords'}));expect(screen.getByText('BUG-11')).toBeTruthy()
})
it('discards old risk mutation after context changes',async()=>{
 let release:any;const pending=new Promise<Response>(r=>release=r)
 const fetch=vi.fn(async(url:string,init:any)=>init?.method==='POST'?pending:reply(url.includes('/diagnoses')?{items:[]}:url.includes('release-risk')?{id:'risk-B',build_id:B}:{items:[]}))
 const base={currentProjectId:A,currentBuildId:A,enabled:true,fetchWithAuth:fetch,showFeedback:vi.fn(),t:opts.t}
 const {result,rerender}=renderHook(p=>useQualityIntelligence(p),{initialProps:base})
 await act(async()=>{});let old:any;act(()=>{old=result.current.evaluateReleaseRisk()})
 rerender({...base,currentProjectId:B,currentBuildId:B});await act(async()=>{})
 await act(async()=>{release(reply({id:'risk-A',build_id:A}));await old})
 expect(result.current.releaseRisk?.build_id).toBe(B)
})
it('preserves shared history on error, recovers on retry and clears it after successful empty response',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(reply([{id:'good'}])).mockResolvedValueOnce(reply({},500)).mockResolvedValueOnce(reply([]))
 const {result}=renderHook(()=>useSharedReportState({...opts,fetchWithAuth:fetch}))
 await act(async()=>{});expect(result.current.sharedReportHistory).toHaveLength(1)
 await act(async()=>{await result.current.loadSharedReportHistory()})
 expect(result.current.sharedHistoryError).toBeTruthy();expect(result.current.sharedReportHistory).toHaveLength(1)
 await act(async()=>{await result.current.loadSharedReportHistory()})
 expect(result.current.sharedHistoryError).toBe('');expect(result.current.sharedReportHistory).toEqual([])
})
it('clears history when view permission is removed and ignores the pending response',async()=>{
 let release:any;const fetch=vi.fn(()=>new Promise<Response>(r=>release=r))
 const {result,rerender}=renderHook(p=>useSharedReportState(p),{initialProps:{...opts,fetchWithAuth:fetch}})
 rerender({...opts,fetchWithAuth:fetch,canViewSharedReports:false,canShareReports:false})
 await act(async()=>release(reply([{id:'private-old'}])))
 expect(result.current.sharedReportHistory).toEqual([]);expect(result.current.loadingSharedHistory).toBe(false)
})
it('renders the shared-history error in the permitted view with retry',async()=>{
 const {SharedReportHistory}=await import('./SharedReportHistory')
 const retry=vi.fn()
 render(SharedReportHistory({sharedHistoryError:'500',canViewSharedReports:true,t:opts.t,sharedReportHistory:[],displayedSharedHistory:[],loadSharedReportHistory:retry,isColumnVisible:()=>true,visibleColumnCount:()=>7,formatDateTime:String,projectMetrics:{}}))
 expect(screen.getByRole('alert')).toHaveTextContent('reportes.sharedHistoryLoadError')
 fireEvent.click(screen.getByRole('button',{name:'common.retry'}));expect(retry).toHaveBeenCalledOnce()
})
it('distinguishes an observed zero latency from no samples',async()=>{
 const {ReportFormatMetricsWidget}=await import('./ReportFormatMetricsWidget')
 const node=ReportFormatMetricsWidget({renderReportesWidget:(_id,node)=>node,t:opts.t,formatInt:String,formatMs:v=>v+'ms',projectMetrics:{metricas_por_formato:{API:{format:'API',total:1,specific:{p95_latency_ms:0,latency_sample_count:1}},CONVERSACIONAL:{format:'CONVERSACIONAL',total:1,specific:{p95_latency_ms:0,latency_sample_count:0}}}}})
 render(<>{node}</>);expect(screen.getByText('reportes.noLatencyMeasurement')).toBeTruthy();expect(screen.getByText('0ms')).toBeTruthy()
})
it('does not open a shared report created for a previous context',async()=>{
 let release:any;const pending=new Promise<Response>(r=>release=r)
 const fetch=vi.fn(async(_url:any,options:any)=>options?.method==='POST'?pending:reply([]))
 const base={...opts,fetchWithAuth:fetch};const {result,rerender}=renderHook(p=>useSharedReportState(p),{initialProps:base})
 await act(async()=>{});act(()=>result.current.setBuildDefinition('APROBADA'))
 let request:any;act(()=>{request=result.current.shareReport()})
 rerender({...base,currentProjectId:B,currentBuildId:B,projectMetrics:{build_id:B}})
 await act(async()=>{release(reply({id:'old-shared',links:{}}));await request})
 expect(result.current.sharedReport).toBeNull();expect(result.current.showShareModal).toBe(false)
})

it('opens creation without reading history when share permission exists independently',async()=>{
 const fetch=vi.fn().mockResolvedValue(reply([]))
 const {result}=renderHook(()=>useSharedReportState({...opts,canViewSharedReports:false,fetchWithAuth:fetch}))
 await act(async()=>{await result.current.openShareModal()})
 expect(result.current.showShareModal).toBe(true);expect(fetch).not.toHaveBeenCalled()
})
it('cancels a network retry after changing context',async()=>{
 vi.useFakeTimers()
 const fetch=vi.fn(async(_url:any,options:any)=>{if(options?.method==='POST')throw new TypeError('failed to fetch');return reply([])})
 const base={...opts,fetchWithAuth:fetch};const {result,rerender}=renderHook(p=>useSharedReportState(p),{initialProps:base})
 await act(async()=>{});act(()=>result.current.setBuildDefinition('APROBADA'))
 let request:any;await act(async()=>{request=result.current.shareReport()})
 rerender({...base,currentProjectId:B,currentBuildId:B,projectMetrics:{build_id:B}})
 await act(async()=>{await vi.advanceTimersByTimeAsync(800);await request})
 expect(fetch.mock.calls.filter(([,options])=>options?.method==='POST')).toHaveLength(1)
})
it('does not invent a previous build when backend reports no predecessor',async()=>{
 const {ReportSecondaryWidgets}=await import('./ReportSecondaryWidgets')
 const nodes=ReportSecondaryWidgets({renderReportesWidget:(id:any,node:any)=>id==='buildComparison'?node:null,t:opts.t,projectMetrics:{build_id:'oldest',por_prioridad:{},historico_versions:[{build_id:'oldest',build_name:'v1',ejecutados:1},{build_id:'newer',build_name:'v2',ejecutados:1}]},comparison:{},suiteTree:[],isColumnVisible:()=>true})
 render(<>{nodes}</>);expect(screen.getByText('reportes.noPreviousBuild')).toBeTruthy();expect(screen.queryByText('v2')).toBeNull()
})
