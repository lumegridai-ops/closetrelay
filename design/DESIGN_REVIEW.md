# ClosetRelay appointment studio

Completed September 26, 2026 in the operator's local timezone. Browser evidence includes its actual UTC timestamps. This report supersedes the presentation section of `UI.md`; provider and backend readiness are unchanged.

## What changed

The interface now looks and behaves like a shared appointment sheet beside a clothing rack. It uses warm paper surfaces, charcoal actions, a restrained saffron selection accent, and self-hosted Manrope and Instrument Serif. Garments receive substantially more visual space. The composition has a small appointment navigation, a flat three-step handoff strip, a browsable rack, and an appointment sheet with one main action for the current state. It does not add charts, invented activity metrics, testimonials, or a generic admin dashboard.

The appointment sheet keeps the exact item ID, location, current version, staff-recorded condition and available action together. ID/state/condition/approval text and primary action labels are at least 14 CSS pixels at the tested 1280-pixel desktop viewport. A client choice, staff hold and packing confirmation are distinct steps. These labels describe the workflow; the supporting workspace disclosure still explains that this is one local operator, with no separate authenticated client or staff accounts.

The rack can be searched by name, ID, location or condition. A search with no matches has a clear recovery action and does not silently choose another item. At 390 pixels, the appointment navigation becomes a horizontal row, the rack stays in two columns, and the appointment sheet follows it. A bottom “Review item” shortcut focuses and scrolls to the selected item. It disappears when that sheet is visible.

Wrong-item packing now retains the entered ID, associates the real error with the field using `aria-describedby`, marks it invalid, and moves focus to correction. The backend's actual error remains visible next to the input. A stale hold that disappears on refresh instead gets the real stale-decision explanation and the fresh-review action. Messages do not direct the user back to a form that no longer exists.

The optional YouCam area remains secondary. No provider result is fabricated, and a configured key is explicitly not proof of a successful request. The complete approval/hold/packing path remains usable without a personal photo. Sample appointments, schematic garments and uploaded sample test images retain their fictional labeling.

## Research that informed the decisions

These are design inputs and product hypotheses, not customer validation or proof of impact.

