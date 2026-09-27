# Final presentation provenance

The v0.2.0-preperiod release contains `closetrelay-demo-4k.mp4`, its English SRT captions, and `presentation-source.zip` containing the original narration clips and native captured frames. Source frames and API traces show actual application operations. Fictional records and outage replays are visibly labeled.

- Final file: 83.475000 seconds, 3840×2160 H.264, 30fps delivery, AAC narration, English mov_text track.
- SHA-256: `231bd697e012082542e48b971dcbb02ba8a1ff7fcd25c030882131c967ef444e`.
- Two hash-locked screenshot repaint offsets replaced by preceding real frame, preserving time; 36–42.2s uses a disclosed 1.33x crop; title cards refreshed; English selectable captions embedded.
- Native PNG screenshots are timestamped and repeated unchanged frames are held. This is not 30 unique captures per second. The focus crop resamples a 2880×1620 portion of a genuine source frame; no app results or text are fabricated.
- Gemini model `gemini-3.8-flash-tts`, voice Sulafat. All eight clips are disclosed synthetic narration. Credentials are not in this repository or the source-media archive.
- Independent audio-input transcription matched the scripts; full decode, duration and measured peak checks passed. No human listening test or audience-comprehension study was performed.
- English captions are sentence-timed from measured narration segments and visually reviewed. Embedded MP4 captions depend on player support; use the SRT sidecar where necessary.

`tools/record-widescreen-demo.mjs` records a fresh real workflow. The finalization script documents hash-locked edits for this specific archived capture and refuses different originals. It is an editorial reproducibility record, not a generic promise that fresh live data will produce identical pixels. The raw frames and first-cut manifest remain preserved.

The demo types item IDs into the scan-or-type field; no hardware scanner was validated. Live YouCam remains disconnected and no provider image is claimed.
