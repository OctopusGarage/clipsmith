# XHS Native Video Download Design

## Goal

Capture long XiaoHongShu videos through the authenticated browser's native
media path. Avoid a separate Node `fetch()` connection that can terminate near
the end of a multi-gigabyte transfer.

The reference capture is `xhs-6a580adc00000000060311c5`: a complete 4K HEVC
MP4 lasting 9,251.456 seconds and containing 6,898,978,928 bytes. Its macOS
metadata identifies QuickTime Player as the writer, showing that the successful
workflow used a native media client rather than the current Node stream.

## Browser Flow

1. Reuse the authenticated Chrome CDP session and the existing XiaoHongShu tab.
2. Open the target post with its complete signed share URL.
3. Bring the tab forward, click the visible video, and confirm playback starts.
4. Scrub to a small set of increasing positions with randomized watch pauses.
   Each seek must wait until the player reports usable buffered data or a new
   media response. This models a user checking different parts of a match and
   confirms that the signed media URL remains valid.
5. Open the player-loaded media URL in a dedicated Chrome tab and trigger a
   same-origin native browser download. Let Chrome's download manager own the
   long transfer; do not copy the response through Node `fetch()`.
6. Save the finished browser download into the raw capture directory using the
   normal deterministic video name.

The reference file was written by QuickTime Player, but the requested workflow
is browser-first. QuickTime is therefore diagnostic evidence for choosing a
native media client, not the implementation target.

## Completion and Failure Handling

- Preserve Chrome's partial download when a transfer fails; never delete it
  automatically.
- Do not retry after CAPTCHA, rate limiting, or an account anomaly.
- A video post is complete only when the final MP4 exists and `ffprobe` reports
  at least one video stream, one audio stream when present in the source, a
  positive duration, and no container parsing error.
- Keep the inbox item absent or partial until the media file passes validation.
- After success, normalize the bundle, sink the video and cover into the same
  Alcove inbox item, and run `alcove validate --json`.

## Test Strategy

- Unit-test the playback routine: it starts a paused video and seeks through
  monotonically increasing positions with randomized waits.
- Unit-test that already-playing video is not accidentally paused.
- Unit-test that video download uses a browser download event and never calls
  global `fetch()` or Playwright's request client.
- Unit-test preservation of partial download state on failure.
- Run the existing XHS regression suite before the live capture.
- Validate the live MP4 with `ffprobe` before declaring the capture complete.

## Scope

This change applies only to XHS post videos. Image capture, OCR, comments,
normalization, and inbox layout retain their existing behavior.
