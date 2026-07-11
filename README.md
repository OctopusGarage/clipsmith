# Clipsmith

[![project-health](https://github.com/OctopusGarage/clipsmith/actions/workflows/project-health.yml/badge.svg)](https://github.com/OctopusGarage/clipsmith/actions/workflows/project-health.yml)
[![gitleaks](https://github.com/OctopusGarage/clipsmith/actions/workflows/gitleaks.yml/badge.svg)](https://github.com/OctopusGarage/clipsmith/actions/workflows/gitleaks.yml)
[![Python >=3.12](https://img.shields.io/badge/python-%3E%3D3.12-3776AB?logo=python&logoColor=white)](pyproject.toml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![uv](https://img.shields.io/badge/managed%20with-uv-654FF0)](https://github.com/astral-sh/uv)

Clipsmith captures posts, articles, local media, and OCR output into portable
`clipsmith.capture_bundle.v1` directories.

It is split into:

- a Python CLI for provider routing, bundle validation, jobs, sinks, install,
  and doctor checks
- agent skills for platform capture in Codex and Claude Code
- provider quality gates that combine deterministic checks with agent-run AI
  eval where extraction quality needs model judgment

## Install

```bash
uv tool install --force git+https://github.com/OctopusGarage/clipsmith.git
clipsmith install --all
clipsmith doctor
```

Restart Codex or Claude Code after installing skills.

For a source checkout:

```bash
git clone https://github.com/OctopusGarage/clipsmith.git
cd clipsmith
./install.sh --all
```

More options: [INSTALL.md](INSTALL.md).

## Use

After installing skills, ask an agent:

```text
Use clipsmith-capture to capture https://example.com/post
```

To sink a validated bundle to a workspace inbox, say so explicitly:

```text
Use clipsmith-capture to capture https://example.com/post and sink it to /path/to/inbox-workspace
```

Useful CLI commands:

```bash
clipsmith providers --json
clipsmith quality-gates --json
clipsmith validate-bundle /path/to/bundle --json
clipsmith export okf /path/to/bundle /path/to/okf-workspace --json
clipsmith sink directory /path/to/bundle ~/Downloads/clips --json
clipsmith sink inbox /path/to/bundle /path/to/inbox-workspace --json
```

In a source checkout, use `uv run clipsmith ...`.

## Develop

```bash
uv run pytest -q
./script/check-health.sh
```

`check-health` is the project gate: it runs tests, validates skill contracts,
checks quality gate declarations, and verifies packaged skills do not include
development-only assets.

## Docs

- [Install](INSTALL.md)
- [Development](docs/DEVELOP.md)
- [Capture Bundle Contract](docs/capture-bundle-contract.md)
- [Provider Quality Gate](docs/provider-quality-gate.md)
- [Web Capture AI Eval](docs/web-capture-ai-eval.md)
- [OKF Export](docs/okf-export.md)
- [Skill Distribution](docs/skill-distribution.md)
- [Inbox Integration](docs/inbox-integration.md)
- [Release](RELEASE.md)
- [Project Page](https://octopusgarage.github.io/clipsmith/)
