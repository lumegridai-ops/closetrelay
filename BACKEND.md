# ClosetRelay local application backend

The backend runs a real HTTP server over a persistent SQLite database. One local operator can manage item cards, appointments, revision-bound choices, exclusive holds and exact-item packing records. The initial catalog is explicitly fictional and contains no photographs. This is not an authenticated multi-user service and must not be exposed publicly.

The mechanism was adapted from the preserved, independently reviewed experiment at `../experiments/closetrelay/`. That evidence was not modified. The application adds HTTP validation, item/appointment creation, optimistic revision checks, persistent image storage and a guarded real-provider integration boundary. Choosing, holding, releasing and packing still use the tested SQLite transactions and constraints.

## Run

From the repository root, using Python 3.12 or later:

```sh
python3 -B -m backend.server --port 4323 --database backend/data/closetrelay.sqlite3
```

Open `http://127.0.0.1:4323`. Assets come from `ui/`; use `--ui-directory` to select another local asset directory. The server always binds `127.0.0.1`; there is no public-bind option. A fresh database is seeded once with four invented garment cards and two fictional appointments. Restarting preserves changes and never resets or reseeds existing records. `--empty` starts a fresh database without examples. For isolated QA, use another database and port; there is no destructive reset endpoint.

Only Python's standard library is required. The author and final integration checks used Python 3.12.14; the root browser check also ran on Python 3.13.5. The backend imports the sibling `provider/` adapter. A missing adapter disables previews while the non-photo workflow remains usable.

## JSON API

Requests and responses use `snake_case`. Mutations require `Content-Type: application/json`, including `{}` for actions without arguments. Unknown fields, invalid field types, duplicate JSON keys and non-finite numbers are rejected. Identifiers are 1–80 letters, digits, hyphens or underscores, starting with a letter or digit. HTTP errors have the shape `{"error":{"code":"…","message":"…","details":{…}}}`; `details` is optional.

| Method and path | Body / result |
| --- | --- |
| `GET /api/health` | Server mode, provider capability and time. Configuration is not evidence of successful provider access. |
| `GET /api/state` | `items`, `appointments`, parsed `audit`, `provider`, `scope` and `server_time`. This is the local operator's whole workspace. |
| `GET /api/items` | `{items:[…]}`. Item fields: `id`, `label`, `photo_ref`, `location`, `condition`, `version`, `state`, `owner`, `is_demo`. Blank photo references are returned as null. |
| `POST /api/items` | `{id,label,location,condition}` → created item, HTTP 201. No photograph is fabricated. |
| `PATCH /api/items/{id}` | `{expected_version,condition?,unavailable?,photo_id?}` → changed item. At least one change is required. A stale version returns 409. Omitting `unavailable` preserves existing unavailability. Material edits retire existing approval/hold eligibility. |
| `GET /api/appointments` | `{appointments:[…]}`. |
| `POST /api/appointments` | `{name}` → new appointment, HTTP 201. |
| `GET /api/appointments/{id}` | Current approval, `choice_revision`, consent metadata, `active_holds`, `handoffs`, `previews`, and `unresolved_reason`. |
| `POST /api/appointments/{id}/choice` | `{item_id,expected_version,expected_choice_revision}` → new approval, HTTP 201. Stale browser choice or item revisions return 409. |
| `POST /api/appointments/{id}/hold` | `{approval_id}` → exclusive hold. Competing allocation returns 409; no silent substitution. |
| `POST /api/holds/{id}/release` | `{}` → releases an active hold and retires its approval. Reallocation requires fresh choice. |
| `POST /api/holds/{id}/pack` | `{item_id,request_key}` → handoff. The exact held item must match. Repeated confirmations return the same handoff; the request key cannot belong to another hold. |
| `GET /api/appointments/{id}/manifest` | Array of `hold_id`, `appointment_id`, `approval_id`, `item_id`, `item_version`, `label`, `photo_ref`, `location`, `condition`. |
| `GET /api/audit` | `{events:[{sequence,kind,target,payload}]}`. `payload` is parsed JSON; source photos, outputs and API keys are not audit payloads. |
| `POST /api/uploads` | `{purpose,mime_type,data_base64,appointment_id?}` → `{id,url,purpose,mime_type,sha256,bytes}`, HTTP 201. `purpose` is `source` or `garment`; source uploads require an existing appointment ID. |
| `GET /media/{id}` | Local uploaded/generated image bytes. Only controlled IDs, not file paths or arbitrary remote URLs. A stale generated result is unservable. |
| `POST /api/appointments/{id}/consent` | `{consent:true,source_id}` binds a source upload belonging to that appointment. `{consent:false}` removes local personal image rows/reference access and invalidates previews. This is an operator-recorded decision, not verified client identity or legal consent capture. |
| `POST /api/provider/configure` | `{api_key:"…"}` connects a key in process memory; `{api_key:null}` clears it. Returns capability and `storage:"process_memory_only"`, never the key. |
| `POST /api/appointments/{id}/previews` | `{}` or `{retry_of}` → locally tracked real-provider request, HTTP 201. No key returns 503 before task creation or network work. Repeated starts for the exact same pending/usable binding reuse the existing task. |
| `GET /api/previews/{id}` | Current local status and real task provenance; no external request. |
| `POST /api/previews/{id}/refresh` | `{}` requests a bounded status check. The adapter suppresses early polling; the background worker also polls without a browser being open. |

