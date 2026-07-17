# XHS Motion-Quality Video Selection Design

## Goal

Make XiaoHongShu video selection favor a sharp, smooth viewing experience,
especially for full-match sports footage. Do not require every saved video to
use the same codec; codec uniformity is less important than measured playback
quality.

## Selection Policy

When comparable metadata is available, rank candidates lexicographically by:

1. pixel count (`width * height`), highest first;
2. frame rate, highest first;
3. codec efficiency, preferring HEVC/H.265 over H.264/AVC;
4. bitrate, highest first;
5. declared file size, highest first;
6. existing URL quality hints;
7. player-loaded status as the final tie-breaker.

This changes the current order, which compares bitrate and file size before
frame rate and codec. For example, between 4K H.264 at 25 fps and 4K HEVC at
50 fps, the 50 fps HEVC rendition wins even when the H.264 rendition has a
higher declared bitrate.

Metadata-free candidates retain the existing qualified fallback behavior. The
downloader must not claim a rendition is highest quality when the available
evidence cannot support that conclusion.

## Inspection Mode

Add an `--inspect_video true` CLI option to the existing XHS runner. Inspection
reuses the authenticated Chrome/CDP flow and performs the same playback priming,
candidate extraction, ranking, and diagnostic formatting as a capture, but it
does not create a raw output directory or download media.

The JSON result includes the canonical note ID, all sanitized candidate
metadata, the selected candidate, and the selection basis. Signed query
parameters and authentication data are never emitted. Risk signals stop the
inspection without retrying, matching normal capture behavior.

Inspection and capture call the same selector so an inspection result predicts
what a subsequent capture will choose.

## Existing-Video Audit and Replacement

Use inspection mode on existing 4K/25 fps H.264 inbox items. Redownload only
when the live post exposes a candidate that is materially better under the new
policy:

- a higher resolution; or
- the same resolution at a higher frame rate.

Do not redownload merely because codec, bitrate, or file size differs. Codec is
a tie-breaker for future captures, not sufficient evidence that replacing an
existing file will improve its appearance. Do not touch an existing inbox asset
until the replacement has downloaded completely and passed `ffprobe`
validation.

Replacement is performed through a fresh raw capture and normalized bundle.
After validation, compare the new file's measured width, height, frame rate,
codec, positive duration, and audio-stream presence with the existing file.
Only then replace the exact video asset using a recoverable backup of the old
file. Keep the existing capture metadata and post content unless the fresh
capture supplies required corrections. Run `alcove validate --json` after each
replacement.

For the current inbox, the two measured 4K/50 fps HEVC videos already satisfy
the target and require no inspection-driven redownload. The two measured
4K/25 fps H.264 videos are inspection candidates, not automatic redownloads.

## Failure Handling

- A missing live post, expired session, CAPTCHA, or incomplete candidate list
  leaves the existing inbox item unchanged.
- A failed or interrupted download leaves the existing video unchanged and
  preserves the raw partial capture for diagnosis.
- A replacement that fails media or Alcove validation is not installed.
- Inspection never mutates inbox data and never downloads a multi-gigabyte
  asset.

## Tests

- Update selector tests to prove resolution wins first, then frame rate, then
  HEVC, then bitrate.
- Add the 4K H.264/25 fps versus 4K HEVC/50 fps regression case observed in the
  Cape Verde capture.
- Test inspection JSON, signed-URL sanitization, no-output/no-download behavior,
  and parity between inspection and capture selection.
- Run the complete XHS test suite.
- For any live replacement, verify the installed asset with `ffprobe` and run
  `alcove validate --json` in the destination knowledge base.

## Scope

This change affects XHS video candidate selection and adds read-only candidate
inspection. It does not transcode existing files, alter image/OCR/comment
capture, change other providers, or automatically replace inbox assets.
