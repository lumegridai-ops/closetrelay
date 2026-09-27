# QA evidence — September 26, 2026

The verified result is a local, single-operator application with a custom appointment-studio interface and an offline-tested YouCam adapter. **Live YouCam is not connected in the demonstration, and successful inference remains unverified.** No customer study, competitor advantage, remote multi-user security or winning outcome is established. The current UI research, decisions and detailed evidence are in the [design review](../design/DESIGN_REVIEW.md).

## Executed checks

| Check | Observed result | Evidence |
| --- | --- | --- |
| Provider contract, native transport, independent application and scheduler tests | 53 passed: 31 adapter, 5 loopback transport, 12 independent regression and 5 scheduler cases | [Independent review](../provider-tests/REVIEW.md), [captured result](../provider-tests/evidence/backend-review-final/result.json) |
| HTTP and SQLite application suite | 17 passed, including restart persistence, concurrent reservations/packing, request boundaries, private database permissions and no-key behavior; root reran on the final server revision | [Final backend test output](../artifacts/root-final-backend-tests.txt) |
| Redesigned UI: 12 real browser checks | Fresh SQLite workspace; search recovery, keyboard entry/focus, competing holds, condition-version invalidation, a stale packing window, wrong-item refusal preserving the typed value, exact version-2 packing/reload, unavailable packed stock, phone navigation and no-key behavior all passed; no uncaught browser errors | [Current design report](../design/DESIGN_REVIEW.md), [final results with source hashes](../design/evidence/run-07-final/results.json) |
| Earlier browser workflow on desktop and 390px phone viewport | Approval, hold, wrong-item refusal, correct packing, changes requiring fresh review, release/reallocation, persisted reload and actual image upload exercised on the earlier presentation | [Earlier UI report](../UI.md), [preserved screenshots and responses](../artifacts/ui/) |
| Root's separate real browser check | Wrong item left the hold intact; correct item produced one handoff; reload and an actual process restart retained it; uploaded synthetic PNG bytes matched the original hash after restart | [Saved observed states](../artifacts/root-browser-review/) |
| Current accessibility automation | Three axe-core 4.12.1 scans—desktop, 390px phone and phone error state—report zero automated violations. Each retains one incomplete contrast category | [Desktop](../design/evidence/run-07-final/a11y-desktop.json), [phone](../design/evidence/run-07-final/a11y-mobile.json), [phone error](../design/evidence/run-07-final/a11y-mobile-error.json) |
| Critical-text and error visibility | At 1280×720, item ID/state/condition and primary actions have computed sizes of at least 14px; current condition and the real inline packing error are visible together. The 390px layout has no horizontal overflow | [Measured bounds](../design/evidence/run-07-final/results.json), [desktop error](../design/evidence/run-07-final/wrong-item-desktop.png), [phone sheet](../design/evidence/run-07-final/mobile-choice.png) |
| New native-resolution demonstration | Working local application and fictional records; 3840×2160 frames; Google Gemini synthetic narration; condition change followed by renewed approval/hold, wrong-ID refusal and correct packing; provider disconnected | [Current media manifest](../artifacts/widescreen-demo-manifest.json), [transcript / captions](../artifacts/closetrelay-demo-4k.srt) |
| Archived earlier demonstration | Earlier UI, macOS synthetic voice, actual browser requests, provider disabled; that file received full decoding and representative-frame review | [Archived manifest](../artifacts/demo-manifest.json), [historical recording evidence](../artifacts/recording/README.md) |

The 70 automated Python cases are counted once, not once per rerun. The 12 browser checks are reported separately; the three accessibility scans are included within that workflow report rather than added as extra product tests. The earlier mechanism experiment, individual assertions and race trials are not added to the Python total. Accessibility automation is not a certification of accessibility; sampled keyboard and visual checks do not replace screen-reader testing or work with people using assistive technology.

## Current demonstration provenance

The new file is `artifacts/closetrelay-demo-4k.mp4`. Its eight Google Gemini narration segments total 75.6 seconds. The final cut has an 83.475-second container with 3840×2160 H.264 video and AAC audio. Exact current duration, hash and timeline belong to the [widescreen manifest](../artifacts/widescreen-demo-manifest.json), and identify this final cut. SHA-256: `231bd697e012082542e48b971dcbb02ba8a1ff7fcd25c030882131c967ef444e`. The full file decoded without errors. Delivery is 30 fps; the source manifest describes timestamped native PNG frames and held frames, not continuous 30-fps screen capture.

The [caption file](../artifacts/closetrelay-demo-4k.srt) corresponds to the new narration. The [v0.2.0-preperiod MP4 download](https://github.com/lumegridai-ops/closetrelay/releases/download/v0.2.0-preperiod/closetrelay-demo-4k.mp4) is the release download. Publication of a demo does not establish contest submission. The new cut preserves the original app actions and timestamps. Two short screenshot offsets were held on their preceding genuine frames; 36–42.2 seconds enlarges the wrong-ID evidence with a 1.33× crop. Item IDs were typed; no hardware scanner was tested. The embedded subtitle track works in compatible players; the sidecar SRT is provided for other players. See [media provenance](MEDIA.md). The archived review still applies only to its earlier identified file.

## Failures preserved instead of hidden

Independent review first found five failing application scenarios: old garment bytes paired with a new choice, old source bytes paired with new consent, duplicate pending provider creation, key clearing during creation, and key replacement during polling. A later separate review found two more: lost provider failure provenance and implicit restoration of an ambient key.

The original failing outputs, exact test files and implementation hashes are preserved. The same regression assertions passed after fixes. [Detailed before/after record](../provider-tests/REVIEW.md).

Earlier visual review corrected indistinguishable truncated appointment names, illustrative colors that did not match garment labels, text contrast, keyboard focus, and overlap between a focused scan field and its help text. An earlier demo take was replaced after inspection showed its actual error message outside the viewport.

The redesign keeps the wrong-item error beside the scan field and preserves the attempted ID. An additional real failure was found in the new recovery copy: if a second window changed the garment and revoked the hold, the first window was told to use a packing form that no longer existed. The [original failing run](../design/evidence/run-06-stale-recovery/results.json) and source hashes are preserved. The UI now refreshes the state before choosing its recovery message; the same stale-form check passes in [the final run](../design/evidence/run-07-final/results.json). Earlier audit setup, keyboard-test setup and fixture-ID errors are separately disclosed as test-harness defects in the design report.

## What remains unverified

- A real YouCam key/credit, successful V4 upload/task/output, actual output quality, upstream cost, cancellation and deletion.
- A private remote client/staff service: this prototype has one local operator and no independent authenticated consent record.
- Full image decoding, orientation normalization, metadata stripping and provider pose compatibility; current checks validate bounded JPEG/PNG containers.
- Representative client/volunteer use, cataloging effort, usefulness of previews, physical fit and comparison with capable existing tools.
- Human audio audition or blind audience comprehension of the new demo. A model-generated audio review, metadata, decoding and sampled visible-frame inspection are narrower checks; the historical media review does not verify the new cut.
- Contest submission and significant updates within the September 29 onward submission period. This dated precursor alone does not satisfy that later-work condition.

No real API key, real client photo, private workspace database, or invented provider result is included in the public source or demonstration.
