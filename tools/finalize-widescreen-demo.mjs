// Editorial pass over preserved genuine capture. It never changes app text or results.
// Hash-locked repairs hold the preceding frame over two brief screenshot repaint offsets.
// A disclosed crop briefly enlarges the already captured held item, entered ID and rejection.
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {encode, makeCard, hash, run} from './native-video.mjs';

const root=path.resolve(import.meta.dirname,'..');
const directory=path.join(root,'artifacts/widescreen-recording');
const source=JSON.parse(await fs.readFile(path.join(directory,'frames/frames.json'),'utf8'));
const originalTimeline=JSON.parse(await fs.readFile(path.join(directory,'timeline.json'),'utf8'));
const audio=await Promise.all(Array.from({length:8},async(_,index)=>{
  const base=path.join(root,`artifacts/narration/closetrelay-${String(index).padStart(2,'0')}`);
  const data=JSON.parse(await fs.readFile(base+'.json','utf8'));
  if(hash(await fs.readFile(base+'.wav'))!==data.sha256)throw Error('Narration hash mismatch');
  return {...data,file:base+'.wav'};
}));
const introDuration=audio[0].seconds+.65;
const edits=path.join(directory,'final-edit');await fs.mkdir(edits,{recursive:true});
const previous=JSON.parse(await fs.readFile(path.join(root,'artifacts/widescreen-demo-manifest.json'),'utf8'));
const cut1=path.join(edits,'cut1-manifest.json');
try{await fs.access(cut1);}catch{await fs.writeFile(cut1,JSON.stringify(previous,null,2)+'\n');}
const frames=source.frames.map(f=>({...f,file:path.join(directory,'frames',path.basename(f.file))}));
for(const [index,expected] of [[1,'11c714c3dfdd476894c7ef13ab50d183f62e33af0206b443b4a069971d2df77c'],[5,'1de0805be286fd95cfb2324f302a6449e9295ee43253d0c44daa5bf624777c0e']]){
  if(frames[index].sha256!==expected)throw Error('Different source recording: review before applying repair');
  const prior=frames[index-1];
  frames[index]={...frames[index],file:prior.file,sha256:prior.sha256,edit:'Hold preceding genuine frame during capture/reload flash',original_sha256:expected};
}
const focus={start:36-introDuration,end:42.2-introDuration,x:840,y:390,width:2880,height:1620};
const edited=[];
for(let i=0;i<frames.length;i++){
  const frame=frames[i],end=frames[i+1]?.at??source.duration;
  const points=[frame.at,...[focus.start,focus.end].filter(t=>t>frame.at&&t<end),end];
  for(let j=0;j<points.length-1;j++){
    let part={...frame,at:points[j]};
    if(part.at>=focus.start&&part.at<focus.end){
      const file=path.join(edits,`focus-${i}.png`);
      await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',frame.file,'-vf',`crop=${focus.width}:${focus.height}:${focus.x}:${focus.y},scale=3840:2160:flags=lanczos`,'-frames:v','1',file]);
      part={...part,file,sha256:hash(await fs.readFile(file)),edit:'1.33x editorial crop of native 4K source; fictional item label, expected ID, entered ID, held confirmation and full error retained',original_sha256:frame.sha256};
    }
    edited.push(part);
  }
}
const browser=await chromium.launch();
const intro=path.join(directory,'intro.png'),outro=path.join(directory,'outro.png');
try{
  await makeCard(browser,{file:intro,product:'ClosetRelay',eyebrow:'One choice. One physical item.',title:'Similar isn’t\nthe same.',subtitle:'Keep a clothing choice connected to the exact item that gets packed.',footer:'Working local prototype · Fictional appointments',theme:'closet'});
  await makeCard(browser,{file:outro,product:'ClosetRelay',eyebrow:'Chosen → Held → Packed',title:'One continuous\nrecord.',subtitle:'Source and observed failure cases: github.com/lumegridai-ops/closetrelay',footer:'Local prototype · YouCam live inference unverified · No customer validation claimed',theme:'closet',closing:true});
}finally{await browser.close();}
const output=path.join(root,'artifacts/closetrelay-demo-4k.mp4');
const rendered=await encode({frames:edited,duration:source.duration,audio,timeline:originalTimeline.filter(t=>t.index>0&&t.index<7).map(t=>({...t,start:t.start-introDuration,end:t.end-introDuration})),intro,outro,output,directory});
const captioned=path.join(edits,'captioned.mp4');
await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',output,'-i',output.replace(/\.mp4$/,'.srt'),'-map','0:v','-map','0:a','-map','1:0','-c:v','copy','-c:a','copy','-c:s','mov_text','-metadata:s:s:0','language=eng','-disposition:s:0','default','-movflags','+faststart',captioned]);
await fs.rename(captioned,output);
rendered.sha256=hash(await fs.readFile(output));
rendered.probe=JSON.parse(await run('ffprobe',['-v','error','-show_format','-show_streams','-of','json',output]));
await fs.writeFile(path.join(edits,'edit-manifest.json'),JSON.stringify({source:'../frames/frames.json',edits:edited.filter(f=>f.edit),duration_preserved:true,app_pixels_fabricated:false,caption_timing:'Sentence timings proportional to measured narration segment durations; independently reviewed'},null,2)+'\n');
await fs.writeFile(path.join(root,'artifacts/widescreen-demo-manifest.json'),JSON.stringify({...previous,...rendered,finalizedAt:new Date().toISOString(),editorial_edits:'Two hash-locked screenshot repaint offsets replaced by preceding real frame, preserving time; 36–42.2s uses a disclosed 1.33x crop; title cards refreshed; English selectable captions embedded.',original_source_frames:source.frames.length},null,2)+'\n');
console.log(JSON.stringify({output,seconds:rendered.probe.format.duration,sha256:rendered.sha256}));
