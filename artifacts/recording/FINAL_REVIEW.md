# Final recording review

Reviewed September 26, 2026. **No material visual or factual mismatch found in this bounded review.** The wrong-item error is now visible, correct packing follows, and the recording accurately presents a fictional local prototype with no live YouCam result.

I inspected the real frames at 5, 20, 31, 38 and 60 seconds, `timeline.json`, and `actual-api-trace.json`. I also extracted 31 seconds directly from the final MP4 and verified that its pixels exactly match the supplied review frame. The entire MP4 decoded successfully with FFmpeg. This is sampled visual review, not a claim to have watched every frame or auditioned the audio. I built the UI but did not assemble this recording or its narration.

| Evidence | Finding |
|---|---|
| 5 seconds | Fictional appointment and catalog disclosures are prominent. Garment drawings are explicitly labeled illustrations. Local operator scope is stated. |
| 20 seconds | The exact navy item is held for appointment A. The scan field, expected ID and helper text are readable; the focus ring no longer overlaps the help line. |
| 31 seconds | The full red banner is visible: “The change was stopped” and “Scanned item does not match the exact held and approved item.” The item still shows held here. |
| 38 seconds | `DEMO-JKT-01` is packed for A, with a handoff recorded and an explicit statement that shipping/delivery is not implied. |
| 60 seconds | Appointment B cannot approve the already packed item. YouCam is visibly unavailable, with the reason that no API key is configured in server memory. |

The actual request trace corroborates approval of `DEMO-JKT-01` version 1, an exclusive hold, an HTTP 409 rejection for `DEMO-JKT-02`, then HTTP 200 packing for `DEMO-JKT-01`. The final state contains one handoff for A, no handoff for B, no source photos or previews, and `provider.configured=false` / `enabled=false`. No real client consent, physical shipment, generated provider image or live inference is implied by the inspected visuals and written narration. Offline adapter testing is explicitly distinguished from live verification; this review did not independently rerun those adapter tests.

Technical file: H.264, 1440×1080, 25 fps, 2,204 video frames, AAC mono 48 kHz, 88.180-second container. SHA-256: `9b464228305a09792b0c0066fe872d7aa2aa690500b232cfa265df489cd42551`. The timeline's nominal end includes approximately 0.7 seconds of trailing padding beyond the delivered file; its last stated audio segment ends at approximately 88.180 seconds, so the metadata difference alone does not indicate missing narration.

**Limits:** No audio listening test, unbriefed audience test, complete frame-by-frame review, or claim of competition readiness. Some small interface text benefits from full-size playback. These limits do not reveal a material blocker in the inspected recording.
