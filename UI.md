# ClosetRelay interface and browser QA

Completed September 26, 2026. This document covers the vanilla browser interface in `ui/`; backend, provider, final publication and entry readiness are owned by the parent task.

## Delivered behavior

The interface uses the actual Python JSON API. There is no simulated success mode, client-side stock ledger, testimonial, invented impact metric, or replacement image presented as a YouCam result.

- Select an appointment and inspect a particular inventory record, including its ID, location, condition, version and availability.
- Record the client's exact choice, place an exclusive hold, release it, or scan/type the exact ID to confirm packing.
- Explain conflicts and preserve the original server failure under “Response details.” A failed action reloads saved state rather than assuming success.
- Updating condition, availability or the garment image creates a new item version and makes affected choices require review. Packed records are read-only in this one-item workflow.
- Show the real action history and current packing manifest/handoff, with inspectable record IDs. Packing never claims shipment or delivery.
- Add appointment and item records, and upload JPEG/PNG garment images to the backend. Uploads are actual files, not links fabricated by the interface.
- Offer a password field for a YouCam key that is sent only to the backend's memory-only configuration endpoint. The field clears after submission. It is not written to browser storage, a URL, or a client log. A configured key is explicitly not evidence of API access or a successful preview.
- When a real provider is configured, expose source-image consent, preview request, bounded backend polling status, provider evidence and consent withdrawal. The browser reads an existing pending task every two seconds; it never automatically creates another provider task. Only the optional preview area updates, preserving scan input and the item version the operator actually reviewed.
- Render provider output only when the backend marks it displayable and succeeded, the URL is a same-origin `/media/` path, and the viewed item matches the current approval/item version/choice revision. Browsing a different item cannot display or request a preview under the wrong item card.

The no-key state disables the preview, explains why, and leaves the complete non-photo approval/packing route usable. Actual provider generation and pending-task behavior were not demonstrated by this UI QA pass.

## Presentation and accessibility decisions

Warm neutral surfaces, forest green action areas, a three-step progress strip and a persistent next-action panel distinguish browsing from commitment. Item counts are calculated from returned records. The sample catalog and appointments are prominently labeled fictional. Schematic jackets are labeled illustrations; their named colors match the fictional cards. Uploaded sample images are labeled fictional test images, and non-sample uploads are labeled uploaded item images rather than verified photographs.

There are no role-switching or sign-in claims: this is explicitly one local operator controlling the records. It is not a private client portal.

The page uses native buttons, labeled fields, native modal dialogs, a skip link, visible focus rings, live action announcements, reduced-motion handling and responsive layouts. After approval, keyboard focus advances to holding; after holding, to the scan field; after packing, to the packing record. Selecting a card or appointment preserves keyboard focus through rendering. Modal Escape returns to the invoking control.

## Actual browser verification

Tool: agent-browser 0.38.1 with its Chrome session, against the real loopback Python server. Mutating checks used an isolated database at `/tmp/closetrelay-ui-qa-20260926.sqlite3`, port 4324. The parent server/database on port 4323 was not mutated by this agent. Final presentation screenshots show the parent server's initial fictional catalog, read-only.

| Check | Observed result |
|---|---|
| Initial page load | Meaningful content, expected controls, no framework overlay; no JavaScript page errors reported. |
| Desktop layout | Inspected an actual 1440-pixel-wide screenshot. No horizontal overflow. |
| Phone layout | Inspected an actual 390 × 844 viewport screenshot; document width remained exactly 390 pixels. |
| Two-window hold conflict | A and B approved `DEMO-JKT-01` before holding. A held it. B's stale-window hold received HTTP 409; B did not acquire it. |
| Wrong-item packing | Entering `DEMO-JKT-02` for A's hold of `DEMO-JKT-01` received HTTP 409. The original held item remained intact. |
| Changed condition | Editing the held item made version 2, invalidated the hold and old approvals, and displayed “This item changed. Review it again.” |
| Release and recovery | A reviewed version 2, held, then released it. B recorded a fresh approval, held the item and packed the exact ID. |
| Reload persistence | After browser reload and reopening B, the same packed item/version and handoff record remained visible. Server-restart verification belongs to the independent parent review. |
| Keyboard continuation | Actual Enter/key typing continued approval → hold → scan input → packing. Focus IDs/actions were read from the browser after each step. |
| Skip link and dialogs | Tab focused the skip link; Enter focused `main`. Escape closed the packing dialog and returned focus to its trigger. |
| Phone completion | A new explicitly fictional QA appointment/item completed approval, hold and exact packing at 390-pixel width. |
| New records | Added an explicitly fictional QA appointment and `QA-TEST-01` through the actual forms. |
| Garment upload | Uploaded the parent's synthetic navy test PNG through the real file input and backend. The image loaded and remained labeled fictional test material. For this isolated upload check it was attached to an olive sample card; the condition text explicitly records that mismatch and its synthetic nature. It is not production inventory. |
| No-key provider | Preview remained disabled; no YouCam task/result was claimed. Key field was password type, autocomplete off, initially empty; localStorage and sessionStorage were empty. No actual key was entered in this pass. |
| Accessibility scan | Initial axe 4.12.1 report found one contrast violation type affecting 17 nodes. Darkened text colors. Follow-up desktop and phone scans reported zero automated violations; each retained one incomplete contrast category. |

The incomplete contrast category includes layered/pseudo-element backgrounds and non-text symbols. These automated reports and sampled visual/keyboard checks are not comprehensive WCAG certification, screen-reader testing, or testing with people using assistive technology. No physical barcode scanner, real client appointment, user study or live YouCam call was used.

## Issues found and corrected

1. Long fictional appointment names initially made A and B visually indistinguishable in the sidebar. Short labels and distinct A/B initials now preserve that distinction, with fictional labeling retained.
2. Early schematic garment colors were assigned arbitrarily. They now reflect navy, charcoal, olive and burgundy as named by the sample records. Initial screenshots are retained as development evidence.
3. Some secondary text failed contrast checks. The original report remains saved; the darker palette passed the subsequent automatic scan.
4. Replacing the panel after a mutation lost keyboard focus. Explicit focus continuation now follows the next meaningful action.
5. The independent parent review saw a focus-ring overlap with the scan-help line in the first demo recording. The help now has 12 pixels of top/bottom spacing. The parent is re-recording the final UI to verify its recorded presentation.

## Evidence files

- `artifacts/ui/desktop-final.png` and `mobile-final.png`: current presentation, inspected visually.
- `desktop-initial.png` and `mobile-initial.png`: preserved earlier visuals before the sidebar/color/readability refinements.
- `wrong-item-refused.png`, `changed-item-review.png`, `packed-record.png`, `mobile-packed.png`: actual workflow states.
- `conflict-response.txt` and `wrong-item-response.txt`: original browser-extracted failure objects, including HTTP 409 and backend messages. The CLI JSON-string wrapper is preserved.
- `a11y-initial.json`, `a11y-after-contrast-fix.json`, `a11y-mobile.json`: original automatic reports, including the first failure.
- `mobile-workflow-result.json`: actual browser observations of packed state, width and disabled preview.
- `workflow-final-state.json`: saved final state of the isolated fictional QA database.
- `qa-summary.json`: source hashes and the bounded QA outcome.

All browser media in these files is fictional test material. No actual client photograph, live provider image, client approval, shipment, testimonial or competition outcome is represented.
