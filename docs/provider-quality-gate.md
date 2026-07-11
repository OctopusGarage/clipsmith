# Provider Quality Gate

Every Clipsmith provider skill must declare how capture quality is protected.
The goal is to make capture regressions visible to both deterministic tooling and
agent review before a bundle is reported ready.

## Skill Declaration

Each `skills/<name>/` directory must contain:

```text
quality-gate.json
```

Required fields:

- `version`: currently `1`
- `skill`: the skill directory name
- `capture_kind`: `router`, `article`, `social-post`, or `ocr`
- `raw_evidence`: file patterns or bundle fields that preserve source evidence
- `deterministic_checks`: commands or contracts that do not call an LLM
- `agent_ai_eval`: whether Codex, Claude Code, or another capable agent must use
  model judgment before reporting success
- `ready_report`: fields that must be included in the final response or review

## Deterministic Checks

Use the project command as the source of truth for declared quality gates:

```bash
uv run clipsmith quality-gates --json
```

The command validates every `quality-gate.json`, checks referenced agent eval
prompt/report files, validates known web eval profile contracts, and emits a
typed plan that agents can use before running provider-specific checks.

Deterministic checks are stable and suitable for local health checks:

- bundle schema validation
- provider contract validation
- fixed eval profiles for known URLs or fixtures
- path and asset allow-list checks
- regression scripts that do not require login or mutable network state

Health checks must not require live websites or LLM API access.

## Agent AI Eval

Agent AI eval is required when:

- a provider captures article-like text, social post text, OCR text, comments, or
  media metadata for review
- a provider prompt, extraction script, normalization rule, raw evidence policy,
  or eval profile changes
- a known profile URL is captured
- a new provider is added

The agent must inspect the final bundle and raw evidence, not just command
output. It must fail the work when the bundle is incomplete, invented, noisy,
or mislabeled as `complete`.

## Final Report Contract

When a quality gate applies, the agent final response or review must include:

```text
Provider quality gate: PASS|FAIL
Skill: <skill>
Deterministic checks: <commands and results>
Agent AI eval: <PASS|FAIL or not applicable>
Notes: <one to five concise bullets>
```

Do not report a provider change or capture as ready if this report cannot be
produced.

## Adding Providers

When adding a provider:

1. Add `skills/<name>/quality-gate.json`.
2. Add at least one deterministic profile or fixture when the provider has a
   stable public sample.
3. Add an agent eval prompt or reference an existing one.
4. Update `AGENTS.md`, `CLAUDE.md`, or provider-specific skill docs only when
   the provider introduces a new quality rule.
5. Run `./script/check-health.sh`.
