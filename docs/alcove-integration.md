# Alcove Integration

Clipsmith does not depend on Alcove. It can be used standalone, and Alcove can
consume Clipsmith bundles through a filesystem inbox layout.

## Boundary

Clipsmith owns:

- capture provider matching
- capture jobs
- copied capture skills
- bundle validation
- bundle sinks

Alcove owns:

- inbox review
- notes and OKF records
- archive/search/gardener workflows
- MCP/chat-channel knowledge management

## Inbox Sink

Copy a validated bundle into an Alcove-shaped inbox:

```bash
clipsmith sink alcove-inbox /path/to/bundle ~/programming/kingson4wu/entropy-nexus/social_media_posts --json
```

The sink writes to:

```text
<workspace>/inbox/<platform>/<bundle-id>/
```

If the target exists, Clipsmith appends a numeric suffix such as `-2` or `-3`.

## Standalone Capture Then Alcove Import

```bash
clipsmith capture start "https://example.com/article" --state-dir /tmp/clipsmith-state
# Run the selected Clipsmith skill and produce a valid bundle.
clipsmith validate-bundle /path/to/bundle --json
clipsmith capture finalize "<job_id_or_job_path>" /path/to/bundle --state-dir /tmp/clipsmith-state
clipsmith sink alcove-inbox /path/to/bundle ~/programming/kingson4wu/entropy-nexus/social_media_posts --json
```

This keeps data collection decoupled from knowledge management. Other tools can
also create valid Clipsmith bundles and hand them to Alcove through the same
inbox layout.
