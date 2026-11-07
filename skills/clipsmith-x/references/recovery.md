# Recover a Failed X Capture

The outcome is a verified capture delivered to the user's authorized destination,
not merely a successful script invocation. Do not infer that a post is unavailable
from an exit code, timeout, missing selector, login button, or failed fallback.
Use judgment and observed evidence; this is not a fixed list of layouts to try.

## Diagnose before escalating

Inspect the existing target tab read-only: URL, title, visible body, target
permalink, author, media, and the actual exception. Reuse loaded content rather
than reloading it. Small browser evaluation snippets for inspection are allowed;
the prohibition on competing downloaders does not prohibit diagnosis.

Distinguish a genuinely blocking login/risk page from a readable public post.
Check whether the problem is page structure, delayed rendering, local runtime,
media extraction, normalization, or destination handling. If selectors fail but
text is visible, inspect semantic containers and permalink relationships instead
of concluding the site is unavailable. Scope observations to the requested post;
quotes, replies, recommendations and avatars are not original-post assets.

## Repair and finish within the authorized scope

- For a transient condition, wait for an observable readiness condition or correct
  the demonstrated local cause. Repeat a capture only when new evidence or a
  changed condition gives it a reasonable chance to work. Do not blindly repeat
  commands or reload a readable page.
- For an extractor/runtime defect, inspect the existing source and repository
  instructions, then make a small reversible fix there. Capture intent permits
  routine local recovery within the user's authorized scope; do not introduce
  an extra approval step just because a script needs repair. Preserve unrelated
  edits. Fix source reached through a skill symlink rather than leaving only an
  ephemeral browser patch. If source is unavailable, inspect the install path
  before declaring it unrepairable.
- Reproduce the defect with a small synthetic regression where practical. Run
  the relevant provider checks, then rerun against the original target in the
  existing session. Validate full text, metadata, media counts, and bundle—not
  just the exit status. Never commit third-party full content as a fixture.
- Finish the original task: normalize, validate, finalize the capture job, and
  sink to inbox when authorized. Preserve already-downloaded assets; don't
  overwrite another complete capture during recovery. A text-only fallback is
  partial when the target has missing images/video.
- Keep a useful source fix and regression. Update skill guidance only for a
  reusable lesson; do not accumulate a special rule for every failed post.

## When recovery really needs the user

Stop immediately at an actual CAPTCHA, rate limit, account lock, or other hard
risk signal; do not bypass it or retry. Ask for manual login only when it blocks
the requested content. Do not change accounts, proxy settings, credentials,
permissions, or unrelated system configuration to force a capture.

If evidence-based repairs repeatedly make no progress, investigate remaining
plausible causes before escalating. Do not loop indefinitely or broaden into a
large rewrite. Report the concrete blocker, evidence examined, distinct fixes
tried, partial files preserved, and the smallest user action actually needed.
A fixed retry count alone is not a reason to give up or to keep trying. Explicit
permission is required for an action outside the original authorized scope.

## Explain the result accurately

On success, report the saved result and briefly name a material repair. On a
real blocker, explain what remains missing. “The script failed” is diagnostic
input, not a sufficient explanation that the task cannot be completed.
