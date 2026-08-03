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

For social-media captures, the validated bundle is not the complete post
archive. It contains reviewable text and metadata only. If a provider raw output
folder contains downloaded images or videos, include it during sink:

```bash
clipsmith sink inbox /path/to/bundle /path/to/inbox-workspace \
  --raw-assets-dir /path/to/raw-output \
  --json
```

The sink copies image/video files into:

```text
<workspace>/inbox/<platform>/<bundle-id>/assets/
```

Do not leave social-media images/videos only in a temporary raw download
directory when the requested destination is an inbox.

Clipsmith owns capture, validation, and generic filesystem sinks. Downstream
consumers own review, notes, archive/search, and knowledge records.

Typical standalone flow:

```bash
clipsmith capture start "https://example.com/article" --state-dir /tmp/clipsmith-state
# run the selected provider skill
clipsmith validate-bundle /path/to/bundle --json
clipsmith capture finalize "<job_id_or_job_path>" /path/to/bundle --state-dir /tmp/clipsmith-state
clipsmith sink inbox /path/to/bundle /path/to/inbox-workspace \
  --raw-assets-dir /path/to/raw-output \
  --json
```
