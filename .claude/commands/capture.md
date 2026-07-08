---
description: Start a Clipsmith capture, route to the selected provider skill, validate/finalize the bundle, and optionally sink it.
allowed-tools: Read, Bash
---

Capture the user-provided target (`$ARGUMENTS`) through the standard Clipsmith
workflow.

1. Read `README.md`, `docs/capture-bundle-contract.md`, and the selected
   provider skill before acting.
2. Start a capture job:

   ```bash
   cd /Users/kingsonwu/programming/OctopusGarage/clipsmith
   uv run clipsmith capture start "$ARGUMENTS" --state-dir /tmp/clipsmith-state
   ```

3. Route to the returned provider skill:
   - `clipsmith-xhs`
   - `clipsmith-x`
   - `clipsmith-wechat`
   - `clipsmith-web`
   - `clipsmith-ocr`
4. Run the skill's existing script or workflow. Do not hand-write replacement
   browser automation when a skill script exists.
5. Normalize output into a bundle containing `capture.json`.
6. Validate before reporting success:

   ```bash
   uv run clipsmith validate-bundle "<bundle_dir>" --json
   ```

7. Finalize:

   ```bash
   uv run clipsmith capture finalize "<job_id_or_job_path>" "<bundle_dir>" --state-dir /tmp/clipsmith-state
   ```

8. Sink only if the user explicitly requested it:

   ```bash
   uv run clipsmith sink alcove-inbox "<bundle_dir>" "<workspace>" --json
   uv run clipsmith sink directory "<bundle_dir>" "<output_dir>" --json
   ```

Report the bundle path, validation result, warnings, and sink path if any.
