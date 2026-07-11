---
description: Capture a target through Clipsmith, validate the bundle, and optionally sink it.
allowed-tools: Read, Bash
---

Capture `$ARGUMENTS` through the standard workflow.

1. Read `README.md`, `docs/capture-bundle-contract.md`, and the selected
   provider skill.
2. Start the job:

   ```bash
   cd /Users/kingsonwu/programming/OctopusGarage/clipsmith
   uv run clipsmith capture start "$ARGUMENTS" --state-dir /tmp/clipsmith-state
   ```

3. Run the returned provider skill. Reuse its existing script or workflow.
4. Normalize output into a bundle with `capture.json`.
5. For generic web/article captures, run the Web Capture AI Eval from
   `docs/web-capture-ai-eval.md`.
6. Validate and finalize:

   ```bash
   uv run clipsmith validate-bundle "<bundle_dir>" --json
   uv run clipsmith capture finalize "<job_id_or_job_path>" "<bundle_dir>" --state-dir /tmp/clipsmith-state
   ```

7. Sink only if explicitly requested:

   ```bash
   uv run clipsmith sink inbox "<bundle_dir>" "<workspace>" --json
   uv run clipsmith sink directory "<bundle_dir>" "<output_dir>" --json
   ```

Report bundle path, validation result, warnings, and sink path if present.
