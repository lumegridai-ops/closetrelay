# OpenAI Sites demonstration

The public hosted demonstration preserves the actual Python business rules. Pyodide 314.0.7 runs the unchanged `backend/model.py` and `Application.dispatch` in a browser WebWorker. The interface has the Source Sans 3 refinement described in [the typography review](../design/typography/README.md).

This is an isolated fictional demonstration, not authenticated production access for clients and staff. Roles remain workflow steps controlled by one visitor. Photo uploads and provider key configuration are disabled; no YouCam output is fabricated. The Python local application retains its full upload and provider-adapter implementation.

## Persistent workspaces

OpenAI Sites serves the actual interface, workflow source and Worker endpoints. A 256-bit random HttpOnly/Secure/SameSite=Lax cookie identifies each browser; only its digest scopes the server metadata. D1 stores the current revision and private R2 object pointer. R2 stores the SQLite snapshot. Every successful mutation must persist a new snapshot before the interface reports success.

Each request first checks the saved revision. Concurrent writes compare revisions atomically; a losing tab reloads current state. The browser computes inventory transitions; the server stores isolated opaque snapshots and does not independently validate each inventory action. This design is appropriate for the fictional demo and is not a production multi-operator authorization system.

Clearing cookies or moving to a different browser loses access to that browser's workspace. The cookie lasts 30 days; that is not a promise that server rows are automatically deleted at cookie expiry. Snapshots are capped at 2MB. Personal photo uploads, provider credentials and live API operations are not accepted by this hosted demonstration.

The pinned Python runtime downloads from the official Pyodide distribution on jsDelivr. Its first load may take about 15 seconds on the measured connection; later observed checks took about 2–5 seconds. The interface shows loading and retry states. It does not claim offline startup or universal load performance.

## Verification

The existing Python tests remain evidence about the local application. Separate hosted tests establish the new path:

- The feasibility probe ran unchanged Python and real SQLite in Chrome: 20 checks covered holds, conflicts, invalidation, packing, idempotency, provider rejection and reopening/restoring database bytes.
- The local hosted run used actual workerd, D1 and R2 bindings plus Chrome/Pyodide. Nine check groups covered the complete UI/engine/storage flow, reload persistence, visitor isolation, provider rejection, phone layout and a deliberately lost save response. [Receipt](../design/hosted-qa/local/receipt.json).
- Independent source review found and helped fix ambiguous D1 commit cleanup, browser engine failure recovery, uncertain save messaging and an unbounded Worker restart loop. Fault doubles tested each failure; these were not presented as production outages.
- A SameSite=Lax cookie retains access when returning through an external link. Mutation endpoints still reject a foreign Origin. An unknown object path cannot retrieve private snapshots.

Actual public deployment checks are recorded separately after publication. The existing 4K film is a truthful recording of the earlier local UI; it does not depict this hosting implementation or the final font refinement.

## Reproduce

```sh
npm ci
npm run build
node tools/preview-site.mjs
```

Then run `CLOSET_QA_FAULTS=1 node tools/check-hosted.mjs` against port 4327. The failure injection intentionally loses a confirmation after a real saved write; it verifies that the interface reports uncertainty and reloads the record without duplicating it. Without that flag, no network fault is injected.

See [Pyodide WebWorkers](https://pyodide.org/en/stable/usage/webworker.html) and [MDN's module-worker policy guidance](https://developer.mozilla.org/en-US/docs/Web/API/Worker/Worker). Module imports require their pinned origin in `worker-src`; WebAssembly is permitted with `wasm-unsafe-eval`, without general JavaScript `unsafe-eval`.
