// Native browser PNG capture: preserve real wall-clock timing, then deliver a 30fps edit.
// Source frames are sampled as quickly as Chromium can encode PNG, capped at 12.5fps.
// The output frame rate does not imply that every source frame is unique.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';

export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export async function run(command,args,{cwd}={}) {
  return await new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
    child.on('error',reject);child.on('exit',code=>code===0?resolve(stdout):reject(Error(`${command} exited ${code}: ${stderr.slice(-5000)}`)));
  });
}
export async function capture(page,directory) {
  await fs.mkdir(directory,{recursive:true});
  const frames=[];let active=true,lastHash='',error=null;
  const started=performance.now();
  const loop=(async()=>{
    while(active){
      const begin=performance.now();
      try {
        const bytes=await page.screenshot({type:'png',animations:'allow'});
        const at=(begin-started)/1000,digest=hash(bytes);
        if(digest!==lastHash){
          const name=`frame-${String(frames.length).padStart(5,'0')}.png`;
          const file=path.join(directory,name);
          await fs.writeFile(file,bytes);
          frames.push({file,at,sha256:digest,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)});lastHash=digest;
        }
      }catch(e){error=e;active=false;}
      await pause(Math.max(0,80-(performance.now()-begin)));
    }
  })();
  return {
    now:()=> (performance.now()-started)/1000,
    stop:async()=>{const duration=(performance.now()-started)/1000;active=false;await loop;if(error)throw error;await fs.writeFile(path.join(directory,'frames.json'),JSON.stringify({method:'Native device-scale PNG screenshots of actual app interactions; repeated unchanged frames removed; wall-clock timing preserved',duration,frames},null,2)+'\n');return{frames,duration};}
  };
}

export async function makeCard(browser,{file,product,eyebrow,title,subtitle,footer,theme='lift',closing=false}) {
  const context=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:3});
  const page=await context.newPage();
  const colors=theme==='lift'?{bg:'#f2f0e8',ink:'#132f3b',accent:'#cc5028',muted:'#536b74'}:{bg:'#f6f2e9',ink:'#24382f',accent:'#c17d24',muted:'#5b6960'};
  const repo=path.resolve(import.meta.dirname,'..');
  const font=await fs.readFile(path.join(repo,theme==='lift'?'public/fonts/IBMPlexSans-Variable.ttf':'ui/fonts/Manrope.ttf'));
  const display=theme==='lift'?font:await fs.readFile(path.join(repo,'ui/fonts/InstrumentSerif-Regular.ttf'));
  const faces=`@font-face{font-family:Brand;src:url(data:font/ttf;base64,${font.toString('base64')});font-weight:100 900}@font-face{font-family:Display;src:url(data:font/ttf;base64,${display.toString('base64')});font-weight:${theme==='lift'?'100 900':'400'}}`;
  const mark=theme==='lift'?'<svg viewBox="0 0 32 32"><path d="M7 25V7m-4 4 4-4 4 4M25 7v18m-4-4 4 4 4-4M16 5v22"/></svg>':'<svg viewBox="0 0 32 32"><path d="M13 8a3 3 0 1 1 5 2c-2 1-2 2-2 5L4 23h24l-12-8"/></svg>';
  const escape=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  await page.setContent(`<!doctype html><html><meta charset="utf-8"><style>${faces}*{box-sizing:border-box}body{margin:0;background:${colors.bg};color:${colors.ink};font-family:Brand,Arial,Helvetica,sans-serif;width:1280px;height:720px;padding:56px 70px;display:flex;flex-direction:column;position:relative;overflow:hidden}.top{display:flex;justify-content:space-between;align-items:center;font-weight:700;font-size:23px;letter-spacing:-.6px}.logo{display:flex;gap:13px;align-items:center}.mark{height:36px;width:36px;border:2px solid ${colors.ink};border-radius:${theme==='lift'?'9px':'50%'};display:grid;place-items:center;font-size:23px;color:${colors.accent}}.mark svg{width:27px;height:27px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.edition{font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:${colors.muted}}.main{margin:auto 0;max-width:1030px}.eyebrow{font-size:13px;letter-spacing:2px;font-weight:700;color:${colors.accent};text-transform:uppercase;margin-bottom:20px}h1{font-family:Display,Brand,sans-serif;font-size:${theme==='closet'?100:closing?82:78}px;line-height:1.04;letter-spacing:-3px;margin:0 0 24px;font-weight:${theme==='closet'?400:600};max-width:1090px}h1 span{color:${colors.accent}}.subtitle{font-size:23px;line-height:1.5;max-width:900px;color:${colors.muted};margin:0}.bottom{border-top:1px solid ${colors.ink}35;display:flex;justify-content:space-between;padding-top:21px;align-items:center;font-size:12px;letter-spacing:.15px}.line{position:absolute;right:62px;bottom:105px;display:flex;gap:14px;opacity:.75}.dot{height:13px;width:13px;border:2px solid ${colors.accent};border-radius:50%}.dot:last-child{background:${colors.accent}}.rule{width:64px;height:2px;background:${colors.accent};align-self:center}</style><div class="top"><div class="logo"><div class="mark">${mark}</div>${escape(product)}</div><div class="edition">${closing?'Build & evidence':'A working product demo'}</div></div><div class="main"><div class="eyebrow">${escape(eyebrow)}</div><h1>${title.split('\n').map(escape).join('<br>')}</h1><p class="subtitle">${escape(subtitle)}</p></div><div class="line"><i class="dot"></i><i class="rule"></i><i class="dot"></i><i class="rule"></i><i class="dot"></i></div><div class="bottom"><span>${escape(footer)}</span><span>Gemini synthetic narration · Actual application capture</span></div></html>`);
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:file});await context.close();
}

