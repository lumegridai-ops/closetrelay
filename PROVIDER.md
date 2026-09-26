# Clothes V4 provider adapter

**Live integration: UNVERIFIED.** This adapter implements the published contract and has offline tests. No live key was read, no inference request was made, and no API credits were consumed during its implementation. Synthetic test responses are not provider integration evidence.

## Runtime and interface

Python 3.12 standard library only. No framework, SDK or third-party runtime dependency. Imports work with the `closetrelay` directory on Python's import path. The adapter never reads environment variables, files containing keys, accounts or browser sessions. The application injects the key explicitly on the server; it must not return or log the adapter's private state. Current application startup uses no ambient environment key: start `python3 -m backend.server --port 4323`, then use the local **Connect YouCam** password field. There is no environment CLI mode in this version.

```python
from provider import ImageInput, PreviewBinding, ProviderTask, YouCamClothesV4

client = YouCamClothesV4(api_key=key_supplied_by_application)
# client.configured says only that a nonempty key was supplied, not that it works.
binding = PreviewBinding(
    appointment_id="appointment-1", client_id="appointment-1",
    choice_revision=1, item_id="jacket-1", item_revision=1,
    item_photo_revision=1, source_photo_revision=1, consent_revision=1,
)
task = client.create_preview(
    source=ImageInput(source_bytes, "image/png"),
    reference=ImageInput(jacket_bytes, "image/png"),
    binding=binding, check_current=database_binding_check,
)
# Persist task.as_dict() in a private server record; never accept it from a browser.
# Schedule this after task.next_poll_at, which is Unix time in seconds.
outcome = client.poll_preview(task, check_current=database_binding_check)
# Persist outcome.task.as_dict() after EVERY poll, including pending/error results.
# Rehydrate only a trusted saved record with ProviderTask.from_dict(saved_record).
```

`ProviderBinding` is an alias for `PreviewBinding`. Both binding and task have strict `as_dict` / `from_dict` round trips. `PreviewOutcome.status` is `pending`, `succeeded` or `failed`. A succeeded outcome contains `output.data` (actual downloaded bytes), `mime_type`, `sha256`, `width` and `height`. Task metadata includes the exact binding and SHA-256 of both uploaded inputs. A result is an appearance illustration; it says nothing about stock, physical fit, size, fabric, condition, or client approval.

`ProviderError` has controlled `code`, `stage`, `http_status`, `retryable`, `retry_after_seconds`, `creation_uncertain` and `task_id` fields. `as_dict()` omits raw upstream text, URLs and credentials. `MissingConfiguration` is a `ProviderError` with `code=provider_unconfigured`; no request is made. Empty/malformed keys are configuration errors, not attempted credentials. A valid-looking injected key is not proof of available credit or authorization.

## Exact request sequence

1. Require current consent and exact binding. Check both image containers before network access.
2. For each input separately, authenticated `POST https://yce-api-01.makeupar.com/s2s/v2.0/file` with one `files` entry containing `content_type`, generic `file_name` and exact byte `file_size`.
3. Validate the returned file identity and a single PUT instruction. Upload the actual bytes to its HTTPS storage URL with the specified content type, exact length and optional Amazon signing headers. **The API bearer key is never sent to storage.** Input file IDs can contain `/`, `+` and `=` as the official examples do.
4. Authenticated `POST /s2s/v2.0/task/cloth-v4` with `src_file_id`, `ref_file_id`, `garment_category: "outer"`, `change_shoes: false`, and `filter_multi_person: "strict"`. This deliberately implements the single-jacket MVP. The category is `outer`, not `outerwear`. The strict filter is a provider option, not a local assertion about image contents.
5. Retain the real task ID. Authenticated `GET /s2s/v2.0/task/cloth-v4/{task_id}` at ten-second intervals. The documented states are `running`, `success` and `error`; unknown/contradictory states fail closed.
6. On success only, validate `data.results.url`, download the actual image without the API key, check its container and type, recheck the binding and return the bytes. No public signed URL is returned in the application result. The application decides whether it may store and serve those bytes.

