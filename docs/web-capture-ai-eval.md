# Web Capture AI Eval

Use this checklist whenever you modify `clipsmith-web`, change a provider skill
that captures article-like web pages, add a new generic article provider, or
capture one of the known web eval URLs.

This eval is intentionally agent-run. CI checks the deterministic eval contract,
but Codex, Claude Code, or another capable coding agent must use its own model
judgment to inspect article quality before reporting the work ready.

## Deterministic Eval

For known profiles, run the local eval after bundle validation:

```bash
cd /Users/kingsonwu/programming/OctopusGarage/clipsmith/skills/clipsmith-web
node scripts/eval.mjs --bundle_dir "<bundle_dir>" --profile "<profile>"
```

Known profiles live in:

```text
skills/clipsmith-web/evals/web-capture-evals.json
```

Current profiles:

- `anthropic-building-effective-agents`
- `openai-core-dump-epidemiology`
- `kingson-agent-runtime-skill-ai`

These profiles and their baselines are source-repo maintenance assets. Packaged
skill installs may omit `evals/`; the runtime skill still includes the prompts
and executor needed for live capture.

## Agent AI Eval

After deterministic checks, read:

```text
skills/clipsmith-web/prompts/evaluate-article.md
```

Then inspect at least:

- `post.md`
- `summary.md`
- `capture.json`
- `raw/rendered.txt`
- `raw/metadata.json`
- deterministic eval output, if a profile exists

The agent must judge:

- the article body is materially complete
- major sections from the raw text are still present and in order
- site chrome, newsletter blocks, related links, tables of contents, and footer
  text were removed
- title, source URL, author, published date, warnings, and status are supported
  by raw evidence
- no content was invented to fill gaps

## Required Report

When this eval is required, the final response or review report must include:

```text
Web capture AI eval: PASS|FAIL
Profile: <profile or none>
Bundle: <bundle_dir or fixture>
Deterministic eval: <command and result, or not applicable>
AI eval notes: <one to five concise bullets>
```

Do not report the change or capture as ready when:

- bundle validation fails
- deterministic eval fails
- AI eval finds missing article sections, unsupported metadata, invented text,
  or remaining page chrome
- the page is a bot challenge, error page, login wall, or incomplete fragment and
  `capture.json.status` is `complete`

If a new provider supports article-like pages, add at least one deterministic
profile before considering it protected against regressions.
