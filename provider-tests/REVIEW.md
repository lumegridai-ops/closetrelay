# Independent provider/application review

Review date: September 26, 2026. All fixtures and credentials in these tests are invented. No live YouCam operation or account access was performed by this reviewer.

## Adapter evidence

The adapter's 31 offline tests passed, followed by five native urllib tests against a temporary loopback server. These establish the exercised request sequence and failure handling, not live integration. The native tests cover redirect refusal, bounded declared and streamed bodies, incomplete Content-Length responses, HTTP error preservation and ordinary response handling.

## Preserved application failures before fixes

The first independent application run executed nine unchanged assertions: **five failed, four passed**. Evidence is retained in `evidence/backend-review-before/`, including both implementation files, the exact test file, SHA-256 hashes and full failure output. The original test hash is `846a0daf94b6d273fe034820c96a9c1a61b663382a29a1364ff39639d6072fea`.

| Failed case | Observed behavior | Required correction |
|---|---|---|
| Choice changes before task snapshot | Binding named jacket B while previously read jacket A bytes were uploaded | Load images from the exact atomic preview snapshot, or reject before upload |
| Source changes before task snapshot | New consent/source revision accompanied old source bytes | Bind source bytes to the snapshot rather than an earlier application read |
| Repeated pending request | Two identical requests created two separate provider jobs | Coalesce/idempotently reject current equivalent work before billable creation |
| Key cleared during creation | Old provider task was still returned as pending after key removal | Track configuration generation and invalidate pending work on clear/switch |
| Key replaced during polling | Old provider's in-flight output became displayable after the replacement | Guard configuration generation and serialize final commit with configuration changes |

The four passing cases established that a prior successful image became unservable after a choice change, consent withdrawal removed current local source/output access, a failed provider result did not display the synthetic fixture, and a dummy key was absent from returned state and database files. The persistence check used only a temporary test database; it did not search the user's files or environment for credentials.

These tests exercise deterministic interleavings at actual application method boundaries, using a deliberately fake provider. They do not claim the fake output came from YouCam. The source/reference race assertions inspect bytes actually passed into the adapter boundary, not only what a page label says.

## Other implementation concerns sent to owners

- Memory-only configuration must not silently restore an ambient environment key at restart after the operator cleared the connection. No actual environment credentials were inspected.
- Manual-only refresh does not satisfy the intended regular task polling. The app needs bounded scheduling based on `next_poll_at`, and must state any foreground-only/restart limitations.
- A binding check alone does not make final storage atomic. Application commit must compare the same current revisions and configuration generation while committing, and every subsequent image read must recheck eligibility.
- No live quality, pose/framing, provider-host, billing, cancellation, secure-erasure or customer-value claim follows from these tests.

## Additional preserved failures and post-fix result

Three additional checks were kept separate from the original nine. On their first run, two failed: a genuine engine failure was mislabeled `stale` and lost its saved task data; default application startup implicitly loaded a synthetic environment key despite the memory-only flow. Coalescing across two application instances sharing SQLite passed. This second source/test/output snapshot is in `evidence/backend-review-additional-before/`. These were observed application defects, not fixture or test-runner errors.

The backend owner fixed the snapshot ordering, equivalent-task coalescing, configuration generation/commit coordination, error provenance, and ambient credential loading. **The original nine assertions and the three additional assertions then passed without edits to those tests.** Four further deterministic scheduler tests passed: future `next_poll_at` suppresses work; no key suppresses work; a stale choice is discarded before provider calls; and a pending outcome's new schedule/count persists without creating another task.

The first post-fix archive contains 52 passing checks. A final shutdown guard then added one further independent assertion: a stopped worker cannot start new provider work. Final archived run: **53 tests passed, zero failures/errors**, comprising 31 adapter contract cases, 5 native loopback transport cases, 12 application regression cases and 5 scheduler/shutdown cases. `evidence/backend-review-final/` contains the exact implementation/test copies, hashes, complete output and machine-readable result; the earlier `backend-review-after/` is retained. Hashes were checked before/after the final run; the code did not change during execution. The original frozen test hash still matches `846a0daf94b6d273fe034820c96a9c1a61b663382a29a1364ff39639d6072fea`.

Default server startup now loads **no ambient API key**. The application accepts an explicitly entered key through its local password field and keeps the adapter in process memory. There is no environment CLI mode in this version. Clearing/replacing the key invalidates pending local previews; this cannot cancel an upstream request already in flight.

The gate supported by this review is a local, single-operator application with offline-tested provider integration boundaries. **Live YouCam integration remains UNVERIFIED.** The review does not establish deployed security, real image quality, provider availability/billing or customer benefit.
