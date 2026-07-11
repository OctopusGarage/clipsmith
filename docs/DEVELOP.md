# Development

Run commands from the repo root:

```bash
uv run clipsmith --version
uv run pytest -q
./script/check-health.sh
```

## Layout

```text
src/clipsmith/       Python CLI and protocol code
skills/              provider skills and runners
tests/               Python tests and fixtures
docs/                contracts and contributor notes
script/              maintenance scripts
.claude/             Claude Code commands and agents
.github/workflows/   CI
```

## Capture Loop

```bash
uv run clipsmith capture start "<target>" --state-dir /tmp/clipsmith-state
# run the selected provider skill
uv run clipsmith validate-bundle "<bundle_dir>" --json
uv run clipsmith capture finalize "<job_id_or_job_path>" "<bundle_dir>" --state-dir /tmp/clipsmith-state
```

Optional sinks:

```bash
uv run clipsmith sink directory "<bundle_dir>" "<output_dir>" --json
uv run clipsmith sink inbox "<bundle_dir>" "<inbox_workspace>" --json
```

## Provider Execution

The only supported provider execution mode is `skill`. Keep browser, session,
proxy, CDP, and login strategy in provider skills unless a real non-agent
adapter exists.

## Skill Contract

Every skill directory needs:

- `SKILL.md`
- `agents/openai.yaml`
- `quality-gate.json`

Executable provider skills also need:

- `skill.yaml`
- the executor file referenced by `skill.yaml`

`clipsmith-capture` is a router and may omit `skill.yaml`.

## Quality Gates

`uv run clipsmith quality-gates --json` validates provider quality gate
declarations and returns a typed plan for each skill. Agents and CI should use
that command instead of re-implementing quality gate checks in prompts or shell
snippets.

`./script/check-health.sh` verifies tests, provider JSON, fixture validation,
skill metadata, provider quality gate plans, shell syntax, relative bundle
paths, and basic secret hygiene.

Provider quality rules live in:

- `docs/provider-quality-gate.md`
- `docs/web-capture-ai-eval.md`

When changing a provider, prompt, extraction script, raw evidence policy, or eval
profile, run the relevant deterministic checks and perform the required agent AI
eval before reporting the work ready.

Optional local hooks:

```bash
git config core.hooksPath .githooks
```

CI runs `project-health` on Ubuntu and macOS and runs `gitleaks` on pushes and
PRs to `main`.
