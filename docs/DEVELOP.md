# Clipsmith Development

## Local Setup

```bash
cd /Users/kingsonwu/programming/OctopusGarage/clipsmith
uv run clipsmith --version
uv run pytest -q
./script/check-health.sh
```

The repository uses `uv` for the Python CLI environment. Platform skills may use
their own Node.js or Python project metadata under `skills/<name>/`.

## Repository Layout

```text
src/clipsmith/       # deterministic CLI, bundle, capture, provider, sink code
skills/              # agent-facing capture skills and copied platform runners
tests/               # Python tests and capture-bundle fixtures
docs/                # bundle and integration contracts
script/              # local maintenance scripts
.claude/             # Claude Code commands and review agents
.github/workflows/   # CI health checks
```

## Capture Flow

1. Start a job:

   ```bash
   uv run clipsmith capture start "<target>" --state-dir /tmp/clipsmith-state
   ```

2. Run the selected provider skill.
3. Normalize raw output into a bundle directory containing `capture.json`.
4. Validate the bundle:

   ```bash
   uv run clipsmith validate-bundle "<bundle_dir>" --json
   ```

5. Finalize the job:

   ```bash
   uv run clipsmith capture finalize "<job_id_or_job_path>" "<bundle_dir>" --state-dir /tmp/clipsmith-state
   ```

6. Optionally sink the bundle:

   ```bash
   uv run clipsmith sink directory "<bundle_dir>" "<output_dir>" --json
   uv run clipsmith sink alcove-inbox "<bundle_dir>" "<alcove_workspace>" --json
   ```

## Skill Contract

Every skill must keep Claude Code and Codex in sync:

- `SKILL.md` is the canonical agent instruction.
- `agents/openai.yaml` provides Codex display metadata and default prompt.
- `skill.yaml`, when present, declares executable inputs and an executor path.

The `clipsmith-capture` skill is a router and may omit `skill.yaml`. Provider
skills with runnable scripts should include `skill.yaml`.

## Health Check

Run:

```bash
./script/check-health.sh
```

The health check verifies:

- Python tests pass.
- Provider registry JSON renders.
- The valid fixture bundle validates cleanly.
- Provider registry skills exist under `skills/`.
- Skill frontmatter names match directory names.
- Codex `agents/openai.yaml` files are present and non-empty.
- `skill.yaml` executor paths exist when declared.
- Shell hooks and scripts parse with `bash -n`.
- Fixture bundle paths stay relative to the bundle.
- `.env` is not tracked and `.env.example` does not contain credential-shaped values.

## Local Hooks

Enable optional local git hooks:

```bash
git config core.hooksPath .githooks
```

Hooks:

- `pre-commit` runs `./script/check-health.sh`.
- `pre-push` runs `./script/check-health.sh` and runs `gitleaks` if it is
  installed locally. CI always runs gitleaks, so a missing local binary does not
  block pushes.

## CI Gates

GitHub Actions run:

- `project-health`: `./script/check-health.sh` on Ubuntu and macOS.
- `verify`: a stable aggregate job for branch protection.
- `gitleaks`: full-history secret scanning on `main` pushes and PRs to `main`.

## Claude Code Hook

`.claude/settings.json` installs a light PostToolUse check:

- Python files: `uv run ruff format --check <file>` when ruff is available.
- Shell files: `bash -n <file>`.

This hook is intentionally narrow. The source of truth remains
`./script/check-health.sh`.
