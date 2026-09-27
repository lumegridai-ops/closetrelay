import assets from './assets.generated.mjs';
import {samplePreview} from './sample-preview.mjs';
const cookieName='__Host-closetrelay';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'; worker-src 'self' https://cdn.jsdelivr.net/pyodide/v314.0.7/full/; connect-src 'self' https://cdn.jsdelivr.net; font-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"};
async function identity(request) {
  const previous=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  const token=/^[a-f0-9]{64}$/.test(previous??'')?previous:Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  return {scope:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join(''),cookie:`${cookieName}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000`};
}
function finish(response,cookie) {
  const next=new Response(response.body,{status:response.status,headers:response.headers});Object.entries(headers).forEach(([k,v])=>next.headers.set(k,v));if(cookie)next.headers.set('Set-Cookie',cookie);return next;
}
const error=(status,message)=>Response.json({error:{message}},{status});
async function checkpoint(env,scope) {
  const row=await env.DB.prepare('SELECT revision, object_key FROM closet_workspaces WHERE scope=?').bind(scope).first();
  if(!row)return new Response(null,{status:204,headers:{'X-Workspace-Revision':'0'}});
  const object=await env.FILES.get(row.object_key);
  if(!object)throw new Error('Checkpoint missing');
  return new Response(object.body,{headers:{'Content-Type':'application/vnd.sqlite3','X-Workspace-Revision':String(row.revision)}});
}
async function bytes(request) {
  if(request.headers.get('content-type')!=='application/vnd.sqlite3')return null;
  const reader=request.body?.getReader();if(!reader)return null;const chunks=[];let length=0;
  try {for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>2*1024*1024)return null;chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  const result=new Uint8Array(length);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}
  if(new TextDecoder().decode(result.slice(0,16))!=='SQLite format 3\0')return null;
  return result;
}
export default {
  async fetch(request,env,ctx) {
    const url=new URL(request.url),origin=request.headers.get('origin');
    if(origin&&origin!==url.origin)return finish(error(403,'Use the same workspace page.'));
    if(url.pathname==='/health')return finish(Response.json({product:'ClosetRelay',hosting:'OpenAI Sites',mode:'isolated fictional demo',provider:!!env.YOUCAM_API_KEY,provider_scope:'fixed fictional adult and navy blazer'}));
    if(['/api/sample-preview','/api/sample-preview/image'].includes(url.pathname)){
      try{return finish(await samplePreview(request,env,ctx));}
      catch{return finish(error(503,'The virtual try-on record is temporarily unavailable. Your clothing workflow is unchanged.'));}
    }
    if(Object.hasOwn(assets,url.pathname)&&['GET','HEAD'].includes(request.method)){
      const a=assets[url.pathname],body=request.method==='HEAD'?null:a.encoding==='base64'?Uint8Array.from(atob(a.body),c=>c.charCodeAt(0)):a.body;
      return finish(new Response(body,{headers:{'Content-Type':a.type}}),url.pathname==='/'?(await identity(request)).cookie:undefined);
    }
    if(url.pathname!=='/workspace/checkpoint')return finish(error(404,'Not found.'));
    const id=await identity(request);
    try {
      if(request.method==='GET'){
        // A concurrent save can replace the object between metadata and object reads.
        let response;try{response=await checkpoint(env,id.scope);}catch{response=await checkpoint(env,id.scope);}
        return finish(response,id.cookie);
      }
      if(request.method!=='PUT')return finish(error(405,'Use GET or PUT.'),id.cookie);
      const revision=Number(request.headers.get('If-Match'));
      if(!request.headers.has('If-Match')||!Number.isSafeInteger(revision)||revision<0)return finish(error(400,'A saved workspace revision is required.'),id.cookie);
      const body=await bytes(request);if(!body)return finish(error(413,'This demo workspace must be a SQLite snapshot under 2 MB.'),id.cookie);
      const previous=await env.DB.prepare('SELECT revision,object_key FROM closet_workspaces WHERE scope=?').bind(id.scope).first();
      if((previous?.revision??0)!==revision)return finish(error(409,'This workspace changed in another tab. Reload its saved state before retrying.'),id.cookie);
      const objectKey=`workspaces/${id.scope}/${crypto.randomUUID()}.sqlite3`;
      await env.FILES.put(objectKey,body,{httpMetadata:{contentType:'application/vnd.sqlite3'}});
      let saved;
      try {saved=await env.DB.prepare(`INSERT INTO closet_workspaces(scope,revision,object_key,updated_at) VALUES(?,?,?,?)
        ON CONFLICT(scope) DO UPDATE SET revision=excluded.revision,object_key=excluded.object_key,updated_at=excluded.updated_at
        WHERE closet_workspaces.revision=?`).bind(id.scope,revision+1,objectKey,Date.now(),revision).run();}
      catch(e){
        // A lost D1 response can follow a committed write. Keep the object until
        // the authoritative pointer resolves the outcome; never delete on doubt.
        const current=await env.DB.prepare('SELECT revision,object_key FROM closet_workspaces WHERE scope=?').bind(id.scope).first();
        if(current?.object_key!==objectKey)throw e;
        saved={meta:{changes:1}};
      }
      if(saved.meta.changes!==1){await env.FILES.delete(objectKey);return finish(error(409,'Another tab saved first. Reload before retrying.'),id.cookie);}
      if(previous?.object_key)ctx.waitUntil(env.FILES.delete(previous.object_key).catch(()=>{}));
      return finish(Response.json({revision:revision+1}),id.cookie);
    }catch(e){console.error('ClosetRelay checkpoint unavailable',e.name);return finish(error(503,'The saved workspace is temporarily unavailable. Your last confirmed save is retained; try again.'),id.cookie);}
  },
};
