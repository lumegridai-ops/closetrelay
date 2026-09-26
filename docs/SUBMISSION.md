# Prepared submission copy — not submitted

**Project:** ClosetRelay

**Tagline:** Keep a client's clothing choice connected to the exact item held and packed.

## Inspiration

Career-clothing programs already serve remote clients with styling appointments and mailed outfits. We explored a small coordination problem inside that existing service: a client may choose a specific garment while shared stock and staff handoffs continue to change. The project joins that recorded choice, its exclusive hold, and exact-item packing evidence.

## What it does

The current local workspace lets one operator create appointment and garment records, record a specific choice, hold an available item and confirm that same item at packing. Stale approvals, competing holds, changed item records and incorrect packing IDs are refused. The non-photo route can complete the whole task.

The code includes optional YouCam Clothes V4 integration and explicit consent controls. A preview is bound to its source image, garment and current choice/consent revisions. Real live provider access and inference have not yet been verified; no synthetic image is presented as a provider response.

## How we built it

Python, SQLite, standard-library HTTP and a browser interface with no frontend framework. Inventory changes use transactions and version checks. The provider adapter uses the documented upload/task/poll/download sequence and rejects invalid or stale results. The local API key stays in server memory when entered through the UI.

## Challenges and validation

The hard part is preserving the relationship between a choice and a physical item when work happens out of order. Tests cover competing reservations, stale records, incorrect packing, repeated requests, consent withdrawal and provider failure paths. Consult the QA report for executed checks and remaining limitations. Test doubles are identified, and live success is not inferred from them.

## Limits and next work

This is one local operator workspace, not an authenticated remote service. There has been no client study, partnership, measured time saving, competitive advantage demonstration, or physical fit validation. The next meaningful work is private client/staff access, real provider validation and a fair comparison against existing inventory and remote-styling workflows.

## AI and prior-work disclosure

Codex and collaborating agents helped research, challenge, implement and test the project. Two clearly labeled fictional integration-test images were created with the built-in image-generation tool. No real client photographs or testimonials are included.

This prototype was created September 26, before the event's September 29 submission period. An eventual entry must identify significant work completed during the permitted period. Do not submit this draft as if the September 26 work were new work completed after September 29.

## Remaining submission requirements

Successful real YouCam integration, significant eligible-period updates, current requirements/declarations, accessible project/testing links, actual demo video, and verified Devpost submission status. General authorization to submit is recorded separately; it does not supply unknown personal facts.
