# Archived earlier local demonstration

This directory preserves the earlier macOS-voice recording and its review. The current custom-UI demo is `../closetrelay-demo-4k.mp4`, with [updated transcript / captions](../closetrelay-demo-4k.srt), [current manifest](../widescreen-demo-manifest.json), Google Gemini synthetic narration, and native 3840×2160 frames. See the [current design and verification report](../../design/DESIGN_REVIEW.md). The [v0.2.0-preperiod download](https://github.com/lumegridai-ops/closetrelay/releases/download/v0.2.0-preperiod/closetrelay-demo-4k.mp4) is the planned release location until publication is confirmed. The historical review below does not constitute a review of that new cut.

The final `../closetrelay-local-prototype.mp4` is a real browser recording against a new local SQLite database. All appointments and inventory cards are fictional. Narration uses the macOS synthetic voice; scripts and text are included. No real YouCam task or output appears in this demonstration.

The script records actual API writes and responses in `actual-api-trace.json`. It explicitly checks the final packing record and that the provider is disconnected. It does not mock application endpoints or composite a generated UI into the footage.

An initial take was reviewed and replaced because the wrong-item rejection banner was above the visible viewport. The recording script now scrolls the actual message into view. `first-take-manifest.json` retains that earlier media hash; the latest `../demo-manifest.json` identifies the final take. The UI also gained space below the focused packing input after visual review.

The app runs with Python alone. Re-recording additionally requires the optional Node/Playwright tools, Chromium, macOS `say`, `ffmpeg` and `ffprobe`: install the dev tools with `npm ci`, then use `npm run record:demo`. The script explicitly removes an ambient `YOUCAM_API_KEY` from its child environment and never connects a provider.

Decoding and representative-frame inspection do not constitute an audience study or a human audio audition.