| Primary source | Relevant evidence | Design implication used here |
| --- | --- | --- |
| [Dress for Success Brisbane / Suited to Success: suiting](https://brisbane.dressforsuccess.org/programs/suiting/) | Describes individual styling and remote support, including video styling or parcels for people unable to attend in person. | Keep the appointment and a person's actual garment choice central; do not make a personal photo mandatory. The present prototype does not claim to run that organization's service. |
| [GetWardrobe: client wardrobes](https://help.getwardrobe.com/latest/stylists/client-wardrobes/) | Describes a stylist and client working with a shared wardrobe. | Make the selected garment and appointment context persistent. A shared wardrobe is an existing product pattern, not a novel invention claimed by ClosetRelay. |
| [GOV.UK Design System: buttons](https://design-system.service.gov.uk/components/button/) | Recommends clear action labels and avoiding competing primary actions. | Give the next commitment one primary button, while keeping edit, release and evidence actions subordinate. |
| [GOV.UK: error messages](https://design-system.service.gov.uk/components/error-message/) and [error summaries](https://design-system.service.gov.uk/components/error-summary/) | Describe actionable field errors and an accessible way to find them. | Preserve the attempted scan, explain the actual failure beside it, associate the error with the field, and move focus to recovery. |
| [W3C: WCAG 2.2 target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) | Describes the minimum 24×24 CSS-pixel target and spacing exceptions. | Use native controls, visible focus, and larger primary/touch actions. This is not a claim of complete WCAG conformance. |
| [Google Fonts Manrope](https://github.com/google/fonts/tree/main/ofl/manrope) and [Instrument Serif](https://github.com/google/fonts/tree/main/ofl/instrumentserif) | Public font sources and OFL licenses. | Serve fonts locally with no font-service request from the app. Exact URLs, hashes and bundled licenses are saved. |

The Apple sidebar page was attempted during research but returned a JavaScript-required page to the reader. No design claim is attributed to uninspected content.

## Actual verification

`design/verify-ui.mjs` starts the real Python server on isolated port 4384 with a fresh SQLite database. It performs browser actions against the real endpoints. App state and request failures are not mocked. All names, inventory, conditions and approvals in this run are invented QA fixtures. It creates no account, key, provider call, real personal photograph, delivery or customer approval.

The final complete run is `design/evidence/run-07-final/results.json`. It records source hashes, the temporary database path, timestamps and the checks actually performed.

| Check | Observed result |
| --- | --- |
| Initial desktop load | Four seeded fictional garments, real appointment state, disabled no-key preview, no horizontal overflow at 1440 pixels. |
| Search recovery | No-match search showed recovery; “Show all items” restored the rack without changing the selected garment. |
| Keyboard entry and dialogs | First Tab reached the skip link; Enter focused the main region. Escape closed the appointment dialog and returned focus to its trigger. |
| Approval → hold → scan focus | Approval placed keyboard focus on the hold action; Enter created the real hold and focused the scan field. |
| Competing hold | Two windows approved the same item before holding. A's hold succeeded; B's stale hold was rejected. A retained ownership and B had no active hold. |
| Condition update | Editing the held jacket created item version 2. Its old approval became inactive, its old hold disappeared, and the scan form was replaced with fresh review. |
| Stale packing window | A second window retaining the old scan form could not pack the revoked hold. The updated UI showed the real changed-approval explanation and removed the obsolete form. |
| Wrong-item scan | A freshly approved/held version-2 jacket refused `DEMO-JKT-02`. The hold remained, no handoff was created, the typed value remained, and the actual error was associated with the focused field. |
| Desktop readability | At 1280×720, measured DOM bounds place the current condition and inline error on screen together. The expected ID, hold/version state, entered value and correction action are also visible in the captured image. Computed critical font sizes are at least 14px. |
| Correct packing and persistence | Entering `DEMO-JKT-01` on the phone layout recorded exactly one handoff for version 2. Reload showed the same packed item and record. |
| Packed inventory | Another appointment could view the packed jacket but could not approve it. |
| Phone layout | 390×844 had no horizontal overflow. The review shortcut focused the selected sheet and disappeared while the sheet was visible. Wrong-input, packed and record-dialog screens were captured. |
| Provider truth | Preview stayed disabled. The key field was password type and empty; local/session storage were empty. No key was entered or provider request made. |
| Browser errors | No uncaught JavaScript page errors in the complete workflow. |
| Automated accessibility | Axe-core 4.12.1, WCAG 2 A/AA, 2.1 AA and 2.2 AA tagged checks: zero violations in desktop, phone and phone-error scans. Each has one incomplete contrast category requiring manual interpretation. |

The screenshots were visually inspected. Automated checks and sampled keyboard actions are not screen-reader testing, user research, full WCAG certification, physical barcode-scanner testing, a live YouCam test, or evidence that this concept will win a competition.

## Preserved failures and fixes

- The previous rendering rebuilt the scan field after mutations. Code review showed that it did not preserve a mistyped ID, and its global error could be far from the packing action. The redesign stores the entered value for the current hold and supplies a field-associated correction. This new behavior was exercised in the final real browser run.
- The new inline-error recovery initially had a specific flaw: when another window changed the item and removed the hold, the global text still suggested the now-removed packing form. `run-06-stale-recovery` preserves the actual failing assertion, screenshot, server response and source hashes. The UI now refreshes first and uses the real stale-decision message if the form disappeared. The same condition passes in `run-07-final`.
- Runs 01–03 stopped on test-harness defects, not demonstrated app defects: audit-library script injection hit the app's CSP; the keyboard test assumed clicking the page reset sequential focus; and the test expected upper-case appointment IDs although the real IDs are lower case. The CSP remains intact; the audit runs through the browser debugger, the skip-link test uses a fresh page, and the fixture ID expectation now matches the actual record. Those runs are retained and not counted as product failures or passing checks.
- Run 04 passed the original full story. Run 05 rechecked it after the 14px core-text adjustment and mobile shortcut behavior. Run 07 includes the extra stale-window regression and final files. The stale-hold assertion's initially unexecuted wording regex was corrected to the actual backend message; the failure condition about referring to a removed form was unchanged.

## Evidence and reproducibility

- `evidence/before-desktop.png`: original presentation, preserved.
- `evidence/desktop-first-pass.png`, `mobile-first-pass.png`: first redesign pass.
- `evidence/run-07-final/desktop-initial.png`: final initial desktop composition.
- `evidence/run-07-final/changed-condition.png`: real revision invalidation.
- `evidence/run-07-final/wrong-item-desktop.png`: actual refusal at 1280×720.
- `evidence/run-07-final/wrong-item-mobile.png`, `mobile-choice.png`, `mobile-packed.png`, `mobile-packing-record.png`: phone workflow states.
- `evidence/run-07-final/a11y-*.json`: complete automatic audit reports, including incomplete categories.
- `evidence/run-07-final/final-server-state.json`: final invented QA records.
- `evidence/run-06-stale-recovery/`: preserved failed recovery check.
- `font-sources.json`: source URLs, byte counts and SHA-256 hashes. OFL licenses are in `ui/fonts/`.
- `evidence/axe-source.json`: exact audit package source and SHA-256.

Run from `closetrelay` with the existing Playwright dependency and Chromium installed:

```sh
DESIGN_RUN=another-run AXE_PATH=/absolute/path/to/axe.min.js node design/verify-ui.mjs
```

The script accepts `PYTHON` for the Python executable; its default is this host's bundled runtime. Port 4384 must be free. A fresh invented database is used on each run and its path is reported. The test starts and stops only its own server. The audit source used here is the public `axe-core@4.12.1` package, identified in `axe-source.json`.

## Recording selectors

Existing selectors and these exact action labels remain: `#edit-condition`, `#scan-id`, `#choice-panel`, `Record client approval`, `Record a new approval`, `Place an exclusive hold`, `Update item details`, `Save & require fresh approval`, `Scan or type the item ID`, `Confirm exact item & pack`, `The right item, packed.`, `Why is the preview unavailable?`, and `YouCam preview unavailable`.

The new inline error is `#pack-error`; the wrong-item server message appears there. Appointment button accessible names still contain `Fictional appointment A/B` even though their compact visual heading is `Appointment A/B`. Inventory button labels still include exact label, ID and state, such as `View Sample navy jacket, DEMO-JKT-01, Packed`. New controls are `#item-search` and `[data-action="show-choice"]`.

No backend, data, provider, recording script, shared QA document, or publishing configuration was changed by this redesign task. No commit was made.
