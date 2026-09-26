// Actual local browser recording with fictional records and disclosed synthetic narration.
// Requires Node, Playwright Chromium, Python 3.12+, macOS say, ffmpeg and ffprobe.
import {chromium} from 'playwright';
import {spawn, execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'artifacts', 'recording');
await fs.mkdir(out, {recursive:true});
const narration = [
  'Closet Relay connects one clothing choice to the exact item held and packed. This is the working local application, recorded with fictional appointments and synthetic narration. One operator controls this prototype; separate client and staff logins are not implemented.',
  'The operator records a specific item choice, then creates an exclusive hold. Looking at a garment alone never reserves it. The saved record keeps the item identity and version connected to this appointment.',
  'At packing, I deliberately enter the wrong jacket number. The server refuses it and preserves the existing hold. Entering the correct number records one packing handoff. This is a recorded packing action, not proof of shipping or delivery.',
  'Reloading keeps the handoff. The second appointment sees the packed item as unavailable for a new approval. The original choice and exact physical item are intended to remain connected across the workflow.',
  'The optional You Cam preview is disabled because no API key is connected. The real adapter is implemented and tested offline, but live inference is unverified. No generated picture is substituted for a provider result. The non-photo workflow remains complete.',
  'This prototype has no customer study or proven advantage over existing styling and inventory tools. Its next gates are real provider validation, authenticated remote access, and a fair workflow comparison. Source, failure cases and test evidence are available for review.'
];
const segments = [];
for (let index = 0; index < narration.length; index++) {
  const textFile = path.join(out, `narration-${index}.txt`);
  const audioFile = path.join(out, `narration-${index}.aiff`);
  await fs.writeFile(textFile, narration[index] + '\n');
  execFileSync('say', ['-v','Samantha (English (US))','-r','175','-f',textFile,'-o',audioFile]);
  const duration = Number(execFileSync('ffprobe', ['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',audioFile], {encoding:'utf8'}).trim());
  segments.push({text:narration[index], audioFile, duration});
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'closetrelay-recording-'));
const env = {...process.env};
delete env.YOUCAM_API_KEY;
const server = spawn(process.env.CLOSETRELAY_PYTHON || 'python3', ['-B','-m','backend.server','--port','0','--database',path.join(tmp,'demo.sqlite3')], {cwd:root, env, stdio:['ignore','pipe','pipe']});
const url = await new Promise((resolve,reject) => {
  let buffer = '';
  const timer = setTimeout(() => reject(new Error('Server did not start')), 15000);
  server.stdout.on('data', chunk => {
    buffer += chunk;
    if (buffer.includes('\n')) {
      try { const startup = JSON.parse(buffer.split('\n')[0]); clearTimeout(timer); resolve(startup.url); }
      catch (error) { clearTimeout(timer); reject(error); }
    }
  });
  server.on('error', reject);
  server.on('exit', code => { if (!buffer.includes('\n')) reject(new Error(`Server exited ${code}`)); });
});
const browser = await chromium.launch();
const context = await browser.newContext({viewport:{width:1440,height:1080},recordVideo:{dir:out,size:{width:1440,height:1080}}});
const page = await context.newPage();
const video = page.video();
const errors = [], requests = [], timeline = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', async response => {
  if (response.url().includes('/api/') && response.request().method() !== 'GET') {
    try { requests.push({at:new Date().toISOString(),path:new URL(response.url()).pathname,method:response.request().method(),request:response.request().postDataJSON(),status:response.status(),response:await response.json()}); } catch {}
  }
});
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let started;
async function segment(index, action) {
  const start = (Date.now()-started)/1000;
  if (action) await action();
  const elapsed = (Date.now()-started)/1000-start;
  await pause(Math.max(400, (segments[index].duration + 0.7 - elapsed)*1000));
  timeline.push({index,start,end:(Date.now()-started)/1000,text:segments[index].text,audio_seconds:segments[index].duration});
}
try {
  await page.goto(url);
  await page.getByRole('button',{name:'Record client approval',exact:true}).waitFor();
  started = Date.now();
  await segment(0);
  await segment(1, async () => {
    await page.getByRole('button',{name:'Record client approval',exact:true}).click();
    await page.getByRole('button',{name:'Place an exclusive hold',exact:true}).click();
    await page.getByLabel('Scan or type the item ID').waitFor();
    await page.locator('#choice-panel').scrollIntoViewIfNeeded();
  });
  await segment(2, async () => {
    await page.getByLabel('Scan or type the item ID').fill('DEMO-JKT-02');
    await page.getByRole('button',{name:'Confirm exact item & pack',exact:true}).click();
    await page.getByText('Scanned item does not match the exact held and approved item',{exact:true}).waitFor();
    await page.locator('#message').scrollIntoViewIfNeeded();
    await pause(4300);
    await page.getByLabel('Scan or type the item ID').fill('DEMO-JKT-01');
    await page.getByRole('button',{name:'Confirm exact item & pack',exact:true}).click();
    await page.getByText('Exact item confirmed and packed.',{exact:true}).waitFor();
  });
  await segment(3, async () => {
    await page.reload();
    await page.getByRole('heading',{name:'The right item, packed.',exact:true}).waitFor();
    await page.getByRole('button',{name:/Fictional appointment B/}).click();
    await page.getByRole('button',{name:'View Sample navy jacket, DEMO-JKT-01, Packed',exact:true}).click();
    await page.locator('#choice-panel').scrollIntoViewIfNeeded();
  });
  await segment(4, async () => {
    await page.getByText('Why is the preview unavailable?',{exact:true}).click();
    await page.getByRole('button',{name:'YouCam preview unavailable',exact:true}).scrollIntoViewIfNeeded();
  });
  await segment(5, async () => { await page.evaluate(() => window.scrollTo({top:0,behavior:'smooth'})); });
  const state = await (await page.request.get(`${url}/api/state`)).json();
  if (state.provider.configured || !state.appointments.some(a => a.id==='demo-appointment-a' && a.handoffs.length===1)) throw new Error('Demo end-state is not truthful');
  if (errors.length) throw new Error(errors.join('\n'));
  await fs.writeFile(path.join(out,'actual-api-trace.json'),JSON.stringify({requests,state},null,2)+'\n');
  await fs.writeFile(path.join(out,'timeline.json'),JSON.stringify(timeline,null,2)+'\n');
} finally {
  await context.close();
  await browser.close();
  server.kill('SIGINT');
}
const videoFile = await video.path();
const final = path.join(root,'artifacts','closetrelay-local-prototype.mp4');
const audioInputs = segments.flatMap(s => ['-i',s.audioFile]);
const filter = segments.map((s,i) => `[${i+1}:a]aresample=48000,adelay=${Math.round(timeline[i].start*1000)}:all=1[a${i}]`).join(';') + ';' + segments.map((s,i)=>`[a${i}]`).join('') + `amix=inputs=${segments.length}:normalize=0[a]`;
execFileSync('ffmpeg',['-y','-i',videoFile,...audioInputs,'-filter_complex',filter,'-map','0:v','-map','[a]','-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-movflags','+faststart','-shortest',final],{stdio:'ignore'});
const media = JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration,size:stream=codec_name,width,height','-of','json',final],{encoding:'utf8'}));
const sha256 = crypto.createHash('sha256').update(await fs.readFile(final)).digest('hex');
await fs.writeFile(path.join(root,'artifacts','demo-manifest.json'),JSON.stringify({created_at:new Date().toISOString(),file:'closetrelay-local-prototype.mp4',sha256,media,actual_browser_recording:true,fictional_records:true,synthetic_narration:true,live_youcam:false,submitted:false},null,2)+'\n');
console.log(JSON.stringify({file:final,sha256,seconds:media.format.duration}));