Sources verified September 26, 2026: [Clothes overview and worked flow](https://docs.perfectcorp.com/reference/ai_clothes/section/overview), [V4 operation](https://docs.perfectcorp.com/reference/ai_clothes/v4.0/paths/~1s2s~1v2.0~1task~1cloth-v4/post), [Clothes OpenAPI](https://docs.perfectcorp.com/_bundle/reference/ai_clothes.json?download=), [File operation](https://docs.perfectcorp.com/reference/file/paths/~1s2s~1v2.0~1file/post), [File OpenAPI](https://docs.perfectcorp.com/_bundle/reference/file.json?download=), [authentication and polling FAQ](https://docs.perfectcorp.com/develop/faq).

The official OpenAPI has malformed schema composition for response `data/results`, so this code follows its concrete worked response and documented status enum rather than pretending a generated schema client was validated. The fetched examples have differing string/integer `Content-Length`; both are accepted only when equal to the actual bytes.

## Consent, revisions and application responsibilities

`check_current(binding)` must return literal `True` only when the authenticated actor is authorized, photo processing consent remains active, all revisions match, and the item/choice is still eligible. Exceptions and truthy substitutes fail closed. Checks happen before each upload/task/status/download action and after each potentially stale response. They do not stop an HTTP request already in flight.

The backend must serialize duplicate preview starts, persist creation state before external work, and use a transactional compare-and-commit before making returned bytes visible. It must also check the binding on **every later image read**, not merely on job completion. An adapter check followed by a database write has a race unless the application validates again in the committing transaction. Bytes may not be shown just because a task previously succeeded. A key change must not cause an old in-flight result to be committed under the new provider configuration.

Local consent revocation stops subsequent adapter work and display. This adapter has no invented provider cancellation/deletion endpoint. Already transmitted data or a running task may remain at the provider; charges may already have occurred. The current [API privacy policy](https://www.perfectcorp.com/perfectbeauty/youcam/privacy-policy-api) describes generally 30-day retention and exceptions. Local reference removal is not guaranteed erasure of provider data, filesystem backups or process memory. The app must explain that distinction and retain its complete non-photo workflow.

## Failure and security boundaries

- API host and paths are fixed. Upload/result hosts default to the specific documented `yce-us.s3-accelerate.amazonaws.com`. Redirects, HTTP, credentials in URLs, fragments, nonstandard ports, arbitrary hosts and upload authorization/cookie headers are rejected. If a live account returns a different legitimate host, verify it independently and add the exact hostname through trusted server configuration; never allow browser-supplied hosts or a broad wildcard.
- Native transport uses certificate-verified TLS, disables ambient proxies/cookies and follows no redirects. Response bodies and JSON size are bounded. Per-I/O timeouts plus elapsed read checks are enforced; this is not a hard real-time cancellation guarantee for a blocked operating-system call. Results arriving beyond the task deadline are not published.
- Each preview has a local ten-minute budget and at most sixty status reads. These are application limits, not a claimed provider service guarantee. Early polls return pending without network. The caller must persist the updated schedule/count; a restarted worker must not reset it.
- Transient read-only GET network/429/502/503/504 errors return pending with bounded delay; remaining deadline still applies. Other malformed or terminal responses return failed. Engine error messages are not copied into UI text. Failed/unknown results have no substitute image.
- **No POST or PUT is automatically retried.** A create timeout, malformed create success or upstream 5xx can mean the task was created despite the missing acknowledgement. `creation_uncertain=True` requires explicit reconciliation; silently creating a new job could duplicate charges. A returned known task ID is retained on a subsequent binding/deadline failure. There is no documented idempotency key used here and no exactly-once provider claim.
- Input bytes are immutable and limited to less than 10,000,000 bytes, JPEG/PNG containers, long/short sides at least 512/384 and maximum side 4096. Output bounds are similarly conservative. PNG checks include chunk framing/CRC; JPEG checks include frame and scan framing. These are **container checks, not full raster decoding**, pose recognition, consent detection, malware certification or image-quality QA. The app should decode/re-encode trusted uploads, normalize orientation and remove unnecessary metadata before provider upload. This adapter forwards the supplied bytes unchanged, including any metadata.

The official overview inconsistently asks for full-body images in its walkthrough and chest-up images in the file-spec section. It also shows a minimum-size error example inconsistent with the recommended minimum. Actual jacket framing/pose and output quality must be tested with authorized imagery before promising a supported capture flow.

## Verification and remaining gate

Run only offline tests:

```sh
cd closetrelay
python3 -m unittest discover -s provider-tests -v
```

Tests use invented task IDs, a dummy key, solid-color PNGs and explicitly synthetic provider responses. Native transport tests contact a temporary loopback server only. They exercise the real upload/create/status/download shapes, credential isolation, strict response handling, stale/revoked bindings at asynchronous boundaries, deadlines, backoff, task persistence, unsafe destinations and uncertain creation. They do not measure provider quality, API availability, usage cost, customer value or winner likelihood.

The final offline run passed 53 tests: 36 adapter/native-transport checks and 17 independent application/scheduler/shutdown checks. Seven observed integration failures were preserved before fixes; the unchanged regressions pass afterward. See `provider-tests/REVIEW.md` and its hashed before/after evidence. Passing a synthetic provider response is never reported as a successful YouCam call.

Before a real integration claim, an authorized operator must obtain a usable key and credit, run the actual V4 flow on consented/appropriately licensed material, retain real task/timing/input-output evidence privately, inspect the returned output, and verify the app's stale-result and revocation behavior. Provider terms/account eligibility, real quotas/hosts, image framing, output quality and deployment security remain separate gates. A test script or prepared adapter is not a contest submission.
