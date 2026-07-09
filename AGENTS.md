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
uv run clipsmith validate-bundle tests/fixtures/valid-xhs-bundle --json
uv run pytest -q
./script/check-health.sh
```

Use `uv run clipsmith ...`; do not assume a global `clipsmith`.

## Skill Contract

Every `skills/<name>/` directory needs:

- `SKILL.md` with matching frontmatter `name`
- `agents/openai.yaml`

Executable skills also need `skill.yaml` and the referenced executor.
`clipsmith-capture` may omit `skill.yaml` because it routes to provider skills.

## Capture Rules

- Produce or repair a bundle before finalizing a capture job.
- Validate bundles before reporting them ready.
- Do not write knowledge records.
- Sink to an external inbox only when explicitly asked.
- Do not fabricate content when login, browser automation, or network access
  fails. Preserve partial assets and report warnings.

## Provider Execution

The only supported provider execution mode is `skill`.

## Git Rules

Do not run `git commit`, `git push`, tagging, release publishing, or history
rewrites unless the user explicitly asks.
