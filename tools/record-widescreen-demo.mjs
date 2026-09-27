// Fresh native 4K frames of the actual local application, fictional records, real HTTP writes.
// Gemini WAV narration is generated separately; this script never reads an API key.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {capture,encode,makeCard,pause,hash} from './native-video.mjs';

const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'artifacts','widescreen-recording');
const narration=process.env.NARRATION_DIR||path.join(root,'artifacts','narration');
await fs.mkdir(out,{recursive:true});
const audio=[];
for(let index=0;index<8;index++){
  const name=`closetrelay-${String(index).padStart(2,'0')}`;
  const metadata=JSON.parse(await fs.readFile(path.join(narration,name+'.json'),'utf8'));
  const file=path.join(narration,name+'.wav');
  if(hash(await fs.readFile(file))!==metadata.sha256)throw Error('Narration hash mismatch: '+name);
  audio.push({...metadata,file});
}
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'closetrelay-widescreen-'));
const env={...process.env};delete env.YOUCAM_API_KEY;
const server=spawn(process.env.CLOSETRELAY_PYTHON||'python3',['-B','-m','backend.server','--port','0','--database',path.join(tmp,'demo.sqlite3')],{cwd:root,env,stdio:['ignore','pipe','pipe']});
const url=await new Promise((resolve,reject)=>{let buffer='';const timer=setTimeout(()=>reject(Error('Server did not start')),15000);server.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.includes('\n')){try{clearTimeout(timer);resolve(JSON.parse(buffer.split('\n')[0]).url);}catch(e){reject(e);}}});server.on('error',reject);server.on('exit',code=>{if(!buffer.includes('\n'))reject(Error(`Server exited ${code}`));});});
const browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:3,reducedMotion:'reduce'});
const page=await context.newPage(),requests=[],errors=[],timeline=[];page.setDefaultTimeout(15000);
page.on('pageerror',e=>errors.push(e.message));
page.on('response',async response=>{
  if(response.url().includes('/api/')&&response.request().method()!=='GET'){
    try{requests.push({at:new Date().toISOString(),path:new URL(response.url()).pathname,method:response.request().method(),request:response.request().postDataJSON(),status:response.status(),response:await response.json()});}catch{}
  }
});
const intro=path.join(out,'intro.png'),outro=path.join(out,'outro.png');
await makeCard(browser,{file:intro,product:'ClosetRelay',eyebrow:'One choice. One physical item.',title:'Similar isn’t\nthe same.',subtitle:'Keep a clothing choice connected to the exact item that gets packed.',footer:'Working local prototype · Fictional appointments',theme:'closet'});
await makeCard(browser,{file:outro,product:'ClosetRelay',eyebrow:'Chosen → Held → Packed',title:'One continuous\nrecord.',subtitle:'Source and observed failure cases: github.com/lumegridai-ops/closetrelay',footer:'Local prototype · YouCam live inference unverified · No customer validation claimed',theme:'closet',closing:true});
let recording,result;
try{
  await page.goto(url);await page.getByRole('button',{name:'Record client approval',exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:path.join(root,'artifacts','desktop-4k.png'),fullPage:true});
  recording=await capture(page,path.join(out,'frames'));
  async function segment(index,action){const start=recording.now();if(action)await action();await pause(Math.max(500,(audio[index].seconds+1-(recording.now()-start))*1000));timeline.push({index,start,end:recording.now(),text:audio[index].text});}
  await segment(1,async()=>{
    await pause(1500);await page.getByRole('button',{name:'Record client approval',exact:true}).click();await pause(1500);
    await page.getByRole('button',{name:'Place an exclusive hold',exact:true}).click();await page.getByLabel('Scan or type the item ID').waitFor();await page.locator('#choice-panel').scrollIntoViewIfNeeded();
  });
  await segment(2,async()=>{
    await page.getByRole('button',{name:'Update item details',exact:true}).click();await page.locator('#edit-condition').fill('Small crease at left cuff; inspected in this fictional demo.');
    await pause(1800);await page.getByRole('button',{name:'Save & require fresh approval',exact:true}).click();
    await page.getByRole('button',{name:'Record a new approval',exact:true}).waitFor();await page.locator('#choice-panel').scrollIntoViewIfNeeded();
    await pause(2800);await page.screenshot({path:path.join(root,'artifacts','approval-invalidated-4k.png'),fullPage:true});
    await page.getByRole('button',{name:'Record a new approval',exact:true}).click();await pause(700);await page.getByRole('button',{name:'Place an exclusive hold',exact:true}).click();
    await page.getByLabel('Scan or type the item ID').waitFor();await page.locator('#choice-panel').scrollIntoViewIfNeeded();
  });
  await segment(3,async()=>{
    await page.getByLabel('Scan or type the item ID').fill('DEMO-JKT-02');await pause(700);await page.getByRole('button',{name:'Confirm exact item & pack',exact:true}).click();
    await page.locator('#pack-error').waitFor({state:'visible'});if(!(await page.locator('#pack-error').innerText()).includes('Scanned item does not match'))throw Error('Wrong-item error is not visible');await page.locator('#pack-error').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(root,'artifacts','wrong-item-4k.png'),fullPage:true});
  });
  await segment(4,async()=>{
    await page.getByLabel('Scan or type the item ID').fill('DEMO-JKT-01');await pause(800);await page.getByRole('button',{name:'Confirm exact item & pack',exact:true}).click();await page.getByText('Exact item confirmed and packed.',{exact:true}).waitFor();
    await pause(1900);await page.reload();await page.getByRole('heading',{name:'The right item, packed.',exact:true}).waitFor();
    await pause(1500);await page.getByRole('button',{name:/Fictional appointment B/}).click();await page.getByRole('button',{name:'View Sample navy jacket, DEMO-JKT-01, Packed',exact:true}).click();await page.locator('#choice-panel').scrollIntoViewIfNeeded();
  });
  await segment(5,async()=>{
    await page.getByText('Why is the preview unavailable?',{exact:true}).click();await page.getByRole('button',{name:'YouCam preview unavailable',exact:true}).scrollIntoViewIfNeeded();
  });
  await segment(6,async()=>{await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));});
  const state=await(await page.request.get(url+'/api/state')).json();
  if(state.provider.configured)throw Error('Unexpected provider credential in recording');
  if(!state.appointments.some(a=>a.id==='demo-appointment-a'&&a.handoffs.length===1))throw Error('Packing result does not match the narration');
  if(!requests.some(r=>r.status===409&&r.path.endsWith('/pack')))throw Error('The wrong-item rejection was not recorded');
  if(errors.length)throw Error(errors.join('\n'));
  result=await recording.stop();recording=null;
  await fs.writeFile(path.join(out,'actual-api-trace.json'),JSON.stringify({requests,state},null,2)+'\n');
  const output=path.join(root,'artifacts','closetrelay-demo-4k.mp4');
  const rendered=await encode({...result,audio,timeline,intro,outro,output,directory:out});
  await fs.writeFile(path.join(root,'artifacts','widescreen-demo-manifest.json'),JSON.stringify({recordedAt:new Date().toISOString(),file:path.basename(output),actual_browser_interactions:true,fictional_records:true,live_youcam:false,submitted:false,narration:{provider:'Google Gemini',model:audio[0].model,voice:audio[0].voice,synthetic:true},browserErrors:errors,...rendered},null,2)+'\n');
  console.log(JSON.stringify({output,seconds:rendered.probe.format.duration,sha256:rendered.sha256,sourceFrames:rendered.source_frames}));
}finally{if(recording)await recording.stop().catch(()=>{});await context.close();await browser.close();server.kill('SIGINT');await fs.rm(tmp,{recursive:true,force:true});}
