# Research and challenge

Research checked September 26, 2026. These are source-backed observations and design hypotheses, not customer validation.

## A real job, with capable alternatives

[Dress for Success Brisbane](https://brisbane.dressforsuccess.org/programs/suiting/) describes remote styling and mailed clothing for clients who cannot visit. That establishes a real service. It does not establish dissatisfaction, demand for this software, or an endorsement.

[GetWardrobe Stylist Mode](https://help.getwardrobe.com/latest/stylists/client-wardrobes/) already supports shared stylist/client wardrobes and remote collaboration. [PlanStreet](https://www.planstreet.com/inventory-management) and [ThriftCart](https://thriftcart.com/) provide inventory alternatives. [YouCam's own tutorial](https://yce.perfectcorp.com/use-case/how-to-build-clothes-try-on-app) covers basic clothing preview. We inspected their primary descriptions; we did not operate those products or infer that undocumented capabilities are absent.

A generic AI outfit generator is not the proposed improvement. The bounded task is keeping a voluntary, specific item choice connected to stock that is available and then actually packed. A competent shared ledger with item IDs and a client-choice record is a serious baseline.

## Complete intended experience

A volunteer prepares a small appointment rack with original photos, item IDs, condition notes and locations. The client can review actual garments and express a preference without uploading a body photo. An optional appearance preview is shown beside the original garment. The client approves an exact item; staff create an exclusive hold and confirm the matching item ID when packing. A changed choice, unavailable item, material condition update, or released hold requires review instead of an automatic substitute.

The current application implements these mechanics for one **local operator**. It does not yet provide the private authenticated client invitation or independently authenticated staff handoff required by the intended remote experience. Selecting an appointment is not authentication or independent consent evidence.

## Sponsor role and honest limits

[YouCam Clothes V4](https://docs.perfectcorp.com/reference/ai_clothes/v4.0/paths/~1s2s~1v2.0~1task~1cloth-v4/post) supports an outerwear preview from a source image and one garment reference. The adapter implements the documented upload, generation, polling, and result path. A missing key or failed request cannot produce a substitute image. Source and garment hashes plus current choice/consent revisions bind a result to its request.

The provider's image guidance has differed between upper-body and full-body descriptions. Real input compatibility must be tested. A generated image cannot measure fit, fabric comfort, garment condition, disability accommodation, or employment suitability. The workflow assigns no appearance or employability score and preserves a complete non-photo route.

## What the tests prove

The earlier SQLite experiment used 12 predefined cases and four independently frozen holdouts, including 20 release/packing races. It found and preserved a stale duplicate-result defect before the fix. Those records are retained in the parent hackathon workspace. This application adds a real HTTP boundary, persistent storage, upload/consent controls and an offline-contract-tested provider adapter. The separate QA report records the actual new runs.

These tests concern allocation, provenance, concurrency and failure handling. They are not a user study, competitor benchmark, live inference result, or performance guarantee.

## A fair next comparison

Use the same appointment catalog, item IDs and scripted changes for ClosetRelay and a well-designed shared stock ledger plus client-choice record. Permit the baseline to be correct. Count catalog setup, record edits, repeated data entry and context switches. Agent-run operation counts must not be described as human task time or productivity.

After real provider access is verified, consenting adults and representative volunteers would compare original-photo selection with optional previews in balanced order. Record completion, correction requests, setup work and opt-outs. Qualified human feedback is required; none has been collected or invented.

## Reasons to stop or change direction

- Catalog preparation costs more work than the workflow saves.
- Clients prefer static photos or a video appointment and find previews unnecessary.
- Existing styling and inventory tools complete the same job conveniently.
- Provider pose requirements exclude intended users or distort garment details.
- Real staff cannot maintain accurate availability.

The idea is a defensible experiment, not an established winning entry. Its contest case becomes materially weaker if the optional sponsor feature adds little value.
