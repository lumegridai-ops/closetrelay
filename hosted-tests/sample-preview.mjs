// Real SQLite regression tests; YouCam and R2 are explicit test doubles.
// No provider network calls or credentials are used. Run npm run test:sample.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {samplePreview} from '../hosted/sample-preview.mjs';
import fixture from '../hosted/fixtures.generated.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const source=root+'hosted/sample-preview.mjs';
const moduleHash=createHash('sha256').update(await readFile(source)).digest('hex');
const schema=await readFile(root+'drizzle/0001_parallel_spectrum.sql','utf8');
const validImage=await readFile(root+'demo-assets/synthetic-adult.png');
const runDir=root+'artifacts/hosted-sample-regression';await mkdir(runDir,{recursive:true});
const SLOT='navy-adult-v1',ORIGIN='https://closetrelay.dgkv.chatgpt.site';
const RECEIPT='youcam-sample/navy-adult-v1-task.json';
const API='https://yce-api-01.makeupar.com/s2s/v2.0/task/cloth-v4';
const RESULT='https://yce-us.s3-accelerate.amazonaws.com/fake-result';
const tests=[];const test=(name,fn)=>tests.push({name,fn});
const envelope=(data,status=200)=>Response.json({status,data},{status});
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function makeD1(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(schema);
  const faults=[];
  const execute=(sql,args,kind)=>{
    const fault=faults.find(f=>f.remaining>0&&f.matches(sql,args,kind));
    if(fault&&fault.before){fault.remaining--;throw new Error('simulated_D1_unavailable');}
    const statement=sqlite.prepare(sql);
    const row=kind==='first'?(statement.get(...args)??null):statement.run(...args);
    if(fault&&!fault.before){fault.remaining--;throw new Error('simulated_D1_confirmation_lost');}
    return kind==='first'?row:{meta:{changes:Number(row.changes)}};
  };
  return {sqlite,faults,prepare(sql){
    return {bind(...args){
      return {async first(){return execute(sql,args,'first');},async run(){return execute(sql,args,'run');}};
    }};
  }};
}
function makeR2(){
  const objects=new Map(),faults=[];
  return {objects,faults,async put(key,body,options={}){
    const fault=faults.find(f=>f.remaining>0&&f.key===key);if(fault&&fault.before){fault.remaining--;throw new Error('simulated_R2_unavailable');}
    const bytes=typeof body==='string'?Buffer.from(body):Buffer.from(body);
    objects.set(key,{bytes,metadata:options.httpMetadata});
    if(fault&&!fault.before){fault.remaining--;throw new Error('simulated_R2_confirmation_lost');}
  },async get(key){const row=objects.get(key);return row?{body:new Uint8Array(row.bytes),httpMetadata:row.metadata,json:async()=>JSON.parse(row.bytes.toString())}:null;},async delete(key){objects.delete(key);}};
}
function harness(options={}){
  const DB=makeD1(),FILES=makeR2(),state={time:1000,calls:[],work:[],backgroundErrors:[]};
  const env={DB,FILES,YOUCAM_API_KEY:options.configured===false?undefined:'TEST-ONLY-NOT-A-CREDENTIAL'};
  const fetchImpl=async(url,init={})=>{
    const method=init.method??'GET';state.calls.push({url:String(url),method,headers:init.headers,body:init.body});
    if(String(url)===API&&method==='POST')return options.create?options.create(url,init):envelope({task_id:'FAKE-TASK-1'});
    if(String(url)===API+'/FAKE-TASK-1'&&method==='GET')return options.poll?options.poll(url,init):envelope({task_status:'running',error:null,results:null});
    if(String(url)===RESULT&&method==='GET')return options.image?options.image(url,init):new Response(validImage,{headers:{'Content-Type':'image/png'}});
    throw new Error('unexpected_fake_provider_request');
  };
  const ctx={waitUntil(p){state.work.push(p.catch(e=>{state.backgroundErrors.push(e.message);}));}};
  async function request(method='GET',body={fixture:SLOT},extra={}){
    const headers={...(method==='POST'?{Origin:ORIGIN,'Content-Type':'application/json'}:{}),...extra.headers};
    const req=new Request(ORIGIN+(extra.path??'/api/sample-preview'),{method,headers,...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
    return samplePreview(req,env,ctx,{fetchImpl,now:()=>state.time});
  }
  async function drain(){while(state.work.length){const work=state.work.splice(0);await Promise.all(work);}}
  const row=()=>DB.sqlite.prepare('SELECT * FROM closet_sample_preview WHERE id=?').get(SLOT);
  const createCount=()=>state.calls.filter(x=>x.method==='POST'&&x.url===API).length;
  const pollCount=()=>state.calls.filter(x=>x.method==='GET'&&x.url.startsWith(API+'/')).length;
  async function start(){const response=await request('POST');await drain();assert.equal(response.status,202);assert.equal(row().status,'processing');}
  return {DB,FILES,state,env,fetchImpl,ctx,request,drain,row,createCount,pollCount,start};
}
// Extra legacy-looking status is present only in isolated boundary tests so the
// first version's task_status bug does not hide separate defects.
const success=(url=RESULT)=>envelope({task_status:'success',status:'success',error:null,results:{url}});

test('no key prevents allocation and exposes only disabled capability',async()=>{
 const h=harness({configured:false});assert.equal((await h.request('POST')).status,503);assert.equal(h.row(),undefined);assert.equal(h.state.calls.length,0);assert.equal((await (await h.request()).json()).configured,false);
});
test('strict sample request, origin and method reject caller-controlled input',async()=>{
 const h=harness();for(const body of [{fixture:'other'},{fixture:SLOT,url:'https://evil.invalid/'},{fixture:SLOT,api_key:'dummy'}])assert.equal((await h.request('POST',body)).status,400);
 assert.equal((await h.request('POST',{fixture:SLOT},{headers:{Origin:'https://evil.invalid'}})).status,403);
 assert.equal((await h.request('POST','not JSON')).status,400);assert.equal((await h.request('DELETE')).status,405);assert.equal(h.state.calls.length,0);
});
test('30 concurrent visitors and repeated POSTs claim one global attempt',async()=>{
 const gate=deferred(),h=harness({create:()=>gate.promise});
 const replies=await Promise.all(Array.from({length:30},(_,i)=>h.request('POST',{fixture:SLOT},{headers:{Cookie:'visitor='+i}})));
 assert.equal(h.createCount(),1);assert.ok(replies.every(r=>r.status===202));gate.resolve(envelope({task_id:'FAKE-TASK-1'}));await h.drain();
 for(let i=0;i<10;i++)await h.request('POST');await h.drain();assert.equal(h.createCount(),1);assert.equal(h.row().status,'processing');
 const payload=JSON.parse(h.state.calls[0].body);assert.deepEqual(payload,{src_file_url:ORIGIN+'/demo/synthetic-adult.png',ref_file_url:ORIGIN+'/demo/synthetic-navy-blazer.png',garment_category:'outer',change_shoes:false,filter_multi_person:'strict'});
});
test('lost creation response remains uncertain and never retries across reloads',async()=>{
 const h=harness({create:async()=>{throw new Error('simulated_lost_create_response');}});await h.request('POST');await h.drain();assert.equal(h.row().status,'creation_uncertain');
 h.state.time+=60000;for(let i=0;i<20;i++)await h.request(i%2?'GET':'POST');await h.drain();assert.equal(h.createCount(),1);assert.equal(h.row().status,'creation_uncertain');
});
test('R2 task receipt recovers when both D1 task-id writes fail',async()=>{
 const h=harness();h.DB.faults.push({remaining:2,before:true,matches:(s,a)=>s.includes('task_id=?')&&a[0]==='processing'});
 await h.request('POST');await h.drain();assert.equal(h.row().status,'creation_uncertain');assert.ok(h.FILES.objects.has(RECEIPT));
 await h.request();await h.drain();assert.equal(h.row().status,'processing');assert.equal(h.row().task_id,'FAKE-TASK-1');assert.equal(h.createCount(),1);
});
test('lost R2 receipt confirmation falls back to the received task-id without creation retry',async()=>{
 const h=harness();h.FILES.faults.push({key:RECEIPT,remaining:1,before:false});await h.start();assert.equal(h.row().task_id,'FAKE-TASK-1');assert.equal(h.createCount(),1);
});
test('documented task_status success produces the real downloaded bytes',async()=>{
 const h=harness({poll:()=>envelope({task_status:'success',error:null,results:{url:RESULT}})});await h.start();h.state.time+=10000;await h.request();await h.drain();assert.equal(h.row().status,'succeeded');
 const image=await h.request('GET',null,{path:'/api/sample-preview/image'});assert.equal(image.status,200);assert.equal(createHash('sha256').update(new Uint8Array(await image.arrayBuffer())).digest('hex'),h.row().result_hash);assert.equal(h.createCount(),1);
});
test('documented task_status error is terminal without implicit recreation',async()=>{
 const h=harness({poll:()=>envelope({task_status:'error',error:'error_pose',results:null})});await h.start();h.state.time+=10000;await h.request();await h.drain();assert.equal(h.row().status,'failed');await h.request('POST');assert.equal(h.createCount(),1);
});
test('documented running status does not falsely report a provider read error',async()=>{
 const h=harness();await h.start();h.state.time+=10000;await h.request();await h.drain();assert.equal(h.row().status,'processing');assert.equal(h.row().error_code,null);
});
test('transient poll failure waits until due time and resumes same task',async()=>{
 let n=0;const h=harness({poll:async()=>{if(++n===1)throw new Error('simulated_network_loss');return success();}});await h.start();h.state.time+=10000;await h.request();await h.drain();assert.equal(h.row().status,'processing');assert.equal(h.pollCount(),1);
 for(let i=0;i<10;i++)await h.request();await h.drain();assert.equal(h.pollCount(),1);h.state.time+=10000;await h.request();await h.drain();assert.equal(h.row().status,'succeeded');assert.equal(h.createCount(),1);assert.equal(h.pollCount(),2);
});
test('untrusted result host is rejected before download',async()=>{
 const h=harness({poll:()=>success('https://evil.invalid/result.png')});await h.start();h.state.time+=10000;await h.request();await h.drain();assert.equal(h.row().status,'failed');assert.equal(h.row().error_code,'unexpected_result_host');assert.equal(h.state.calls.length,2);
});
test('result stream above eight MiB is rejected without persisting image',async()=>{
 const h=harness({poll:()=>success(),image:()=>new Response(new Uint8Array(8*1024*1024+1))});await h.start();h.state.time+=10000;await h.request();await h.drain();assert.equal(h.row().status,'failed');assert.equal(h.row().error_code,'response_too_large');assert.equal(h.row().result_key,null);
});
test('truncated PNG signature cannot be marked a successful image',async()=>{
 const h=harness({poll:()=>success(),image:()=>new Response(Uint8Array.of(137,80,78,71),{headers:{'Content-Type':'image/png'}})});await h.start();h.state.time+=10000;await h.request();await h.drain();assert.equal(h.row().status,'failed');assert.equal(h.row().result_key,null);
});
test('saved fixture hash mismatch never reuses or overwrites the slot',async()=>{
 const h=harness();await h.start();h.DB.sqlite.prepare('UPDATE closet_sample_preview SET source_hash=?').run('f'.repeat(64));
 for(const method of ['GET','POST'])assert.equal((await h.request(method)).status,503);assert.equal(h.createCount(),1);assert.equal(h.pollCount(),0);assert.equal(h.row().source_hash,'f'.repeat(64));
});
test('ten-minute deadline fails without extra provider reads or new attempts',async()=>{
 const h=harness();await h.start();h.state.time+=600001;await h.request();await h.drain();assert.equal(h.row().status,'failed');assert.equal(h.row().error_code,'provider_timed_out');assert.equal(h.pollCount(),0);await h.request('POST');assert.equal(h.createCount(),1);
});
test('poll lease prevents a second in-flight read when first call takes over ten seconds',async()=>{
 const gate=deferred(),h=harness({poll:()=>gate.promise});await h.start();h.state.time+=10000;await h.request();assert.equal(h.pollCount(),1);
 h.state.time+=10001;await h.request();const count=h.pollCount();gate.resolve(envelope({task_status:'running',status:'running',error:null,results:null}));await h.drain();assert.equal(count,1,'overlapping poll acquired while previous provider call still in flight');
});
test('a failed earlier result download cannot overwrite an already committed success',async()=>{
 const gate=deferred();let downloads=0;const h=harness({poll:()=>success(),image:()=>++downloads===1?gate.promise:new Response(validImage,{headers:{'Content-Type':'image/png'}})});await h.start();h.state.time+=10000;await h.request();
 for(let i=0;i<20&&downloads<1;i++)await new Promise(r=>setImmediate(r));assert.equal(downloads,1);
 h.state.time+=10001;await h.request();for(let i=0;i<50&&h.row().status!=='succeeded';i++)await new Promise(r=>setImmediate(r));
 const secondSucceeded=h.row().status==='succeeded';gate.resolve(new Response(Uint8Array.of(1,2,3,4)));await h.drain();
 // With an exclusive poll lease there is no second completion; the race is prevented.
 if(secondSucceeded)assert.equal(h.row().status,'succeeded','stale failure overwrote terminal success');
});
test('expired 65s lease: delayed old R2 success cannot replace newer saved bytes',async()=>{
 const newer=await readFile(root+'/demo-assets/synthetic-navy-blazer.png');let downloads=0,entered=false;
 const gate=deferred(),h=harness({poll:()=>success(),image:()=>new Response(++downloads===1?validImage:newer,{headers:{'Content-Type':'image/png'}})});
 const put=h.FILES.put.bind(h.FILES);h.FILES.put=async(key,body,options)=>{if(key.includes('-output')&&!entered){entered=true;await gate.promise;}return put(key,body,options);};
 await h.start();h.state.time+=10000;await h.request();for(let i=0;i<50&&!entered;i++)await new Promise(r=>setImmediate(r));assert.ok(entered);
 h.state.time+=65001;await h.request();for(let i=0;i<100&&h.row().status!=='succeeded';i++)await new Promise(r=>setImmediate(r));assert.equal(h.row().status,'succeeded');
 const expected=createHash('sha256').update(newer).digest('hex');assert.equal(h.row().result_hash,expected);gate.resolve();await h.drain();assert.equal(h.row().status,'succeeded');assert.equal(h.row().result_hash,expected);
 const displayed=await h.request('GET',null,{path:'/api/sample-preview/image'});assert.equal(createHash('sha256').update(new Uint8Array(await displayed.arrayBuffer())).digest('hex'),expected);assert.equal(h.createCount(),1);
});
test('expired lease: old R2 failure does not attach an error to newer success',async()=>{
 let entered=false;const gate=deferred(),h=harness({poll:()=>success()});const put=h.FILES.put.bind(h.FILES);
 h.FILES.put=async(key,body,options)=>{if(key.includes('-output')&&!entered){entered=true;await gate.promise;throw new Error('late_simulated_storage_failure');}return put(key,body,options);};
 await h.start();h.state.time+=10000;await h.request();for(let i=0;i<50&&!entered;i++)await new Promise(r=>setImmediate(r));assert.ok(entered);
 h.state.time+=65001;await h.request();for(let i=0;i<100&&h.row().status!=='succeeded';i++)await new Promise(r=>setImmediate(r));assert.equal(h.row().status,'succeeded');gate.resolve();await h.drain();assert.equal(h.row().status,'succeeded');assert.equal(h.row().error_code,null);
});
test('late task-receipt recovery cannot downgrade a result another request already completed',async()=>{
 const gate=deferred();let receiptReads=0;const h=harness({poll:()=>success()});h.DB.faults.push({remaining:2,before:true,matches:(s,a)=>s.includes('task_id=?')&&a[0]==='processing'});
 await h.request('POST');await h.drain();assert.equal(h.row().status,'creation_uncertain');
 const get=h.FILES.get.bind(h.FILES);h.FILES.get=async key=>{const value=await get(key);if(key===RECEIPT&&++receiptReads===1)await gate.promise;return value;};
 const earlier=h.request();for(let i=0;i<20&&receiptReads<1;i++)await new Promise(r=>setImmediate(r));assert.equal(receiptReads,1);
 await h.request();await h.drain();assert.equal(h.row().status,'succeeded');const hash=h.row().result_hash;gate.resolve();const earlierBody=await (await earlier).json();await h.drain();
 assert.equal(earlierBody.status,'succeeded','receipt recovery resurrected processing after terminal success');assert.equal(h.row().status,'succeeded');assert.equal(h.row().result_hash,hash);assert.equal(h.pollCount(),1);assert.equal(h.createCount(),1);
});
test('streamed POST is canceled at 128 bytes rather than drained without bound',async()=>{
 const h=harness();let produced=0,canceled=false;const body=new ReadableStream({pull(controller){produced++;if(produced>1000)controller.close();else controller.enqueue(new Uint8Array(64));},cancel(){canceled=true;}});
 const req=new Request(ORIGIN+'/api/sample-preview',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json'},body,duplex:'half'});
 const response=await samplePreview(req,h.env,h.ctx,{fetchImpl:h.fetchImpl,now:()=>h.state.time});assert.equal(response.status,400);assert.ok(canceled);assert.ok(produced<=4,'oversized request body kept being read');assert.equal(h.state.calls.length,0);
});
const receipt={at:new Date().toISOString(),kind:'Independent source-copy test with actual SQLite SQL and explicitly fake YouCam/R2; no live request',source_path:source,source_sha256:moduleHash,fixture_hashes:fixture,node:process.version,tests:[]};
for(const {name,fn} of tests){try{await fn();receipt.tests.push({name,status:'passed'});console.log('PASS '+name);}catch(error){receipt.tests.push({name,status:'failed',error:error.message,stack:error.stack});console.log('FAIL '+name+' — '+error.message);}}
receipt.passed=receipt.tests.filter(t=>t.status==='passed').length;receipt.failed=receipt.tests.length-receipt.passed;
await writeFile(runDir+'/results.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({passed:receipt.passed,failed:receipt.failed,source_sha256:moduleHash}));
if(receipt.failed)process.exitCode=1;