function srtTime(seconds){const ms=Math.max(0,Math.round(seconds*1000));return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;}
export async function encode({frames,duration,audio,timeline,intro,outro,output,directory}) {
  const introDuration=audio[0].seconds+0.65,outroDuration=audio.at(-1).seconds+1.2;
  const sequences=[{file:intro,duration:introDuration}];
  if(!frames.length)throw Error('No actual browser frames');
  if(frames.some(f=>f.width!==3840||f.height!==2160))throw Error('Source capture was not native 3840×2160');
  for(let i=0;i<frames.length;i++)sequences.push({file:frames[i].file,duration:Math.max(0.001,(frames[i+1]?.at??duration)-frames[i].at)});
  sequences.push({file:outro,duration:outroDuration});
  const safe=p=>p.replaceAll("'", "'\\''");
  const concat=path.join(directory,'frames.ffconcat');
  await fs.writeFile(concat,'ffconcat version 1.0\n'+sequences.map(f=>`file '${safe(f.file)}'\nduration ${f.duration.toFixed(6)}`).join('\n')+`\nfile '${safe(outro)}'\n`);
  const allTimeline=[{index:0,start:0,end:introDuration,text:audio[0].text},...timeline.map(t=>({...t,start:t.start+introDuration,end:t.end+introDuration})),{index:audio.length-1,start:introDuration+duration,end:introDuration+duration+outroDuration,text:audio.at(-1).text}];
  const filters=audio.map((a,i)=>`[${i+1}:a]aresample=48000,adelay=${Math.round(allTimeline.find(t=>t.index===i).start*1000)}:all=1[a${i}]`);
  filters.push(audio.map((_,i)=>`[a${i}]`).join('')+`amix=inputs=${audio.length}:duration=longest:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=7,apad[a]`);
  const total=introDuration+duration+outroDuration;
  await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-safe','0','-f','concat','-i',concat,...audio.flatMap(a=>['-i',a.file]),'-filter_complex',filters.join(';'),'-map','0:v','-map','[a]','-vf','fps=30,format=yuv420p','-c:v','libx264','-preset','slow','-crf','16','-profile:v','high','-c:a','aac','-b:a','256k','-ar','48000','-t',total.toFixed(3),'-movflags','+faststart',output]);
  let cues=[],cue=1;
  for(const t of allTimeline){
    const phrases=t.text.match(/[^.!?]+[.!?]?/g).map(x=>x.trim()).filter(Boolean);
    const sum=phrases.reduce((n,p)=>n+p.length,0);let cursor=t.start;
    for(const p of phrases){const seconds=(audio[t.index].seconds)*p.length/sum;const words=p.split(' '),lines=[''];for(const word of words){if(lines.at(-1).length+word.length+1>64)lines.push('');lines[lines.length-1]+=(lines.at(-1)?' ':'')+word;}cues.push(`${cue++}\n${srtTime(cursor)} --> ${srtTime(cursor+seconds)}\n${lines.join('\n')}\n`);cursor+=seconds;}
  }
  await fs.writeFile(output.replace(/\.mp4$/,'.srt'),cues.join('\n'));
  await fs.writeFile(path.join(directory,'timeline.json'),JSON.stringify(allTimeline,null,2)+'\n');
  const probe=JSON.parse(await run('ffprobe',['-v','error','-show_format','-show_streams','-of','json',output]));
  return {probe,sha256:hash(await fs.readFile(output)),timeline:allTimeline,source_frames:frames.length,source_resolution:[3840,2160],delivery_fps:30,source_sampling:'Native PNG frames sampled at up to 12.5fps; measured actual timestamps and held frames, not motion interpolation'};
}
