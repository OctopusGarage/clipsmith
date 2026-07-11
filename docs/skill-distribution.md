# Skill Distribution

Clipsmith keeps source-maintenance assets separate from installed skill runtime
assets.

## Install Modes

`clipsmith install` and `install.sh` support two skill installation modes:

- symlink mode: points the agent skill directory at the source checkout
- copy mode: copies a runtime snapshot into the agent skill directory

Symlink mode is for local development. It exposes the source tree exactly as it
exists, including `evals/`, `tests/`, and local dependency directories when they
are present.

Copy mode is for normal use. It excludes development-only assets:

```text
evals/
tests/
node_modules/
.venv/
playwright-report/
test-results/
Python and tool cache directories
```

## Packaged Skills

The Python wheel uses an explicit runtime whitelist in `pyproject.toml`. It
includes only files needed for installed skills, such as:

- `SKILL.md`
- `agents/openai.yaml`
- `skill.yaml`
- executor scripts
- prompts and references
- package manifests and lockfiles
- lightweight quality gate metadata

It does not package source eval fixtures, regression tests, local dependencies,
or virtual environments.

## Eval Assets

Provider eval fixtures and `evals/ai-evals/` baselines are source-repo
maintenance assets. They exist so Codex, Claude Code, CI, and maintainers can
guard extraction quality when changing providers, prompts, OCR behavior, or
normalization rules.

Packaged skill installs may omit those assets. Installed users should still get
the runtime prompts and executors needed for capture.

## Guardrails

Run the project health check before distributing:

```bash
./script/check-health.sh
```

The health check builds a temporary wheel and fails if packaged skills contain:

- `evals/`
- `tests/`
- `node_modules/`
- `.venv/`
- Playwright report or test result directories
- Python cache files

It also verifies that required runtime `SKILL.md` files are present in the
wheel.
