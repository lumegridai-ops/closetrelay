// Run from hosted-tests/ with the repository's existing Miniflare and esbuild.
// Actual workerd, local D1/R2 and native HTTP; the provider is a loopback fake.
// No environment credentials, external provider calls, site build or repo writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output')) {
  throw new Error('Usage: node hosted-tests/workerd-smoke.mjs [--output EMPTY_DIRECTORY]');
}
const out = args.length ? resolve(args[1]) : await mkdtemp(join(tmpdir(), 'closetrelay-workerd-'));
await mkdir(out, { recursive: true });
assert.equal((await readdir(out)).length, 0, 'Evidence directory must be empty; previous evidence is never overwritten');

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceNames = ['sample-preview.mjs', 'image-container.mjs'];
const hashes = {};
for (const name of sourceNames) {
  const bytes = await readFile(join(root, 'hosted', name));
  hashes[name] = sha256(bytes);
  await writeFile(join(out, name), bytes);
}
const adult = await readFile(join(root, 'demo-assets/synthetic-adult.png'));
const blazer = await readFile(join(root, 'demo-assets/synthetic-navy-blazer.png'));
const fixtures = { adult: sha256(adult), blazer: sha256(blazer) };
// Build only this test's dependency; do not require or overwrite generated site files.
await writeFile(join(out, 'fixtures.generated.mjs'), `export default ${JSON.stringify(fixtures)};\n`);
await writeFile(join(out, 'workerd-smoke.mjs'), await readFile(fileURLToPath(import.meta.url)));

const migrations = [];
for (const name of (await readdir(join(root, 'drizzle'))).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
  const sql = await readFile(join(root, 'drizzle', name), 'utf8');
  hashes[`drizzle/${name}`] = sha256(sql);
  migrations.push({ name, sql });
}
assert.ok(migrations.length, 'Expected real repository migrations');
await writeFile(join(out, 'migrations.json'), JSON.stringify(migrations, null, 2) + '\n');

const calls = [];
const serverErrors = [];
const upstream = createServer((req, res) => {
  void respond(req, res).catch(error => {
    serverErrors.push({ type: error.name, message: error.message });
    res.destroy();
  });
});
async function respond(req, res) {
  const chunks = [];
  for await (const part of req) chunks.push(part);
  const [mode, stage] = new URL(req.url, 'http://localhost').pathname.slice(1).split('/');
  const body = Buffer.concat(chunks);
  // Only presence/shape is recorded. Never copy an Authorization value to evidence.
  calls.push({ mode, stage, method: req.method, requestBytes: body.length,
    hasAuthorization: Boolean(req.headers.authorization),
    hasJsonContentType: req.headers['content-type'] === 'application/json' });
  if (mode === 'forbidden-target') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"status":200,"data":{"task_id":"FAKE-WORKERD-TASK"}}');
    return;
  }
  if (stage === 'image') {
    res.writeHead(mode === 'image-redirect' ? 302 : 200, {
      'Content-Type': 'image/png',
      ...(mode === 'image-redirect' ? { Location: '/forbidden-target' } : {}),
    });
    // The existing synthetic input exercises binary I/O. This is NOT a YouCam output.
    res.end(adult);
    return;
  }
  if (stage === 'poll') {
    res.writeHead(mode === 'status-redirect' ? 302 : 200, {
      'Content-Type': 'application/json',
      ...(mode === 'status-redirect' ? { Location: '/forbidden-target' } : {}),
    });
    res.end(JSON.stringify({ status: 200, data: { task_status: 'success', error: null,
      results: { url: 'https://yce-us.s3-accelerate.amazonaws.com/fake-result' } } }));
    return;
  }
  assert.equal(stage, 'create', 'Unexpected local fixture route');
  const input = JSON.parse(body.toString('utf8'));
  assert.equal(input.garment_category, 'outer');
  assert.equal(input.filter_multi_person, 'strict');
  assert.equal(input.change_shoes, false);
  assert.equal(new URL(input.src_file_url).pathname, '/demo/synthetic-adult.png');
  assert.equal(new URL(input.ref_file_url).pathname, '/demo/synthetic-navy-blazer.png');
  if (mode === 'reset') { req.socket.destroy(); return; }
  if (mode === 'redirect') {
    res.writeHead(302, { Location: '/forbidden-target', 'Content-Type': 'application/json' });
    res.end('{"status":200,"data":{"task_id":"FAKE-WORKERD-TASK"}}');
    return;
  }
  if (mode === 'html403') {
    res.writeHead(403, { 'Content-Type': 'text/html' });
    res.end('<html>Simulated gateway denial</html>');
    return;
  }
  if (mode === 'json400') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end('{"status":400,"error":"BadRequest","error_code":"InvalidParameters"}');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (mode === 'malformed') { res.end('not valid json'); return; }
  if (mode === 'wrongshape') { res.end('{"status":200,"data":{"id":"FAKE-ID"}}'); return; }
  // Multiple writes exercise a network-backed body reader; no mocked Response objects.
  res.write('{"status":200,');
  res.end('"data":{"task_id":"FAKE-WORKERD-TASK"}}');
}
await new Promise((resolve, reject) => {
  upstream.once('error', reject);
  upstream.listen(0, '127.0.0.1', resolve);
});
const fakeOrigin = `http://127.0.0.1:${upstream.address().port}`;

