import {readFile,writeFile,readdir,mkdir,rm,cp} from 'node:fs/promises';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
const assets={};
const mimes={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8','.py':'text/plain; charset=utf-8'};
async function add(file,url){
  const bytes=await readFile(file),ext=file.slice(file.lastIndexOf('.')),binary=['.woff2','.ttf','.png'].includes(ext);let body=binary?bytes.toString('base64'):bytes.toString();
  if(url==='/')body=body.replace('<script src="/app.js" defer></script>','<script src="/hosted/start.mjs" type="module"></script>').replace('Local workspace','Hosted demo').replace('One local operator records',"Your isolated demo workspace records").replace('Opening your workspace…','Opening your saved demo… The first visit can take about 15 seconds.').replace('Connected locally','Connected to hosted demo');
  if(url==='/app.js'){
    body=body.replace('await fetch(path,','await globalThis.closetHostedRequest(path,').replaceAll('The local workspace is not responding. Check that the server is running, then refresh.','Your workspace could not load. Check your connection and refresh.').replaceAll('Connected locally','Hosted demo').replaceAll('this local workspace','this demo workspace');
    body=body.replace("'This action did not finish.'", "(error.body?.error?.code === 'save_outcome_unknown' ? 'Check the saved record.' : 'This action did not finish.')");
    body=body.replace('<button class="button button-quiet" data-action="configure-provider">','<button class="button button-quiet" disabled title="Provider setup is available in the local app" data-action="configure-provider">');
    body=body.replaceAll('type="file" accept=','type="file" disabled accept=').replace('Upload one real garment photograph. No sample photo will be invented.','Photo uploads are disabled in this fictional hosted demo.');
  }
  assets[url]={body,type:mimes[ext]??'application/octet-stream',encoding:binary?'base64':'text'};
}
async function walk(dir,prefix=''){for(const row of await readdir(dir,{withFileTypes:true})){if(row.isDirectory()){await walk(`${dir}/${row.name}`,`${prefix}/${row.name}`);continue;}if(/Manrope|InstrumentSerif/.test(row.name))continue;await add(`${dir}/${row.name}`,`${prefix}/${row.name}`==='/index.html'?'/':`${prefix}/${row.name}`);}}
await walk('ui');
const fixtureHashes={};
for(const [key,name] of [['adult','synthetic-adult.png'],['blazer','synthetic-navy-blazer.png']]){
  await add(`demo-assets/${name}`,`/demo/${name}`);
  fixtureHashes[key]=createHash('sha256').update(await readFile(`demo-assets/${name}`)).digest('hex');
}
await writeFile('hosted/fixtures.generated.mjs',`export default ${JSON.stringify(fixtureHashes)};\n`);
for(const name of ['start.mjs','python-worker.mjs','try-on.mjs'])await add(`hosted/${name}`,`/hosted/${name}`);
for(const name of ['__init__.py','demo.py','model.py','server.py'])await add(`backend/${name}`,`/hosted-python/${name}`);
await add('hosted/bridge.py','/hosted-python/bridge.py');
await writeFile('hosted/assets.generated.mjs',`export default ${JSON.stringify(assets)};\n`);
await rm('dist',{recursive:true,force:true});await mkdir('dist/server',{recursive:true});await mkdir('dist/.openai',{recursive:true});
await build({entryPoints:['hosted/worker.mjs'],outfile:'dist/server/index.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true});
await cp('.openai/hosting.json','dist/.openai/hosting.json');await cp('drizzle','dist/.openai/drizzle',{recursive:true});
console.log('Built the actual Python workflow, hosted snapshots and refined typography.');
