# Fixed fictional YouCam demonstration

The public site offers the saved output of one successful real Clothes V4 task shared by all visitors, using the existing fictional adult and navy-blazer images. It is a bounded provider integration, separate from the local Python adapter's arbitrary-photo/consent workflow. The shared result does not preview arbitrary inventory, prove fit, or establish client benefit.

The server accepts only the fixed fixture identifier. The API key is a secret in the hosted environment and is never returned to the browser. An atomic D1 claim admits one provider creation attempt, regardless of visitor count. Uncertain creation never silently retries. A durable R2 task receipt can recover a lost D1 confirmation. Polls hold a 65-second lease and compare that lease before committing a result; stale work cannot replace a later result. Images are capped at 8MiB, must come from the documented provider storage host, pass conservative PNG/JPEG container checks, and are stored under their SHA-256 digest. The browser must also decode the output before displaying it. Container checks alone are not full pixel decoding.

The two input files are disclosed AI-generated fictional fixtures. Their hashes and the actual provider task ID, timestamps, status and output hash appear under “View generation evidence.” Later visitors see an explicitly labeled saved result and do not spend another generation credit.

User approval covers the YouCam terms, a stored server-side API credential and free-credit tests with fictional images. No personal photos are accepted by the public demo. Browser workspaces remain independent for choosing, reserving and packing; the fictional preview alone is shared. This is not an authenticated remote client/staff service.

## Verification

All 21 SQLite/fault regression assertions and 9 actual-workerd network cases pass. Independent tests first exposed a wrong provider status field, acceptance of a truncated image, an overlapping poll race and a receipt-recovery race. Those failures are preserved outside the checkout in the dated portfolio audit. Regression tests exercise actual SQLite statements with explicitly fake provider/R2 responses. Such tests are not a live inference.

The actual live result was inspected in the public browser on September 27 at 05:44 UTC: the fictional adult wears the reference navy blazer. FFmpeg and desktop/phone browsers fully decoded the 1024×1536 JPEG; its SHA-256 matches the stored provider receipt. Six public browser groups passed, including reload, a separate visitor, failed status refresh/recovery and keyboard focus, with zero generation POSTs during replay. The owner account history records exactly one Clothes V4 generation costing two free units, leaving 38 of 40. No paid credits were purchased. [Actual receipt](../artifacts/live-youcam/real-success.json), [public checks](../artifacts/live-youcam/public-receipt.json), [decoded output](../artifacts/live-youcam/real-result.jpg). No fixture image is ever substituted for failed provider output. Local arbitrary-image adapter tests remain separate from this hosted fixed-image path.

## Event timing

This integration is pre-period work made September 26/27. The YouCam submission period opens September 29. A future entry must disclose this precursor and demonstrate significant work during the eligible period.

## First live failure, retained

The first hosted attempt failed before any outbound request: workerd does not implement fetch redirect mode `error`. The fake-fetch suite had not exposed that platform mismatch. An independent actual-workerd test reproduced the error with zero loopback HTTP requests. Native fetch now uses `manual` and rejects redirects before following them. An owner-only non-generating probe confirmed successful authentication and ordinary invalid-body rejection; the account history remained unchanged. Root preserved the exact failed row in R2 and the public failure receipt, manually recovered only that exact preflight record, then generated once through the public UI. Temporary diagnostic/recovery endpoints were removed. The successful task is genuine provider output, not a substitute for the earlier failure.
