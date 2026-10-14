import {createHash} from 'node:crypto';
export function createResultTransport({api,chunkBytes=768*1024}={}) {
 return async(jobId,payload)=>{
  const bytes=Buffer.from(JSON.stringify(payload));
  if(bytes.length<=chunkBytes)return api(`/automation-jobs/${jobId}/result`,{method:'POST',body:bytes.toString()});
  const base=`/automation-jobs/${jobId}/result-uploads/${encodeURIComponent(payload.result_event_id)}`;
  const headers={'X-Lease-Token':payload.lease_token};
  let state=await api(base,{method:'POST',headers,body:JSON.stringify({total_bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')})});
  if(state.confirmed)return state.result;
  let offset=state.offset;
  if(!Number.isSafeInteger(offset)||offset<0||offset>bytes.length)throw new Error('Invalid result upload offset');
  while(offset<bytes.length){const chunk=bytes.subarray(offset,offset+chunkBytes);state=await api(`${base}/${offset}`,{method:'PUT',headers:{...headers,'Content-Type':'application/octet-stream'},body:chunk});if(state.offset!==offset+chunk.length)throw new Error('Result chunk was not acknowledged exactly');offset=state.offset;}
  return api(`${base}/complete`,{method:'POST',headers});
 };
}