Successful choice records include `id`, `appointment_id`, `item_id`, `item_version`, `choice_revision`, `state` and historical `item_snapshot` (a JSON string). Holds include `id`, `appointment_id`, `item_id`, `approval_id`, `item_version`, `state`. Handoffs include `id`, `appointment_id`, `item_id`, `approval_id`, `hold_id`, `item_version`, `request_key`.

Preview records include `id`, `appointment_id`, `status`, `displayable`, `result_url`, `reason`, item/choice/source/consent revisions, and provider metadata. Status is `pending`, `succeeded`, `failed`, `timed_out`, `discarded` or `revoked`. Render a result only when `displayable` is true and `result_url` is the returned `/media/…` path. Provider metadata includes the actual provider task ID, timestamps, safe error codes and persisted polling schedule. A handoff records an operator's packing confirmation; it is not proof of shipment or delivery.

Typical error statuses: 400 invalid input; 403 rejected local-origin boundary or action prerequisite; 404 missing resource; 409 stale/conflicting state; 413 oversized upload; 415 wrong content type; 502 provider failure; 503 disabled provider or unavailable storage.

## Real-provider boundary

Keys enter through the password control and same-origin JSON endpoint. The default application never reads an ambient environment key. Keys are not written to the database, files, logs, browser storage by this backend, responses or audit. Clearing a key or restarting the process removes this connection; a key's presence does not verify its account, credits or API access.

The adapter accepts actual uploaded image bytes. The server takes an atomic local preview snapshot first, then retrieves the exact source and garment references from that snapshot. It never pairs pre-snapshot image bytes with a newer binding. The binding carries appointment, item, choice, image and consent revisions; `client_id` is the local appointment identifier, not a claimed authenticated identity. Every item-photo edit increments the item version, which is also the item-photo revision in this model.

No-key mode cannot create a provider task. There is no HTTP endpoint for fake completion, and fictional cards contain no placeholder provider output. Successful output storage receives bytes from the adapter and rechecks the binding inside the SQLite write transaction. Changed choices, item cards or consent make old results undisplayable. Key changes also invalidate pending local requests; provider-generation checks and serialized final commits prevent an old in-flight result from publishing after a key switch.

The server's background thread checks scheduling every 0.5 seconds, but external reads obey each persisted `next_poll_at`; the adapter uses 10-second intervals, a 10-minute application deadline and its bounded status-read limit. It does not automatically retry billable task creation. Creation uncertainty is recorded and shown as an error. Clearing the key, invalidating the binding, or stopping the server prevents further valid publication. Shutdown stops scheduling and invalidates pending local tasks; an already in-flight HTTP operation may finish during its bounded transport timeout. These are local-process semantics, not a production scheduler or an upstream cancellation guarantee.

Image uploads are capped at 8 MiB and accept JPEG/PNG only. The provider's container checks enforce supported dimensions (at least 512×384 by long/short side, no side over 4096). They are not pose, garment-fidelity, image-content, fit or consent validation.

## Local data and scope

Images are stored as SQLite blobs, with opaque `/media/…` IDs. The default/new private database directory is mode 0700, and the database and SQLite WAL/SHM files are mode 0600. An unrelated existing parent directory is not chmodded. The database is not encrypted by this application. Keep it and its sidecars out of publication and source control.

Consent withdrawal deletes the corresponding local personal media rows and disables result access; it does not certify forensic erasure from backups, filesystem history or a provider. Upstream retention, cancellation and deletion remain unimplemented and unverified. Uploaded but unused garment media have no automatic retention cleanup in this prototype.

The loopback server checks Host and Origin, serves no permissive CORS headers, limits accepted request formats and serves static files only below `ui/`. These checks reduce accidental browser exposure; they do not implement login, sessions, authenticated clients, multi-user authorization or protection from other processes on this computer. The operator can control every appointment. Do not deploy this server to an internet-facing host.

## Verification actually performed

The backend author ran 17 real HTTP/SQLite tests under bundled Python 3.12.14. They cover persistence across restart, competing allocations, wrong-item refusal, concurrent repeated packing, stale browser/item revisions, release/reapproval, request boundaries, image persistence/withdrawal, memory-only key handling, file permissions, no-key behavior and worker shutdown. Adapter contract fixtures are explicitly offline test doubles, never asserted to be YouCam results. Output is preserved under `backend-tests/results/`.

An independent reviewer preserved five initial failing preview regressions before fixes: mismatched source/reference snapshots, duplicate starts and key-switch races. Two later failures exposed incorrectly labeled failed-task provenance and restoration of an ambient environment key. All seven were fixed without changing those regression expectations. The final independent suite passed 53 checks, including adapter/transport cases and 17 backend/scheduler review checks; source hashes stayed unchanged during that run. Evidence lives under `provider-tests/evidence/backend-review-final/`, with the earlier failures retained separately. No original experiment evidence was edited to make this application pass.

Run the backend suite:

```sh
python3 -B -m unittest discover -s backend-tests -p 'test_*.py' -v
```

This backend work did not perform live YouCam inference, test real beneficiary photographs, verify external deletion, recruit users or measure advantage over a competent shared ledger. The root task separately tracks any later live-provider evidence. The tested local flow is not itself proof of contest readiness or customer value.
