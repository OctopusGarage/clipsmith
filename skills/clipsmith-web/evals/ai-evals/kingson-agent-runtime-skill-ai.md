# Web Fixture AI Eval: kingson-agent-runtime-skill-ai

- verdict: PASS
- metadata: `capture.json` preserves the source URL, canonical URL, cleaned title, publish timestamp, complete status, and raw audit assets.
- coverage: `post.md` preserves the major sections about LLM, Agent, Tool, Skill, self-built Agent architecture, Agent Runtime + Skill architecture, Skill Loader, MCP, Coding Agent, architecture convergence, landing path, and conclusion.
- structure: The normalized Markdown uses one top-level title, section headings, tables, blockquotes, and text diagrams. It does not leave the article as one raw text dump.
- summary: `summary.md` captures the article's main argument that Agent Runtime is becoming infrastructure and Skill is the durable asset.
- noise: Site title suffix, tags, share controls, table-of-contents footer, navigation, and related-post chrome are removed from `post.md`.
- actions: None for this fixture. Future changes must pass deterministic eval and keep raw audit files declared in `capture.json.assets`.
