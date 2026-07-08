# CLAUDE.md

This file gives Claude Code project guidance for Clipsmith.

## Project Role

Clipsmith is a CLI + agent-skill toolkit for capturing social posts, web
articles, local media, and OCR output into portable local bundles.

The boundary is strict:

- Clipsmith captures and validates bundles.
- Alcove or another consumer reviews, archives, searches, and writes knowledge.

## Common Commands

```bash
uv run clipsmith providers --json
uv run clipsmith capture start "<url-or-file>" --state-dir /tmp/clipsmith-state
uv run clipsmith validate-bundle "<bundle_dir>" --json
uv run clipsmith capture finalize "<job_id_or_job_path>" "<bundle_dir>" --state-dir /tmp/clipsmith-state
uv run clipsmith sink directory "<bundle_dir>" "<output_dir>" --json
uv run clipsmith sink alcove-inbox "<bundle_dir>" "<alcove_workspace>" --json
uv run pytest -q
./script/check-health.sh
```

## Claude Code Commands

- `/capture <url-or-file>` follows the standard Clipsmith capture workflow.
- `/health` runs the full repository health check.

## Skill Maintenance

Each `skills/<name>/` directory must have:

- `SKILL.md`
- `agents/openai.yaml`

Executable provider skills should also have:

- `skill.yaml`
- the `executor` file referenced by `skill.yaml`

Run `./script/check-health.sh` after adding or editing a skill.

## Capture Rules

- Run the provider skill shown by `uv run clipsmith capture start`.
- Normalize raw downloader output into a bundle with `capture.json`.
- Validate the bundle before finalizing or sinking it.
- Do not write knowledge records from this repo.
- Do not sink into Alcove unless the user explicitly asks for it.
- Report login walls, bot protection, missing sessions, partial captures, and
  validation issues directly.
