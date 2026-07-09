# Inbox Integration

The inbox sink copies a validated bundle into a generic filesystem inbox:

```bash
clipsmith sink inbox /path/to/bundle /path/to/inbox-workspace --json
```

Layout:

```text
<workspace>/inbox/<platform>/<bundle-id>/
```

If the target exists, Clipsmith appends `-2`, `-3`, and so on.

Clipsmith owns capture and validation. Downstream consumers own review, notes,
archive/search, and knowledge records.

Typical standalone flow:

```bash
clipsmith capture start "https://example.com/article" --state-dir /tmp/clipsmith-state
# run the selected provider skill
clipsmith validate-bundle /path/to/bundle --json
clipsmith capture finalize "<job_id_or_job_path>" /path/to/bundle --state-dir /tmp/clipsmith-state
clipsmith sink inbox /path/to/bundle /path/to/inbox-workspace --json
```
