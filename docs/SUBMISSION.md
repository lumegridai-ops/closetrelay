# Prepared submission copy — not submitted

**Project:** ClosetRelay

**Tagline:** Keep a client's clothing choice connected to the exact item held and packed.

## Inspiration

Career-clothing programs already serve remote clients with styling appointments and mailed outfits. We explored a small coordination problem inside that existing service: a client may choose a specific garment while shared stock and staff handoffs continue to change. The project joins that recorded choice, its exclusive hold, and exact-item packing evidence.

## What it does

The current local workspace lets one operator create appointment and garment records, record a specific choice, hold an available item and confirm that same item at packing. Stale approvals, competing holds, changed item records and incorrect packing IDs are refused. Editing a held garment's condition invalidates its earlier approval and hold, requiring a fresh review before packing. The non-photo route can complete the whole task.

The custom appointment-studio interface pairs a shared garment rack with the current appointment sheet. The exact ID, staff-recorded condition, version and next action stay visible together. It includes searchable inventory, a 390px phone layout, keyboard focus and an inline wrong-item error that preserves the attempted scan. [Design rationale and primary research](../design/DESIGN_REVIEW.md).

The code includes optional YouCam Clothes V4 integration and explicit consent controls. A preview is bound to its source image, garment and current choice/consent revisions. Real live provider access and inference have not yet been verified; no synthetic image is presented as a provider response.

## How we built it

Python, SQLite, standard-library HTTP and a custom browser interface with no frontend framework. Inventory changes use transactions and version checks. Self-hosted Manrope and Instrument Serif fonts carry their bundled OFL licenses. The provider adapter uses the documented upload/task/poll/download sequence and rejects invalid or stale results. The local API key stays in server memory when entered through the UI.

## Challenges and validation

The hard part is preserving the relationship between a choice and a physical item when work happens out of order. Tests cover competing reservations, stale records, incorrect packing, repeated requests, consent withdrawal and provider failure paths. The redesigned UI passed 12 real browser checks against a fresh local SQLite workspace, including a second window trying to pack a revoked hold. Three axe scans reported zero automated violations; all retained one incomplete contrast category. This is not comprehensive accessibility certification or testing with clients. Consult the [QA report](QA.md) for executed checks, preserved failures and limitations. Test doubles are identified, and live success is not inferred from them.

## Demonstration materials

The current local demo is a 3840×2160 MP4 produced from native browser captures with Google Gemini synthetic narration and fictional records. It shows the working application's condition-revision, hold, wrong-ID rejection and exact-item packing flow. Live YouCam remains visibly disconnected; the video claims no generated provider result. [Transcript / captions](../artifacts/closetrelay-demo-4k.srt), [current recording manifest](../artifacts/widescreen-demo-manifest.json), and [release asset](https://github.com/lumegridai-ops/closetrelay/releases/download/v0.2.0-preperiod/closetrelay-demo-4k.mp4). A contest-compatible public video link still needs to be supplied and verified.

## Limits and next work

This is one local operator workspace, not an authenticated remote service. There has been no client study, partnership, measured time saving, competitive advantage demonstration, or physical fit validation. The next meaningful work is private client/staff access, real provider validation and a fair comparison against existing inventory and remote-styling workflows.

## AI and prior-work disclosure

Codex and collaborating agents helped research, challenge, implement and test the project. Two clearly labeled fictional integration-test images were created with the built-in image-generation tool. Google Gemini generated the demo's synthetic narration; it is not a real client voice or testimonial. No real client photographs or testimonials are included.

This prototype was created September 26, before the event's September 29 submission period. An eventual entry must identify significant work completed during the permitted period. Do not submit this draft as if the September 26 work were new work completed after September 29.

## Remaining submission requirements

Successful real YouCam integration, significant eligible-period updates after the September 29 start, current requirements/declarations, accessible project/testing links, a verified public demo-video link in the required format, and verified Devpost submission status. A local recorded demonstration is prepared; this does not establish video publication or submission. General authorization to submit is recorded separately; it does not supply unknown personal facts.
