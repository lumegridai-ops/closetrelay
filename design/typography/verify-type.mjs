/** Read-only live-page typography checks. Inventory and appointment APIs are not mutated. */
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const base=process.env.TYPE_URL || 'http://127.0.0.1:4323';
const run=process.env.TYPE_RUN || 'final';
const out=path.join(root,'design/typography/evidence',run);await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();
const result={startedAt:new Date().toISOString(),url:base,readOnly:true,viewports:[],checks:[],pageErrors:[]};
page.on('pageerror',e=>result.pageErrors.push(e.message));
const save=(name,data)=>fs.writeFile(path.join(out,name),JSON.stringify(data,null,2)+'\n');
const shot=name=>page.screenshot({path:path.join(out,name+'.png'),animations:'disabled'});
const layout=()=>page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('main *, .topbar *, .sidebar > *')].filter(el=>{const r=el.getBoundingClientRect(),c=getComputedStyle(el);return r.width>0&&c.position!=='fixed'&&r.right>innerWidth+1&& !el.closest('#appointments');}).slice(0,20).map(el=>({tag:el.tagName,cls:el.className,text:el.textContent.trim().slice(0,80)}))}));
try{
 await page.goto(base);await page.locator('#app:not([hidden])').waitFor();await page.evaluate(()=>document.fonts.ready);
 result.font=await page.evaluate(()=>({faces:[...document.fonts].map(f=>({family:f.family,status:f.status})),body:getComputedStyle(document.body).fontFamily,headline:getComputedStyle(document.querySelector('h1')).fontFamily,bodySize:getComputedStyle(document.body).fontSize,detailSize:getComputedStyle(document.querySelector('.condition-note')).fontSize,buttonSize:getComputedStyle(document.querySelector('.button-primary')).fontSize,fontRequests:performance.getEntriesByType('resource').filter(x=>/\.(ttf|woff2?)/.test(x.name)).map(x=>x.name)}));
 assert.ok(result.font.faces.some(f=>f.family==='Source Sans 3'&&f.status==='loaded'));assert.match(result.font.body,/Source Sans 3/);assert.match(result.font.headline,/Source Sans 3/);assert.equal(result.font.detailSize,'16px');assert.equal(result.font.buttonSize,'16px');assert.equal(result.font.fontRequests.length,1);
 result.checks.push('One local Source Sans 3 font loaded; body/details/actions are 16px; no legacy font requested.');
 for(const [width,height] of [[1440,1000],[1280,720],[1024,900],[768,1000],[390,844],[320,800]]){
  await page.setViewportSize({width,height});await page.evaluate(()=>window.scrollTo(0,0));const observation=await layout();result.viewports.push(observation);await shot(`initial-${width}`);assert.equal(observation.documentWidth,width,`${width}px horizontal document overflow`);assert.equal(observation.overflow.length,0,`${width}px elements extend beyond viewport`);
 }
 result.checks.push('No horizontal overflow at 1440, 1280, 1024, 768, 390 and 320 CSS pixels.');
 await page.setViewportSize({width:390,height:844});await page.locator('[data-action="show-choice"]').click();await page.waitForFunction(()=>getComputedStyle(document.querySelector('#mobile-selection')).display==='none');await shot('selected-sheet-mobile');
 assert.equal(await page.evaluate(()=>document.activeElement.id),'choice-heading');result.checks.push('Mobile selected-sheet shortcut still focuses the heading.');
 for(const [width,height] of [[1440,1000],[390,844]]){
  await page.setViewportSize({width,height});await page.evaluate(()=>{document.documentElement.style.fontSize='200%';window.scrollTo(0,0);});
  await shot(`text-200-${width}`);const observation=await layout();result.viewports.push({kind:'200% root text',...observation});assert.equal(observation.documentWidth,width,`${width}px text resize overflow`);assert.equal(observation.overflow.length,0,`${width}px resized content extends outside viewport`);
  await page.evaluate(()=>document.documentElement.style.removeProperty('font-size'));
 }
 result.checks.push('200% root text size has no document or element overflow at desktop and phone widths.');
 for(const [width,height] of [[1440,1000],[390,844]]){
  await page.setViewportSize({width,height});const style=await page.addStyleTag({content:'*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}'});
  await page.evaluate(()=>window.scrollTo(0,0));await shot(`text-spacing-${width}`);const observation=await layout();result.viewports.push({kind:'WCAG text spacing settings',...observation});assert.equal(observation.documentWidth,width,`${width}px spacing override overflow`);assert.equal(observation.overflow.length,0,`${width}px spacing override content extends outside viewport`);await style.evaluate(el=>el.remove());
 }
 result.checks.push('User text-spacing overrides have no document or element overflow at desktop and phone widths.');
 const fallback=await context.newPage();fallback.on('pageerror',e=>result.pageErrors.push(e.message));await fallback.route('**/fonts/*',r=>r.abort());await fallback.setViewportSize({width:390,height:844});await fallback.goto(base);await fallback.locator('#app:not([hidden])').waitFor();await fallback.evaluate(()=>document.fonts.ready);await fallback.screenshot({path:path.join(out,'font-unavailable-mobile.png'),animations:'disabled'});assert.equal(await fallback.evaluate(()=>document.documentElement.scrollWidth),390);assert.equal(await fallback.locator('[data-action="approve"]').isEnabled(),true);await fallback.close();result.checks.push('System fallback remains readable and approval available when the font request fails.');
 assert.deepEqual(result.pageErrors,[]);result.checks.push('No uncaught JavaScript errors.');result.status='passed';
}catch(error){result.status='failed';result.error={message:error.message,stack:error.stack};await shot('failure');process.exitCode=1;console.error(error);}
finally{result.finishedAt=new Date().toISOString();result.sources={};for(const file of ['ui/index.html','ui/styles.css','ui/typography.css','ui/app.js'])result.sources[file]=crypto.createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex');await save('results.json',result);await browser.close();console.log(JSON.stringify({status:result.status,checks:result.checks,viewports:result.viewports},null,2));}
