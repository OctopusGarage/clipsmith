## Summary

<!-- One sentence describing what this changes and why. -->

## Checklist

- [ ] `./script/check-health.sh` passes
- [ ] `uv run pytest -q` passes
- [ ] `uv run clipsmith validate-bundle tests/fixtures/valid-xhs-bundle --json` passes
- [ ] New or changed provider skills include `SKILL.md`, `skill.yaml` when executable, and `agents/openai.yaml`
- [ ] Skill distribution changes keep source-only `evals/`, `tests/`, local dependencies, and virtual environments out of packaged runtime skills
- [ ] Bundle contract changes are documented in `docs/capture-bundle-contract.md`
- [ ] OKF export behavior changes are documented in `docs/okf-export.md`
- [ ] No secrets, tokens, private cookies, or real session paths are committed
