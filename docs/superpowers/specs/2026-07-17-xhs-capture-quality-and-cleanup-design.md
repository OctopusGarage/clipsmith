# XHS Capture Quality and Cleanup Design

## Goal

Make the verified XiaoHongShu capture path repeatable without disturbing the
user's foreground browser, leaving raw downloads behind, or silently choosing
an inferior video candidate.

This design replaces the earlier native-Chrome-download proposal. The working
reference flow is the one proven by `xhs-6a580adc00000000060311c5` and the live
`xhs-6a534b1a000000002103efec` capture: reuse the XHS tab, play briefly through
CDP, extract the player-loaded signed URL, and stream it through Node to a
`*.part` file before an atomic rename.

## Capture Flow

1. Reuse the authenticated Chrome CDP session and an existing XHS tab when one
   exists. Never call `bringToFront()`; browser interaction stays in the
   background.
2. Open the complete signed post URL, start or continue playback, and wait a
   randomized 3–5 seconds so the player exposes its real media resources.
3. Collect all post-scoped video candidates from structured page data and
   player-loaded resource entries. Preserve quality metadata when XHS supplies
   it: codec, width, height, frame rate, bitrate, and file size.
4. Rank direct candidates by declared dimensions, bitrate/file size, codec,
   and URL quality hints. A player-loaded URL wins only as a tie-breaker, not
   merely because it was observed last. Log the candidates and the reason for
   the selected one. Prefer the highest rendition in an HLS master playlist.
5. Download exactly the selected rendition with authenticated browser cookies
   and the current post Referer. Stream to `video-001.<ext>.part`; rename only
   after the response finishes.
6. Validate the finished media with `ffprobe`: parseable container, positive
   duration, a video stream, and an audio stream when the source declares one.
   Log width, height, frame rate, codecs, duration, and bitrate. Resolution is
   evidence of the selected rendition, not proof that the publisher's source
   was native at that resolution.

If XHS exposes no comparable metadata, the downloader records that limitation
and selects the player-loaded candidate. It must not claim “highest quality” in
that fallback case.

## Inbox Finalization and Raw Cleanup

`clipsmith sink inbox` gains an explicit cleanup option used by the XHS capture
workflow. Cleanup occurs only after all of these checks pass:

1. The normalized bundle validates successfully.
2. The inbox item is written successfully.
3. Every raw media asset selected for copying exists under `assets/` at the
   destination with the same byte size and SHA-256 digest.
4. The raw path passes safety checks: it is a real directory, is not a symlink,
   is not a filesystem root/home/workspace/inbox directory, and does not contain
   the destination.

After those checks, remove the exact raw capture directory and report the
cleanup in the JSON result. Any copy, digest, validation, or safety failure
keeps the raw directory intact and returns a non-success result. Cleanup is
idempotent: an already-absent raw directory is reported without deleting any
broader parent directory.

The XHS skill always uses this option for Alcove inbox captures. Raw-only
downloads outside an inbox workflow keep their existing behavior.

## Skill Contract

Update `skills/clipsmith-xhs/SKILL.md` so it describes one consistent path:

- background CDP playback, never foreground tab activation;
- player-resource extraction and authenticated Node streaming;
- quality-candidate logging and qualified “highest quality” reporting;
- bundle validation, inbox sink, digest-verified raw cleanup;
- no completion claim while required media is absent or raw media remains only
  in the download directory.

## Failure Handling

- Never delete `*.part` or the raw directory after an interrupted transfer.
- Never clean raw data when inbox finalization is partial or invalid.
- Do not retry after CAPTCHA, rate limiting, or an account anomaly.
- Do not open a dedicated video-download tab or buffer a multi-gigabyte
  response inside Chrome/CDP.
- A low-detail 4K transcode is reported as 4K resolution with its measured
  bitrate, not described as native 4K.

## Test Strategy

- Unit-test that playback never calls `bringToFront()` and does not pause an
  already-playing video.
- Unit-test candidate ranking with competing resolutions/bitrates and the
  metadata-absent player-loaded fallback.
- Unit-test cookie/Referer streaming, `*.part` rename, and interrupted-transfer
  preservation.
- Unit-test raw cleanup success after size/digest verification.
- Unit-test that mismatched, missing, symlinked, or unsafe raw paths are never
  deleted.
- Extend CLI tests for the cleanup option and JSON result.
- Run the XHS regression suite and the Python sink/CLI tests before completion.

## Scope

The quality-selection changes apply only to XHS videos. The cleanup option is
implemented at the inbox sink boundary so it is testable, but only the XHS skill
adopts it in this change. Image extraction, OCR, comments, and other providers
retain their current behavior.
