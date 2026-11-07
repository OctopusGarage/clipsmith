# Autonomous recovery workflow evaluation

Provider quality gate: PASS
Skill: clipsmith-x; clipsmith-capture
Deterministic checks: both skill validators PASS; X provider regression PASS;
project health check OK, including 112 Python tests.
Agent AI eval: PASS (independent behavioral review).

Baseline: existing instructions demanded page inspection but also directed
reporting when the script could not run. No explicit repair/verify/resume mandate
connected the two, so a selector diagnosis could still end the task.

Updated scenario outcomes:

- Readable page with selector mismatch or unfamiliar markup: inspect semantic
  DOM/permalink evidence, repair existing source, test, rerun and finish capture.
- Missing executable/runtime failure: inspect installation/source/dependencies;
  correct a demonstrated local cause, without inventing a competing downloader.
- Normalization failure after download: preserve assets, fix the failed stage,
  then validate/finalize/deliver instead of repeating extraction.
- CAPTCHA/rate limit/account lock: stop immediately, preserve partial evidence,
  request the specific necessary user intervention; never bypass protection.
- Login: ask for manual login only when requested content is actually blocked.
- Repeated no-progress repairs: inspect plausible remaining causes, avoid blind
  retries/large rewrites, then report evidence and the specific remaining blocker.

Review identified two older output-contract contradictions (raw directory naming
and regular-post MHTML). Both were reconciled with existing script behavior.
This evaluation validates recovery guidance, not a claim that every future site
change can be repaired automatically. No new live capture was required for this
instruction-only change; prior verified live capture remains unchanged.
