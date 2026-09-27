import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.CLOSET_QA_URL??'http://127.0.0.1:4327';
const output=process.env.CLOSET_QA_OUTPUT??'design/hosted-qa/local';await mkdir(output,{recursive:true});
const browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
const receipt={url:base,at:new Date().toISOString(),checks:[],errors:[]};page.on('pageerror',e=>receipt.errors.push(e.message));
async function ready(p){await p.locator('#app:not([hidden])').waitFor({timeout:60000});}
async function api(p,path,method='GET',body){return p.evaluate(async({path,method,body})=>{const r=await globalThis.closetHostedRequest(path,{method,body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};},{path,method,body});}
try{
  const t=Date.now();const loaded=await page.goto(base);assert.equal(loaded.status(),200);await ready(page);receipt.initialLoadMs=Date.now()-t;
  assert.match(await page.locator('body').innerText(),/Hosted demo/);
  assert.match(await page.locator('h1').evaluate(e=>getComputedStyle(e).fontFamily),/Source Sans 3/);
  await page.screenshot({path:output+'/desktop.png'});receipt.checks.push('Anonymous browser opens actual Pyodide workflow with Source Sans 3.');
  await page.getByRole('button',{name:'Record client approval',exact:true}).click();
  await page.getByRole('button',{name:/Place an exclusive hold/}).click();
  await page.locator('#scan-id').waitFor();await page.locator('#scan-id').fill('DEMO-JKT-02');await page.getByRole('button',{name:/Confirm exact item & pack/}).click();
  await page.locator('#pack-error').waitFor();const wrong=await api(page,'/api/state');assert.equal(wrong.body.appointments[0].handoffs.length,0);receipt.checks.push('Real UI approval/hold persists; wrong-item packing writes no handoff.');
  const changed=await api(page,'/api/items/DEMO-JKT-01','PATCH',{expected_version:1,condition:'Fictional hosted QA: changed cuff condition'});assert.equal(changed.status,200);
  const a=(await api(page,'/api/appointments/demo-appointment-a')).body;assert.equal(a.active_holds.length,0);assert.notEqual(a.approval.state,'active');receipt.checks.push('Changing inventory invalidates the old approval and hold.');
  const approval=await api(page,'/api/appointments/demo-appointment-a/choice','POST',{item_id:'DEMO-JKT-01',expected_version:2,expected_choice_revision:a.choice_revision});assert.equal(approval.status,201);
  const held=await api(page,'/api/appointments/demo-appointment-a/hold','POST',{approval_id:approval.body.id});assert.equal(held.status,200);
  assert.equal((await api(page,'/api/appointments/demo-appointment-b/choice','POST',{item_id:'DEMO-JKT-01',expected_version:2,expected_choice_revision:0})).status,409);
  const body={item_id:'DEMO-JKT-01',request_key:'hosted-qa-exact'};const packed=await api(page,`/api/holds/${held.body.id}/pack`,'POST',body);assert.equal(packed.status,200);
  assert.equal((await api(page,`/api/holds/${held.body.id}/pack`,'POST',body)).body.id,packed.body.id);receipt.checks.push('Another appointment cannot claim the hold; exact-item pack is idempotent.');
  await page.reload();await ready(page);assert.equal((await api(page,'/api/state')).body.appointments[0].handoffs.length,1);receipt.checks.push('Confirmed packing survives a fresh browser engine and reload from hosted storage.');
  const otherContext=await browser.newContext();const other=await otherContext.newPage();await other.goto(base);await ready(other);assert.equal((await api(other,'/api/state')).body.appointments[0].handoffs.length,0);await otherContext.close();receipt.checks.push('Separate browser has isolated fictional inventory and no first visitor handoff.');
  assert.equal((await api(page,'/api/appointments/demo-appointment-b/previews','POST',{})).status,503);assert.equal((await api(page,'/api/provider/configure','POST',{api_key:'unused-test-sentinel'})).status,503);receipt.checks.push('Arbitrary personal-photo provider calls and visitor key configuration reject; the fixed fictional sample is tested separately.');
  if(process.env.CLOSET_QA_FAULTS==='1'){
    let intercepted=false;
    await page.route('**/workspace/checkpoint',async route=>{if(!intercepted&&route.request().method()==='PUT'){intercepted=true;await route.fetch();await route.abort('failed');}else await route.continue();});
    const lost=await api(page,'/api/appointments','POST',{name:'Fictional lost-response QA'});assert.equal(lost.status,503);assert.equal(lost.body.error.code,'save_outcome_unknown');
    assert.equal((await api(page,'/api/state')).body.appointments.filter(a=>a.name==='Fictional lost-response QA').length,1);await page.unroute('**/workspace/checkpoint');receipt.checks.push('Injected lost PUT response reports uncertainty and reloads the committed record once.');
  }
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:output+'/mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);receipt.checks.push('Phone layout has no horizontal document overflow.');
  assert.deepEqual(receipt.errors,[]);receipt.status='passed';
}catch(error){receipt.status='failed';receipt.error=error.message;await page.screenshot({path:output+'/failure.png',fullPage:true});process.exitCode=1;}
finally{await writeFile(output+'/receipt.json',JSON.stringify(receipt,null,2)+'\n');await browser.close();console.log(JSON.stringify(receipt,null,2));}
