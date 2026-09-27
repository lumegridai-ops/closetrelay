# ClosetRelay typography refinement

The user reported that the live page's font looked strange. This change replaces the narrow Instrument Serif display headings and Manrope pairing with one locally served **Source Sans 3** family. The appointment-studio layout, garment drawings, action labels, actual application logic and provider claims are preserved.

## Research and decision

The earlier live screenshot showed very narrow, high-contrast display headings alongside much smaller interface labels. This was a visual diagnosis, not a claim that serif fonts are generally inaccessible.

- [USWDS typography guidance](https://designsystem.digital.gov/components/typography/) recommends neutral interface type, comfortable body text around an effective 16px, deliberate hierarchy and appropriate line spacing. That supports increasing reading text and reducing the contrast between a decorative headline and tiny supporting text.
- [IBM Carbon typography](https://carbondesignsystem.com/elements/typography/overview/) distinguishes task-focused product type from expressive editorial headings. This screen is primarily for reading a garment record and making a precise commitment, so restrained headings are the more useful choice here.
- [Adobe's official Source Sans repository](https://github.com/adobe-fonts/source-sans) describes Source Sans 3 as designed for UI environments and publishes its open font license. It supplies a neutral but distinctive single family for headings, body copy and controls.
- [W3C resize-text guidance](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html) and [text-spacing guidance](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html) informed the checks for 200% root text size and user spacing overrides. These tests are bounded evidence, not a full WCAG conformance audit.

No source establishes that this particular font improves appointment outcomes. The selection is a response to the user's visual feedback, supported by guidance and checked in this actual interface. No customer preference study, speed measurement or accessibility certification is claimed.

## Type system

At the browser's normal 16px default:

| Use | Size and treatment |
| --- | --- |
| Page title | 40px desktop; 32px phone; semibold, ordinary width |
| Section heading | 24px, semibold |
| Appointment-sheet or dialog heading | 28px desktop; 26px phone |
| Body, item detail, condition, approval and primary action | 16px; body line-height 1.5 |
| Short supporting copy and secondary controls | 14px |
| Metadata and short captions | 12px minimum; essential status labels 14px |

The main hierarchy uses regular body copy, semibold headings/actions and a bolder wordmark. Heading tracking is restrained; body tracking remains natural. Relative font units preserve the user's ability to enlarge text. The mobile stepper, filter row, top bar and sample notice can wrap when text is enlarged.

`ui/typography.css` is a separate, readable typography layer. The new font is one 170,188-byte WOFF2 file with an OFL license. The old font preloads and active declarations were removed; a browser check confirmed only Source Sans 3 was requested. Earlier font files and evidence remain in the repository as historical material. [Exact source URLs and hashes](font-source.json).

## Checks actually executed

The read-only typography checks used the running page at `http://127.0.0.1:4323`; they did not change its records. Mutating workflow checks used the existing test runner's fresh, isolated SQLite workspace on port 4384. No key, provider request or real client material was used.

The initial refined [typography results](evidence/run-03/results.json) record seven check groups:

1. One local Source Sans 3 font actually loaded; the body and headings use it; details and primary actions compute to 16px.
2. No document or out-of-viewport element overflow at widths 1440, 1280, 1024, 768, 390 and 320 CSS pixels. The appointment navigation's intentional horizontal scroll area is excluded from the element test.
3. The mobile “Review item” shortcut still focuses the selected sheet heading.
4. Setting root text to 200% produces no document or measured element overflow at desktop and phone widths.
5. Applying line height 1.5, letter spacing .12em, word spacing .16em and paragraph spacing 2em produces no measured overflow at desktop and phone widths.
6. Blocking the custom font request leaves a usable system-font fallback, no horizontal phone overflow and an enabled approval action.
7. No uncaught JavaScript page errors.

The existing [12 real browser workflow checks](../evidence/typography-final/results.json) pass with the new typography. This includes condition revision invalidation, a stale packing window, preserving a wrong scan, exact version-2 packing, saved reload and keyboard continuation. Desktop, phone and phone-error axe scans report zero violations, each retaining one incomplete contrast category. The application JavaScript hash is unchanged from the previous verified UI.

The recorded screenshots were visually inspected, including the main desktop view, phone sheet, enlarged/respaced phone text, font fallback and real wrong-item error. These checks do not cover every string, every assistive technology or every browser. The 200% test enlarges root text; it is not represented as a full browser-zoom or screen-reader audit.

## Failures preserved and corrected

- The first new-type workflow run found insufficient contrast on the sidebar's “Carried through.” text: reducing it from large display type to 20px regular text meant the old color no longer met the audited threshold. The failed [axe report](../evidence/typography-flow/a11y-desktop.json) is preserved. A darker color passes the final scan.
- The first typography run found 458px of document width in a 390px viewport when text was doubled. The top bar, progress row and filter group did not allow enough wrapping. [Original failure](evidence/run-01/results.json) and screenshots remain. Flexible wrapping, rem-based appointment-card sizing and a scalable detail-label column correct the demonstrated cases.
- Run 02 passed after those corrections. Run 03 repeated the same checks after refining the enlarged-text wrapping of appointment navigation and the sample notice. The test criteria were not reduced.
- An early interactive font check used an invalid unquoted family name and was corrected. That command error is not counted as a product defect or passing browser check.

## Screenshots

- [Before: actual 4323 desktop](evidence/before-live-desktop.png)
- [After: desktop, 1440×1000](evidence/run-03/initial-1440.png)
- [After: desktop, 1280×720](evidence/run-03/initial-1280.png)
- [After: phone, 390×844](evidence/run-03/initial-390.png)
- [Phone appointment sheet](evidence/run-03/selected-sheet-mobile.png)
- [Enlarged phone text](evidence/run-03/text-200-390.png)
- [User spacing overrides](evidence/run-03/text-spacing-390.png)
- [Font-unavailable fallback](evidence/run-03/font-unavailable-mobile.png)
- [Real wrong-item refusal with the new type](../evidence/typography-final/wrong-item-desktop.png)

Run the read-only checks with `node design/typography/verify-type.mjs`; `TYPE_URL` selects the local server and `TYPE_RUN` names the evidence directory. The existing workflow runner is `DESIGN_RUN=another-type-flow node design/verify-ui.mjs` and creates its own isolated fictional database. Source hashes are saved with each run.

No backend, provider, application JavaScript, recording tool, video, account, publishing configuration or API key was changed. The existing 4K demo retains the previous typography; it has not been regenerated as part of this font-only refinement. No commit or publication was made.

The final minimum-size pass raises remaining captions to 12px and essential status labels to 14px. All seven checks passed against a fresh isolated workspace; see [minimum-size verification](evidence/min-12-verified/results.json). The earlier minimum-size run checked an already-fulfilled local appointment, so its fallback assertion could not find an approval button; that harness-state failure is preserved in `evidence/min-12-final/`.