await writeFile(join(out, 'entry.mjs'), `
import { samplePreview } from './sample-preview.mjs';
export default {
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname === '/runtime') {
      return Response.json({ timeout: typeof AbortSignal.timeout,
        reader: typeof new Response('{}').body.getReader, waitUntil: typeof ctx.waitUntil });
    }
    return samplePreview(request, env, ctx, {
      fetchImpl(url, options) {
        const target = new URL(url);
        let stage;
        if (target.href === 'https://yce-api-01.makeupar.com/s2s/v2.0/task/cloth-v4') stage = 'create';
        else if (target.origin === 'https://yce-api-01.makeupar.com' && target.pathname.startsWith('/s2s/v2.0/task/cloth-v4/')) stage = 'poll';
        else if (target.origin === 'https://yce-us.s3-accelerate.amazonaws.com') stage = 'image';
        else throw new Error('Unexpected test upstream URL');
        // Native workerd fetch with every original option unchanged; only the URL is local.
        // Thus redirect:'error' regresses before HTTP and fails the real service assertions.
        return fetch(env.FAKE_ORIGIN + '/' + env.FAKE_MODE + '/' + stage, options);
      }
    });
  }
};
`);

const cases = [];
let fatal;
try {
  await build({ entryPoints: [join(out, 'entry.mjs')], outfile: join(out, 'bundle.mjs'),
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022' });
  // Supplying the bundle text also works when the evidence directory lies outside cwd.
  // Miniflare module-root inference from scriptPath can reject such relative paths.
  const bundledSource = await readFile(join(out, 'bundle.mjs'), 'utf8');
  for (const mode of ['valid', 'json400', 'html403', 'malformed', 'wrongshape', 'redirect', 'reset', 'status-redirect', 'image-redirect']) {
    const startedAt = Date.now();
    const mf = new Miniflare(convertV4MiniflareOptions({
      modules: true, script: bundledSource, compatibilityDate: '2026-09-26',
      d1Databases: { DB: `smoke-${mode}` }, r2Buckets: { FILES: `smoke-${mode}` },
      bindings: { YOUCAM_API_KEY: 'TEST-NOT-A-CREDENTIAL', FAKE_ORIGIN: fakeOrigin, FAKE_MODE: mode },
    }));
    try {
      const db = await mf.getD1Database('DB');
      for (const migration of migrations) {
        // The current generated migrations contain ordinary CREATE TABLE statements.
        // Do not use D1 exec: its newline splitting breaks multiline DDL.
        for (const statement of migration.sql.replaceAll('--> statement-breakpoint', '').split(';').map(x => x.trim()).filter(Boolean)) {
          await db.prepare(statement).run();
        }
      }
      const runtime = await (await mf.dispatchFetch('http://localhost/runtime')).json();
      assert.deepEqual(runtime, { timeout: 'function', reader: 'function', waitUntil: 'function' });
      const post = () => mf.dispatchFetch('http://localhost/api/sample-preview', {
        method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
        body: JSON.stringify({ fixture: 'navy-adult-v1' }),
      });
      const start = await post();
      assert.equal(start.status, 202);
      const initial = await start.json();
      let row = await untilRow(db, row => row && row.status !== 'creating', 'creation completion');
      const r2 = await mf.getR2Bucket('FILES');
      const taskReceipt = await r2.get('youcam-sample/navy-adult-v1-task.json');
      let output;
      if (['valid', 'status-redirect', 'image-redirect'].includes(mode)) {
        assert.equal(row.status, 'processing');
        assert.ok(taskReceipt, 'Received task must have a durable R2 receipt');
        assert.equal((await taskReceipt.json()).task_id, row.task_id);
        // Advance the local schedule without waiting ten real seconds.
        await db.prepare('UPDATE closet_sample_preview SET next_poll_at=0').run();
        await mf.dispatchFetch('http://localhost/api/sample-preview');
        row = await untilRow(db, row => row.status === 'succeeded' || row.error_code, 'poll completion');
        if (mode === 'valid') {
          assert.equal(row.status, 'succeeded');
          const image = await mf.dispatchFetch('http://localhost/api/sample-preview/image');
          assert.equal(image.status, 200);
          const imageBytes = new Uint8Array(await image.arrayBuffer());
          assert.equal(sha256(imageBytes), row.result_hash);
          assert.equal(sha256(imageBytes), fixtures.adult);
          assert.equal(image.headers.get('Content-Type'), 'image/png');
          output = { bytes: imageBytes.length, sha256: sha256(imageBytes), mime: image.headers.get('Content-Type') };
        } else {
          assert.equal(row.status, 'processing');
          assert.equal(row.error_code, 'provider_read_unavailable');
          assert.equal(row.result_key, null);
          assert.equal((await mf.dispatchFetch('http://localhost/api/sample-preview/image')).status, 404);
        }
      } else if (['json400', 'html403'].includes(mode)) {
        assert.equal(row.status, 'failed');
        assert.equal(row.error_code, mode === 'json400' ? 'provider_http_400' : 'provider_http_403');
      } else {
        assert.equal(row.status, 'creation_uncertain');
        assert.equal(row.error_code, mode === 'redirect' ? 'provider_http_302' : 'creation_confirmation_lost');
        assert.equal(row.task_id, null);
      }
      // A repeated visitor action must reuse the durable single attempt, including uncertainty.
      await Promise.all([post(), post(), mf.dispatchFetch('http://localhost/api/sample-preview')]);
      const providerCalls = calls.filter(call => call.mode === mode);
      assert.equal(providerCalls.filter(call => call.stage === 'create').length, 1);
      for (const call of providerCalls) {
        assert.equal(call.hasAuthorization, call.stage !== 'image', 'API auth must not be forwarded to storage');
        if (call.stage !== 'image') assert.equal(call.hasJsonContentType, true);
      }
      if (mode === 'status-redirect') assert.equal(providerCalls.filter(call => call.stage === 'image').length, 0);
      assert.equal(calls.filter(call => call.mode === 'forbidden-target').length, 0, 'Redirect target must never be fetched');
      cases.push({ mode, status: 'passed', runtime, httpStatus: start.status, initialStatus: initial.status,
        finalRow: row, receiptPresent: Boolean(taskReceipt), output, elapsedMs: Date.now() - startedAt });
      console.log(`PASS ${mode}`);
    } catch (error) {
      cases.push({ mode, status: 'failed', exceptionType: error.name, error: error.message });
      console.error(`FAIL ${mode}: ${error.message}`);
    } finally {
      await mf.dispose();
    }
  }
} catch (error) {
  fatal = { type: error.name, message: error.message };
} finally {
  await new Promise(resolve => upstream.close(resolve));
}

const sourceStable = (await Promise.all(sourceNames.map(async name =>
  sha256(await readFile(join(root, 'hosted', name))) === hashes[name]))).every(Boolean);
const forbiddenRequests = calls.filter(call => call.mode === 'forbidden-target').length;
const receipt = {
  at: new Date().toISOString(),
  kind: 'Actual workerd and real local D1/R2; native fetch to controlled loopback HTTP fake only; no live YouCam calls',
  hashes, fixtureHashes: fixtures, sourceStable, cases, calls, serverErrors,
  forbiddenRedirectTargetRequests: forbiddenRequests, fatal,
  limits: ['The fake image is an existing synthetic input, not a YouCam-generated output.',
    'No live authentication, credits, provider model quality or production deployment is tested.',
    'The service module is exercised; the top-level hosted routing/UI and production D1/R2 are separate checks.'],
};
await writeFile(join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
const passed = cases.filter(row => row.status === 'passed').length;
console.log(`${passed}/9 native workerd scenarios passed. Evidence: ${join(out, 'receipt.json')}`);
if (fatal || !sourceStable || serverErrors.length || cases.length !== 9 || passed !== 9 || forbiddenRequests) process.exitCode = 1;

async function untilRow(db, accept, label) {
  const deadline = Date.now() + 5000;
  let row;
  do {
    row = await db.prepare('SELECT * FROM closet_sample_preview').first();
    if (accept(row)) return row;
    await new Promise(resolve => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  throw new Error(`Timed out awaiting ${label}; last status: ${row?.status ?? 'missing'}`);
}
