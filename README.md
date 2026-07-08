# Clipsmith

Clipsmith is an independent CLI + agent-skill toolkit for capturing posts,
articles, local media, and OCR output into portable local bundles.

It owns deterministic protocol work:

- provider matching
- capture job metadata
- bundle validation
- filesystem sinks

Agent skills own browser/session-sensitive work such as XHS, X, WeChat, generic
web capture, and macOS Vision OCR. Clipsmith does not write OKF knowledge
records.

## Commands

```bash
clipsmith providers --json
clipsmith validate-bundle /path/to/bundle --json
clipsmith capture start "https://example.com/post" --state-dir /tmp/clipsmith-state
clipsmith capture finalize "<job_id_or_job_path>" /path/to/bundle --state-dir /tmp/clipsmith-state
clipsmith sink directory /path/to/bundle ~/Downloads/clips --json
clipsmith sink alcove-inbox /path/to/bundle ~/programming/kingson4wu/entropy-nexus/social_media_posts --json
```

## Install

Install CLI directly from GitHub:

```bash
uv tool install --force git+https://github.com/OctopusGarage/clipsmith.git
clipsmith --version
```

Install CLI plus Claude Code/Codex skills from a clone:

```bash
git clone https://github.com/OctopusGarage/clipsmith.git
cd clipsmith
./install.sh --all
```

See [INSTALL.md](INSTALL.md) for CLI-only, skills-only, copy mode, and uninstall
options.

## Capture Flow

1. Start a capture job with `clipsmith capture start`.
2. Run the provider skill shown by the selected provider:
   - `clipsmith-xhs`
   - `clipsmith-x`
   - `clipsmith-wechat`
   - `clipsmith-web`
   - `clipsmith-ocr`
3. Convert raw downloader output through the `raw-output-to-capture.json`
   normalization step so the output directory contains a valid `capture.json`.
4. Run `clipsmith validate-bundle`.
5. Finalize the job with `clipsmith capture finalize`.
6. Optionally copy the bundle to a directory sink or Alcove inbox sink.

## Skills

The `skills/` directory contains copied and adapted capture skills. Heavy local
dependency caches such as `node_modules` and `.venv` are intentionally excluded;
the skill runners bootstrap dependencies through package manager metadata when
needed.

Each skill carries both Claude Code and Codex-facing metadata:

- `SKILL.md` for agent instructions.
- `agents/openai.yaml` for Codex display metadata and default prompt.
- `skill.yaml` for executable skill runners when applicable.

## Agent Workflows

Claude Code project commands:

- `/capture <url-or-file>` starts the standard Clipsmith capture workflow.
- `/health` runs the project health check.

Codex and other coding agents should read `AGENTS.md` before modifying the
project.

## Development

```bash
uv run pytest -q
./script/check-health.sh
```

`check-health.sh` validates the Python CLI, fixture bundle, provider registry,
and skill metadata expected by Claude Code and Codex.

Optional local hooks can mirror the CI gates:

```bash
git config core.hooksPath .githooks
```

CI runs project health on Ubuntu and macOS, plus gitleaks secret scanning for
PRs to `main`.

## Docs

- [Install](INSTALL.md)
- [Release](RELEASE.md)
- [Development](docs/DEVELOP.md)
- [Capture Bundle Contract](docs/capture-bundle-contract.md)
- [Alcove Integration](docs/alcove-integration.md)
