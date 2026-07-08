# AGENTS.md

This file gives Codex and other coding agents the operating rules for this
repository.

## Project Role

Clipsmith is a local-first capture toolkit. It turns posts, articles, media, and
OCR output into portable `clipsmith.capture_bundle.v1` directories.

Clipsmith owns capture protocol work:

- provider matching
- capture job metadata
- bundle validation
- filesystem sinks
- platform capture skills under `skills/`

Clipsmith does not own knowledge management. Alcove or another consumer reads a
validated bundle and decides how to review, archive, or write knowledge.

## Commands

Run from the repository root:

```bash
uv run clipsmith providers --json
uv run clipsmith validate-bundle tests/fixtures/valid-xhs-bundle --json
uv run pytest -q
./script/check-health.sh
```

Use `uv run clipsmith ...` for local development. Do not assume a globally
installed `clipsmith` executable exists.

## Skill Contract

Every skill directory under `skills/` must include:

- `SKILL.md` with frontmatter `name` matching the directory name.
- `agents/openai.yaml` for Codex-compatible display metadata and default prompt.

Executable skills should also include:

- `skill.yaml` with an `executor` path.
- The referenced executor file.

The routing skill `clipsmith-capture` may omit `skill.yaml`; it delegates to
provider skills selected by `clipsmith capture start`.

## Capture Rules

- Always produce or repair a bundle before finalizing a capture job.
- Always run `uv run clipsmith validate-bundle "<bundle_dir>" --json` before
  reporting a bundle as ready.
- Never write OKF records or knowledge notes from Clipsmith.
- Only sink to an Alcove workspace when the user explicitly asks for that sink.
- Do not fabricate captured content when browser automation, login, or network
  access fails. Preserve partial assets and report warnings.

## Git Rules

Do not run `git commit`, `git push`, tagging, release publishing, or
history-rewriting commands unless the user explicitly asks for them.
