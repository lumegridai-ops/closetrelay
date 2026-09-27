import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
const preview=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2026-09-26',host:'127.0.0.1',port:4327,d1Databases:{DB:'closetrelay-local'},r2Buckets:{FILES:'closetrelay-files'},d1Persist:'.wrangler/d1',r2Persist:'.wrangler/r2'}));
const db=await preview.getD1Database('DB');
for(const file of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const statement of (await readFile('drizzle/'+file,'utf8')).split(';').map(s=>s.replace(/--> statement-breakpoint/g,'').trim()).filter(Boolean))await db.prepare(statement.replace('CREATE TABLE ','CREATE TABLE IF NOT EXISTS ')).run();
console.log(`Hosted preview ready: ${await preview.ready}`);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await preview.dispose();process.exit(0);});
