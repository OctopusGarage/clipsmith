# Browser background execution review

## Changes

- Generic web capture, blog discovery, and runtime checks now use the shared
  `createBackgroundPage` helper in CDP mode. Headless capture retains its default.
- X's exploration script reuses the authenticated context, creates a background
  tab, and closes only its own tab before disconnecting, including on errors.
- X, XHS, and WeChat capture executors already use the shared background helper.
  Dedicated Chrome startup already uses `open -g -na`; its failure guidance now
  includes `-g` too.
- Repository instructions and the web skill explicitly preserve foreground app,
  selected tab, and keyboard focus during capture, discovery, checks, and recovery.
  Background failures do not trigger app activation or global input.
- [agent-desktop](https://github.com/vercel-labs/agent-desktop) is documented as
  an optional fallback for required desktop interactions. Its documented default
  uses accessibility actions without moving the pointer or taking focus.
  Check the installed version and permissions first; do not use `--headed`.
  No desktop fallback was needed or installed for this change.

## Verification

| Command | Result |
| --- | --- |
| `./script/check-health.sh` | PASS; 113 Python tests, provider contracts, wheel hygiene, and formatting |
| `npm --prefix skills/clipsmith-web test` | PASS; 6 browser integration tests |
| `bash skills/clipsmith-web/tests/test_regression.sh` | PASS |
| `bash skills/clipsmith-x/tests/test_regression.sh` | PASS; local DOM and shared runtime tests; live checks skipped |
| `cd skills/clipsmith-web && npx --no-install tsx --test ../_shared/browser-runtime/tests/cdp.test.ts` | PASS; 9 shared runtime tests |
| `uv run clipsmith validate-bundle skills/clipsmith-web/evals/fixtures/kingson-agent-runtime-skill-ai --json` | PASS; no issues |
| `node skills/clipsmith-web/scripts/eval.mjs --bundle_dir skills/clipsmith-web/evals/fixtures/kingson-agent-runtime-skill-ai --profile kingson-agent-runtime-skill-ai` | PASS; 22 headings, no issues |
| `node skills/clipsmith-x/scripts/eval.mjs --fixture x-kingson-skill-runtime-text --profile x-kingson-skill-runtime-text` | PASS; text-only, no issues |
| `git diff --check` | PASS |

The new browser assertion first failed on the original code: the actual
`Target.createTarget` request omitted `background: true`. After the fix, runtime
check, capture, and discovery requests all include that flag and send neither
`Target.activateTarget` nor `Page.bringToFront`. Integration tests also confirm
session reuse, unrelated-tab preservation, successful-tab cleanup, and retained
verification tabs. X's exploration script additionally passed TypeScript syntax
transpilation; it was not run against a live post.

All browser verification ran headlessly against local fixtures. This validates
the CDP request contract without disturbing the user's desktop; it does not
measure macOS foreground focus in a live headed session. Live X login/media
checks and agent-desktop interactions were not performed.

## Provider quality reports

Provider quality gate: PASS

Skill: `clipsmith-web`

Deterministic checks: web integration tests, provider regression, fixture bundle
validation, known-profile eval, and health check listed above all PASS.

Agent AI eval: PASS. Codex inspected the committed fixture's `post.md`,
`summary.md`, `capture.json`, `raw/rendered.txt`, and `raw/metadata.json` against
`prompts/evaluate-article.md`, using its own model judgment.

Notes:

- All eight major article sections remain present and ordered, including the
  architecture comparisons, Skill Loader discussion, and adoption path.
- The summary is supported by the article; title, URL, publication date, empty
  author, and complete status agree with the preserved evidence.
- Raw table-of-contents and previous/next navigation are absent from the cleaned
  article. No invented content or challenge text was found.
- Browser behavior is covered by local CDP integration, rather than inferred
  from a failed headless request to a live site.

Web capture AI eval: PASS

Profile: `kingson-agent-runtime-skill-ai`

Bundle: `skills/clipsmith-web/evals/fixtures/kingson-agent-runtime-skill-ai`

Deterministic eval: the web `scripts/eval.mjs` command above, PASS.

AI eval notes: coverage, noise removal, metadata, summary fidelity, and browser
session behavior pass within the fixture and headless integration scope above.

Provider quality gate: PASS

Skill: `clipsmith-x`

Deterministic checks: X regression, known text fixture eval, shared runtime
tests, and health check listed above all PASS.

Agent AI eval: PASS. Codex inspected the committed
`x-kingson-skill-runtime-text/post.md` against its profile and
`prompts/evaluate-capture.md`, using its own model judgment.

Notes:

- Canonical source URL, handle, post id, timestamp, and reply count are retained
  in the fixture; the post body preserves the runtime/Skills statement.
- This is a single text-only post; zero images, zero videos, and no MHTML are
  expected. No login, retry, feed, or captcha noise is present.
- No new X bundle was produced, so bundle validation is not applicable to this
  raw provider fixture. Live media/article profiles were not exercised.
