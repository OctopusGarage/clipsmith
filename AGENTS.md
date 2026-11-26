# AGENTS.md

Rules for Codex and other coding agents in this repo.

## Role

Clipsmith captures posts, articles, media, and OCR output into portable
`clipsmith.capture_bundle.v1` directories.

Clipsmith owns provider matching, capture jobs, validation, sinks, and bundled
provider skills. Downstream consumers own review, archive, search, and knowledge
records.

## Commands

```bash
uv run clipsmith providers --json
uv run clipsmith quality-gates --json
uv run clipsmith validate-bundle tests/fixtures/valid-xhs-bundle --json
uv run pytest -q
./script/check-health.sh
```

Use `uv run clipsmith ...`; do not assume a global `clipsmith`.

## Skill Contract

Every `skills/<name>/` directory needs:

- `SKILL.md` with matching frontmatter `name`
- `agents/openai.yaml`
- `quality-gate.json`

Executable skills also need `skill.yaml` and the referenced executor.
`clipsmith-capture` may omit `skill.yaml` because it routes to provider skills.

Provider quality gates are defined in `docs/provider-quality-gate.md`. When
modifying a provider skill, adding a provider, or changing extraction prompts,
run the relevant deterministic checks and use Codex's own model judgment for the
required agent AI eval before reporting success.

Distribution hygiene is defined in `docs/skill-distribution.md`. Do not package
source-only evals, tests, local dependencies, or virtual environments into
runtime skill installs.

## Capture Rules

- Produce or repair a bundle before finalizing a capture job.
- Validate bundles before reporting them ready.
- For generic web/article captures or changes to web/article provider skills,
  run the Web Capture AI Eval in `docs/web-capture-ai-eval.md`. Codex must use
  its own model judgment for this eval, not only deterministic tests.
- For any provider change, include the `Provider quality gate: PASS|FAIL` report
  required by `docs/provider-quality-gate.md`.
- Do not write knowledge records.
- Sink to an external inbox only when explicitly asked.
- When sinking social-media captures that have a provider raw output folder,
  use `clipsmith sink inbox --raw-assets-dir <raw_dir>` so downloaded images and
  videos land under the destination `assets/` directory. The validated bundle
  stays lightweight.
- Do not fabricate content when login, browser automation, or network access
  fails. Preserve partial assets and report warnings.

## Provider Execution

The only supported provider execution mode is `skill`.

## Browser Focus

- Preserve the user's foreground app, selected browser tab, and keyboard focus.
- Prefer headless capture when supported. For authenticated Chrome, reuse CDP
  and create tabs with the shared `createBackgroundPage` helper; launch dedicated
  Chrome with `open -g -na`. This applies to capture, discovery, checks, and debug
  scripts as well as agent-driven recovery.
- Do not call `bringToFront()`, activate apps, or use global keyboard/mouse input
  as an automatic fallback. Leave verification tabs in the background and report
  any step that requires user interaction.
- If CDP cannot perform a required desktop interaction, consider
  [agent-desktop](https://github.com/vercel-labs/agent-desktop) in its default
  accessibility mode. Check its installed version's help and permissions first;
  do not use `--headed` or physical input to bypass a background-mode failure.
  Manual login or another unavoidable foreground action remains user-driven.

## Git Rules

Do not run `git commit`, `git push`, tagging, release publishing, or history
rewrites unless the user explicitly asks.
