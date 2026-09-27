// A single, explicitly fictional YouCam request shared by the public demo.
// No caller-controlled photos, URLs, prompts, task IDs or credentials are accepted.
import fixture from './fixtures.generated.mjs';
import {imageType} from './image-container.mjs';
const SLOT='navy-adult-v1';
const API='https://yce-api-01.makeupar.com/s2s/v2.0/task/cloth-v4';
const SITE='https://closetrelay.dgkv.chatgpt.site';
const RECEIPT='youcam-sample/navy-adult-v1-task.json';
const IMAGE='youcam-sample/navy-adult-v1-output';
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
async function readBody(response,limit){
  const reader=response.body?.getReader();if(!reader)throw new Error('empty_response');
  const parts=[];let length=0;
  try{for(;;){const row=await reader.read();if(row.done)break;length+=row.value.length;if(length>limit)throw new Error('response_too_large');parts.push(row.value);}}
  finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;
}
async function json(response){const body=JSON.parse(new TextDecoder().decode(await readBody(response,65536)));if(!response.ok)throw new Error(`provider_http_${response.status}`);return body;}
const read=env=>env.DB.prepare('SELECT * FROM closet_sample_preview WHERE id=?').bind(SLOT).first();
function view(row,configured){
  return {configured,fixture:SLOT,scope:'Fixed fictional adult and navy blazer only',status:row?.status??'ready',
    provider:'YouCam Clothes V4',task_id:row?.task_id??null,created_at:row?.created_at??null,updated_at:row?.updated_at??null,
    source_sha256:fixture.adult,reference_sha256:fixture.blazer,result_sha256:row?.result_hash??null,
    result_url:row?.status==='succeeded'?'/api/sample-preview/image':null,error:row?.error_code??null,
    shared_saved_result:row?.status==='succeeded',attempts:row?1:0,max_attempts:1};
}
async function saveError(env,status,code,now){await env.DB.prepare("UPDATE closet_sample_preview SET status=?,error_code=?,updated_at=? WHERE id=? AND status NOT IN ('succeeded','failed')").bind(status,code,now,SLOT).run();}
async function create(env,fetchImpl,now){
  let receivedId;
  try{
    const body=await json(await fetchImpl(API,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.YOUCAM_API_KEY}`},
      body:JSON.stringify({src_file_url:SITE+'/demo/synthetic-adult.png',ref_file_url:SITE+'/demo/synthetic-navy-blazer.png',garment_category:'outer',change_shoes:false,filter_multi_person:'strict'}),
      redirect:'error',signal:AbortSignal.timeout(25000)}));
    receivedId=body?.data?.task_id;
    if(typeof receivedId!=='string'||!/^[A-Za-z0-9_-]{1,512}$/.test(receivedId))throw new Error('invalid_task_response');
    // Preserve the actual task before updating D1, so a lost save response can recover.
    await env.FILES.put(RECEIPT,JSON.stringify({task_id:receivedId,source_hash:fixture.adult,reference_hash:fixture.blazer}),{httpMetadata:{contentType:'application/json'}});
    await env.DB.prepare("UPDATE closet_sample_preview SET status=?,task_id=?,updated_at=?,next_poll_at=? WHERE id=? AND status IN ('creating','creation_uncertain')").bind('processing',receivedId,now(),now()+10000,SLOT).run();
  }catch(error){
    // Never automatically repeat creation, even if the response or save is lost.
    if(receivedId){try{await env.DB.prepare("UPDATE closet_sample_preview SET status=?,task_id=?,updated_at=?,next_poll_at=? WHERE id=? AND status IN ('creating','creation_uncertain')").bind('processing',receivedId,now(),now()+10000,SLOT).run();return;}catch{}}
    const code=/^provider_http_\d{3}$/.test(error.message)?error.message:'creation_confirmation_lost';
    await saveError(env,code.startsWith('provider_http_4')?'failed':'creation_uncertain',code,now()).catch(()=>{});
  }
}
async function poll(env,row,fetchImpl,now,leaseToken){
  const fail=(code,terminal=false)=>env.DB.prepare('UPDATE closet_sample_preview SET status=?,error_code=?,updated_at=? WHERE id=? AND status=? AND next_poll_at=?').bind(terminal?'failed':'processing',code,now(),SLOT,'processing',leaseToken).run();
  try{
    const payload=await json(await fetchImpl(`${API}/${encodeURIComponent(row.task_id)}`,{headers:{Authorization:`Bearer ${env.YOUCAM_API_KEY}`},redirect:'error',signal:AbortSignal.timeout(25000)}));
    const data=payload?.data;
    if(['error','failed'].includes(data?.task_status)){await fail('provider_generation_failed',true);return;}
    if(['running','pending','queued'].includes(data?.task_status))return;
    if(data?.task_status!=='success')throw new Error('invalid_status_response');
    const url=new URL(data.results?.url);
    if(url.protocol!=='https:'||url.hostname!=='yce-us.s3-accelerate.amazonaws.com'||url.port||url.username||url.password)throw new Error('unexpected_result_host');
    const response=await fetchImpl(url.href,{redirect:'error',signal:AbortSignal.timeout(25000)});
    if(!response.ok)throw new Error('result_unavailable');
    const bytes=await readBody(response,8*1024*1024);
    const contentType=imageType(bytes);
    const resultHash=await hash(bytes);
    const resultKey=IMAGE+'/'+resultHash;
    await env.FILES.put(resultKey,bytes,{httpMetadata:{contentType}});
    await env.DB.prepare('UPDATE closet_sample_preview SET status=?,result_key=?,result_hash=?,updated_at=?,error_code=NULL WHERE id=? AND status=? AND next_poll_at=?').bind('succeeded',resultKey,resultHash,now(),SLOT,'processing',leaseToken).run();
  }catch(error){
    const code=['unexpected_result_host','result_not_an_image','response_too_large'].includes(error.message)?error.message:'provider_read_unavailable';
    await fail(code,code!=='provider_read_unavailable');
  }finally{
    // A longer lease covers both 25-second fetches. CAS makes stale completions inert.
    await env.DB.prepare('UPDATE closet_sample_preview SET next_poll_at=? WHERE id=? AND status=? AND next_poll_at=?').bind(now()+10000,SLOT,'processing',leaseToken).run();
  }
}
export async function samplePreview(request,env,ctx,{fetchImpl=fetch,now=Date.now}={}){
  const configured=!!env.YOUCAM_API_KEY,path=new URL(request.url).pathname;
  let row=await read(env);
  if(row&&(row.source_hash!==fixture.adult||row.reference_hash!==fixture.blazer))return Response.json({error:{message:'The saved sample uses different source images. A new provider request requires review.'}},{status:503});
  if(path==='/api/sample-preview/image'){
    if(request.method!=='GET'||row?.status!=='succeeded')return new Response('Preview not ready',{status:404});
    const file=await env.FILES.get(row.result_key);if(!file)return new Response('Preview temporarily unavailable',{status:503});
    return new Response(file.body,{headers:{'Content-Type':file.httpMetadata?.contentType??'image/png'}});
  }
  if(!['GET','POST'].includes(request.method))return new Response('Method not allowed',{status:405});
  if(request.method==='POST'){
    if(request.headers.get('origin')!==new URL(request.url).origin)return new Response('Same-origin page required',{status:403});
    if(!configured)return Response.json({error:{message:'The virtual try-on service is not connected.'}},{status:503});
    let input;try{input=JSON.parse(new TextDecoder().decode(await readBody(request,128)));}catch{return new Response('Invalid sample request',{status:400});}
    if(input?.fixture!==SLOT||Object.keys(input).length!==1)return new Response('Only the fixed fictional sample is supported',{status:400});
    if(!row){
      const claimed=await env.DB.prepare('INSERT OR IGNORE INTO closet_sample_preview(id,status,source_hash,reference_hash,created_at,updated_at,next_poll_at) VALUES(?,?,?,?,?,?,?)').bind(SLOT,'creating',fixture.adult,fixture.blazer,now(),now(),now()+10000).run();
      if(claimed.meta.changes===1)ctx.waitUntil(create(env,fetchImpl,now));
      row=await read(env);
    }
  }
  if(row?.status==='creating'&&now()-row.created_at>40000||row?.status==='creation_uncertain'){
    const file=await env.FILES.get(RECEIPT);
    if(file){const receipt=await file.json();if(receipt.source_hash===fixture.adult&&receipt.reference_hash===fixture.blazer&&/^[A-Za-z0-9_-]{1,512}$/.test(receipt.task_id)){
      await env.DB.prepare("UPDATE closet_sample_preview SET status=?,task_id=?,updated_at=?,next_poll_at=?,error_code=NULL WHERE id=? AND status IN ('creating','creation_uncertain')").bind('processing',receipt.task_id,now(),now(),SLOT).run();row=await read(env);
    }}else if(row.status==='creating'){await saveError(env,'creation_uncertain','creation_confirmation_lost',now());row=await read(env);}
  }
  if(row?.status==='processing'&&configured){
    if(now()-row.created_at>10*60*1000){await saveError(env,'failed','provider_timed_out',now());row=await read(env);}
    else if(row.next_poll_at<=now()){
      const leaseToken=now()+65000;
      const lease=await env.DB.prepare('UPDATE closet_sample_preview SET next_poll_at=? WHERE id=? AND status=? AND next_poll_at<=?').bind(leaseToken,SLOT,'processing',now()).run();
      if(lease.meta.changes===1)ctx.waitUntil(poll(env,row,fetchImpl,now,leaseToken));
    }
  }
  return Response.json(view(row,configured),{status:request.method==='POST'&&row?.status!=='succeeded'?202:200});
}
