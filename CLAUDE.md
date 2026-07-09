# CLAUDE.md

Claude Code guidance for Clipsmith.

## Commands

```bash
uv run clipsmith providers --json
uv run clipsmith capture start "<url-or-file>" --state-dir /tmp/clipsmith-state
uv run clipsmith validate-bundle "<bundle_dir>" --json
uv run clipsmith capture finalize "<job_id_or_job_path>" "<bundle_dir>" --state-dir /tmp/clipsmith-state
uv run clipsmith sink directory "<bundle_dir>" "<output_dir>" --json
uv run clipsmith sink inbox "<bundle_dir>" "<inbox_workspace>" --json
uv run pytest -q
./script/check-health.sh
```

## Project Commands

- `/capture <url-or-file>` captures through the selected provider skill.
- `/health` runs `./script/check-health.sh`.

## Rules

- Validate every bundle before finalizing or sinking it.
- Keep browser/session/proxy/CDP/login strategy inside provider skills.
- Do not write knowledge records.
- Sink to an external inbox only when explicitly asked.
- Report login walls, bot protection, missing sessions, partial captures, and
  validation issues directly.

## Skill Maintenance

Every `skills/<name>/` needs `SKILL.md` and `agents/openai.yaml`. Executable
provider skills also need `skill.yaml` and the referenced executor.
