const pending=new Map();let serial=0,revision=-1,queue=Promise.resolve();
let worker;
function replaceWorker(message,start=true){
  worker?.terminate();worker=null;revision=-1;
  for(const task of pending.values()){clearTimeout(task.timeout);task.reject(new Error(message));}pending.clear();
  if(!start)return;
  worker=new Worker('/hosted/python-worker.mjs',{type:'module'});
  worker.onmessage=({data})=>{const task=pending.get(data.id);if(!task)return;clearTimeout(task.timeout);pending.delete(data.id);data.ok?task.resolve(data):task.reject(new Error(data.error));};
  worker.onerror=()=>replaceWorker('The workspace engine could not load. Check your connection and refresh.',false);
}
replaceWorker('Starting the workspace.');
function call(message){if(!worker)replaceWorker('Restarting the workspace.');return new Promise((resolve,reject)=>{const id=++serial;const timeout=setTimeout(()=>replaceWorker('Loading took too long. Check your connection and refresh.',false),60000);pending.set(id,{resolve,reject,timeout});worker.postMessage({...message,id});});}
async function sync(){
  const response=await fetch('/workspace/checkpoint',{cache:'no-store'});if(!response.ok)throw new Error('The saved workspace could not load. Please refresh.');
  const next=Number(response.headers.get('X-Workspace-Revision'));if(!Number.isSafeInteger(next)||next<0)throw new Error('The saved workspace revision is invalid.');
  if(next!==revision){const database=await response.arrayBuffer();await call({type:'restore',database});revision=next;}
}
async function request(path,options={}){
  const method=options.method??'GET';await sync();
  let result;
  try{result=await call({type:'request',request:{path,method,body:options.body?JSON.parse(options.body):null}});}
  catch(error){revision=-1;try{await sync();}catch{}throw error;}
  if(result.snapshot){
    try{
      const saved=await fetch('/workspace/checkpoint',{method:'PUT',headers:{'Content-Type':'application/vnd.sqlite3','If-Match':String(revision)},body:result.snapshot});
      if(!saved.ok){const data=await saved.json();const error=new Error(data.error?.message??'Your change could not be saved.');error.status=saved.status;throw error;}
      revision=(await saved.json()).revision;
    }catch(error){revision=-1;await sync();const conflict=error.status===409;return Response.json({error:{code:conflict?'save_conflict':'save_outcome_unknown',message:conflict?error.message:'Save confirmation was lost. The latest saved state has been reloaded; review it before retrying.'}},{status:conflict?409:503});}
  }
  return Response.json(result.body,{status:result.status});
}
globalThis.closetHostedRequest=(path,options)=>{
  const operation=queue.then(()=>request(path,options));queue=operation.catch(()=>{});return operation;
};
try{
  await sync();
  await import('/app.js');
}catch(error){
  document.querySelector('#loading').hidden=true;
  const box=document.querySelector('#message');box.hidden=false;box.setAttribute('role','alert');
  const p=document.createElement('p');p.textContent=error.message;
  const retry=document.createElement('button');retry.className='button button-primary';retry.textContent='Try again';retry.addEventListener('click',()=>location.reload());box.replaceChildren(p,retry);
}
