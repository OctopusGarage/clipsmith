# Clipsmith

[![project-health](https://github.com/OctopusGarage/clipsmith/actions/workflows/project-health.yml/badge.svg)](https://github.com/OctopusGarage/clipsmith/actions/workflows/project-health.yml)
[![gitleaks](https://github.com/OctopusGarage/clipsmith/actions/workflows/gitleaks.yml/badge.svg)](https://github.com/OctopusGarage/clipsmith/actions/workflows/gitleaks.yml)
[![Python >=3.12](https://img.shields.io/badge/python-%3E%3D3.12-3776AB?logo=python&logoColor=white)](pyproject.toml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![uv](https://img.shields.io/badge/managed%20with-uv-654FF0)](https://github.com/astral-sh/uv)
[![Ruff](https://img.shields.io/badge/code%20style-ruff-261230)](https://docs.astral.sh/ruff/)

Clipsmith captures posts, articles, local media, and OCR output into portable
`clipsmith.capture_bundle.v1` directories.

- CLI: provider matching, jobs, validation, sinks, install, doctor.
- Skills: platform capture with browser sessions, proxies, CDP, and login state.
- Consumers: read validated bundles and decide how to review, archive, or index.

## Install

```bash
uv tool install --force git+https://github.com/OctopusGarage/clipsmith.git
clipsmith install --all
clipsmith doctor
```

Restart Codex or Claude Code after installing skills.

Source checkout:

```bash
git clone https://github.com/OctopusGarage/clipsmith.git
cd clipsmith
./install.sh --all
```

More install options: [INSTALL.md](INSTALL.md).

## Capture With An Agent

After installing skills, use the same prompt in Codex or Claude Code:

```text
Use clipsmith-capture to capture https://example.com/post
```

To request a sink, say it explicitly:

```text
Use clipsmith-capture to capture https://example.com/post and sink it to /path/to/inbox-workspace
```

Claude Code also has repo-local shortcuts:

```text
/capture https://example.com/post
/health
```

## CLI

Use the CLI for deterministic protocol work:

```bash
clipsmith providers --json
clipsmith capture start "https://example.com/post" --state-dir /tmp/clipsmith-state
clipsmith validate-bundle /path/to/bundle --json
clipsmith capture finalize "<job_id_or_job_path>" /path/to/bundle --state-dir /tmp/clipsmith-state
clipsmith sink directory /path/to/bundle ~/Downloads/clips --json
clipsmith sink inbox /path/to/bundle /path/to/inbox-workspace --json
```

In a source checkout, use `uv run clipsmith ...`.

## Workflow

1. `capture start` selects a provider and creates a job.
2. The provider skill captures and normalizes output into a bundle.
3. `validate-bundle` checks the bundle contract.
4. `capture finalize` marks the job done.
5. A sink copies the bundle only when requested.

Current provider execution mode is `skill`.

## Output

Typical bundle:

```text
20260707-example-xhs/
  capture.json
  post.md
  summary.md
  ocr.md      # present when OCR text was produced
```

When OCR is performed during capture, the raw OCR transcript must be preserved
as `ocr.md` or `ocr.txt` and declared in `capture.json.content_files` with
`kind: "ocr-text"`. `summary.md` may summarize OCR output, but it must not be
the only place where OCR text is stored. For image OCR captures, the original
OCR picture may also be preserved as a separate `ocr-image` asset.

Sinks:

- `directory`: `<output_dir>/<bundle-id>/`
- `inbox`: `<workspace>/inbox/<platform>/<bundle-id>/`

## Development

```bash
uv run pytest -q
./script/check-health.sh
```

## Docs

- [Project Page](https://octopusgarage.github.io/clipsmith/)
- [Install](INSTALL.md)
- [Release](RELEASE.md)
- [Development](docs/DEVELOP.md)
- [Capture Bundle Contract](docs/capture-bundle-contract.md)
- [Inbox Integration](docs/inbox-integration.md)
