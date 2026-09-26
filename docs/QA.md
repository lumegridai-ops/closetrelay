# QA evidence — September 26, 2026

The verified result is a local, single-operator application with an offline-tested YouCam adapter. **Live YouCam inference is unverified.** No customer study, competitor advantage, remote multi-user security or winning outcome is established.

## Executed checks

| Check | Observed result | Evidence |
| --- | --- | --- |
| Provider contract, native transport, independent application and scheduler tests | 53 passed: 31 adapter, 5 loopback transport, 12 independent regression and 5 scheduler cases | [Independent review](../provider-tests/REVIEW.md), [captured result](../provider-tests/evidence/backend-review-final/result.json) |
| HTTP and SQLite application suite | 17 passed, including restart persistence, concurrent reservations/packing, request boundaries, private database permissions and no-key behavior; root reran on the final server revision | [Final backend test output](../artifacts/root-final-backend-tests.txt) |
| Browser workflow on desktop and 390px phone viewport | Approval, hold, wrong-item refusal, correct packing, changes requiring fresh review, release/reallocation, persisted reload and actual image upload exercised | [UI report](../UI.md), [screenshots and responses](../artifacts/ui/) |
| Root's separate real browser check | Wrong item left the hold intact; correct item produced one handoff; reload and an actual process restart retained it; uploaded synthetic PNG bytes matched the original hash after restart | [Saved observed states](../artifacts/root-browser-review/) |
| Accessibility automation | Initial contrast findings were fixed; final desktop and mobile runs report zero automated violations; an incomplete contrast category still requires manual interpretation | [Desktop](../artifacts/ui/a11y-after-contrast-fix.json), [mobile](../artifacts/ui/a11y-mobile.json) |
| Recorded demonstration | Actual browser requests and fictional data; synthetic narration; provider visibly disabled; full media decoding and representative-frame review | [Media manifest](../artifacts/demo-manifest.json), [recording evidence](../artifacts/recording/README.md) |

The 70 automated Python cases are counted once, not once per rerun. The earlier mechanism experiment, individual assertions, race trials and browser actions are not added to this total. Accessibility automation is not a certification of accessibility; keyboard checks and visual review cover only the exercised paths.

## Failures preserved instead of hidden

Independent review first found five failing application scenarios: old garment bytes paired with a new choice, old source bytes paired with new consent, duplicate pending provider creation, key clearing during creation, and key replacement during polling. A later separate review found two more: lost provider failure provenance and implicit restoration of an ambient key.

The original failing outputs, exact test files and implementation hashes are preserved. The same regression assertions passed after fixes. [Detailed before/after record](../provider-tests/REVIEW.md).

Visual review also corrected indistinguishable truncated appointment names, illustrative colors that did not match garment labels, text contrast, keyboard focus, and overlap between a focused scan field and its help text. The first demo take was replaced after inspection showed its actual error message outside the viewport; the final recording scrolls the real message into view.

## What remains unverified

- A real YouCam key/credit, successful V4 upload/task/output, actual output quality, upstream cost, cancellation and deletion.
- A private remote client/staff service: this prototype has one local operator and no independent authenticated consent record.
- Full image decoding, orientation normalization, metadata stripping and provider pose compatibility; current checks validate bounded JPEG/PNG containers.
- Representative client/volunteer use, cataloging effort, usefulness of previews, physical fit and comparison with capable existing tools.
- Human audio audition or blind audience comprehension of the demo. Media decoding and visible-frame inspection are narrower checks.
- Contest submission and significant updates within the September 29 onward submission period. This dated precursor alone does not satisfy that later-work condition.

No real API key, real client photo, private workspace database, or invented provider result is included in the public source or demonstration.
