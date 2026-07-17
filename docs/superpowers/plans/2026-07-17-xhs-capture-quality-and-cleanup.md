# XHS Capture Quality and Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make XHS inbox captures select the best evidenced video candidate, stay in the background, preserve interrupted downloads, and remove the exact raw capture directory only after digest-verified finalization.

**Architecture:** Keep browser extraction and Node streaming in the XHS TypeScript provider. Add candidate quality metadata at its selection boundary. Put raw cleanup behind an explicit `InboxSink`/CLI option; the XHS skill always uses it for inbox captures, while other providers keep the current default.

**Tech Stack:** TypeScript, Playwright CDP, Node streams/test runner, Python 3.12, pathlib/hashlib/shutil, pytest, Clipsmith CLI.

---

## Guardrail and file map

Work on the current branch as requested. Stage only the planned files; preserve
all unrelated dirty work.

- `src/clipsmith/sinks.py`, `tests/test_sinks.py`: verified raw cleanup.
- `src/clipsmith/cli.py`, `tests/test_cli.py`: explicit cleanup flag.
- `skills/clipsmith-xhs/scripts/core.ts`, `executor.ts`, `tests/video.test.ts`:
  candidate ranking, diagnostics, background playback, partial preservation.
- `skills/clipsmith-xhs/SKILL.md`, `tests/test_regression.sh`: reusable contract
  and regression gate.

### Task 1: Digest-verified raw cleanup

**Files:**
- Modify: `tests/test_sinks.py`
- Modify: `src/clipsmith/sinks.py`

- [ ] **Step 1: Write failing sink tests**

Add this success test:

```python
def test_inbox_sink_removes_raw_assets_after_verified_copy(tmp_path):
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    (raw_dir / "001.webp").write_bytes(b"cover")
    (raw_dir / "video-001.mp4").write_bytes(b"video")

    result = InboxSink(tmp_path / "workspace").write(
        FIXTURES / "valid-xhs-bundle",
        raw_assets_dir=raw_dir,
        cleanup_raw_assets=True,
    )

    assert result["raw_assets_cleanup"] == "removed"
    assert not raw_dir.exists()
    target = Path(result["path"])
    assert (target / "assets" / "001.webp").read_bytes() == b"cover"
    assert (target / "assets" / "video-001.mp4").read_bytes() == b"video"
```

Each failure test must assert `BundleError` and `raw_dir.exists()`.

Use these exact safety cases:

```python
def test_inbox_sink_keeps_symlinked_raw_directory(tmp_path):
    actual = tmp_path / "actual"
    actual.mkdir()
    (actual / "video.mp4").write_bytes(b"video")
    raw_dir = tmp_path / "raw-link"
    raw_dir.symlink_to(actual, target_is_directory=True)
    with pytest.raises(BundleError, match="Unsafe raw cleanup path"):
        InboxSink(tmp_path / "workspace").write(
            FIXTURES / "valid-xhs-bundle",
            raw_assets_dir=raw_dir,
            cleanup_raw_assets=True,
        )
    assert actual.exists()


@pytest.mark.parametrize("relative", [Path("."), Path("inbox")])
def test_inbox_sink_keeps_workspace_boundaries(tmp_path, relative):
    workspace = tmp_path / "workspace"
    raw_dir = workspace / relative
    raw_dir.mkdir(parents=True, exist_ok=True)
    (raw_dir / "video.mp4").write_bytes(b"video")
    with pytest.raises(BundleError, match="Unsafe raw cleanup path"):
        InboxSink(workspace).write(
            FIXTURES / "valid-xhs-bundle",
            raw_assets_dir=raw_dir,
            cleanup_raw_assets=True,
        )
    assert raw_dir.exists()


def test_inbox_sink_keeps_raw_when_copy_digest_differs(tmp_path):
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    (raw_dir / "video.mp4").write_bytes(b"video")
    sink = InboxSink(tmp_path / "workspace")
    sink._copy_file = lambda source, target: target.write_bytes(b"corrupt")
    with pytest.raises(BundleError, match="verification failed"):
        sink.write(
            FIXTURES / "valid-xhs-bundle",
            raw_assets_dir=raw_dir,
            cleanup_raw_assets=True,
        )
    assert raw_dir.exists()
```

- [ ] **Step 2: Verify RED**

Run `uv run pytest tests/test_sinks.py -q`.

Expected: FAIL because `cleanup_raw_assets` is not accepted.

- [ ] **Step 3: Implement the safety and verification boundary**

Add SHA-256 calculation with `hashlib.file_digest`. Give `InboxSink.__init__()`
an injectable `copy_file: Callable[[Path, Path], object] = shutil.copy2` used by
media copying, so the digest-failure test can corrupt one destination without
patching global state. Refactor media copying to retain `(source, target)`
pairs. Before `shutil.rmtree()` require:

```python
if raw_dir.is_symlink() or not raw_dir.is_dir():
    raise BundleError(f"Unsafe raw cleanup path: {raw_dir}")

resolved = raw_dir.resolve(strict=True)
forbidden = {
    Path(resolved.anchor),
    Path.home().resolve(),
    workspace.resolve(strict=False),
    (workspace / "inbox").resolve(strict=False),
    target.resolve(strict=False),
}
if resolved in forbidden or resolved in target.resolve(strict=False).parents:
    raise BundleError(f"Unsafe raw cleanup path: {raw_dir}")
```

Require at least one media pair. Compare every pair's byte size and SHA-256.
Only then remove the exact resolved raw directory and return
`raw_assets_cleanup: removed`. Default `cleanup_raw_assets=False`.

- [ ] **Step 4: Verify GREEN**

Run `uv run pytest tests/test_sinks.py -q`.

Expected: all sink tests pass; all unsafe or mismatched cases preserve raw.

- [ ] **Step 5: Commit**

```bash
git add src/clipsmith/sinks.py tests/test_sinks.py
git commit -m "feat: safely clean verified inbox raw assets"
```

### Task 2: Expose cleanup through the CLI

**Files:**
- Modify: `tests/test_cli.py`
- Modify: `src/clipsmith/cli.py`

- [ ] **Step 1: Write a failing CLI test**

```python
def test_sink_inbox_cleanup_raw_assets_removes_verified_source(tmp_path, capsys):
    workspace = tmp_path / "workspace"
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    (raw_dir / "001.webp").write_bytes(b"cover")
    code = main([
        "sink", "inbox", str(FIXTURES / "valid-xhs-bundle"), str(workspace),
        "--raw-assets-dir", str(raw_dir), "--cleanup-raw-assets", "--json",
    ])
    result = json.loads(capsys.readouterr().out)
    assert code == 0
    assert result["raw_assets_cleanup"] == "removed"
    assert not raw_dir.exists()
```

- [ ] **Step 2: Verify RED**

Run the named test. Expected: argparse rejects `--cleanup-raw-assets`.

- [ ] **Step 3: Add the CLI option**

```python
inbox_parser.add_argument(
    "--cleanup-raw-assets",
    action="store_true",
    help="Remove the exact raw directory after copied media passes size and SHA-256 verification.",
)
```

Pass the boolean to `InboxSink.write()`.

- [ ] **Step 4: Verify GREEN and commit**

Run `uv run pytest tests/test_cli.py tests/test_sinks.py -q`, then:

```bash
git add src/clipsmith/cli.py tests/test_cli.py
git commit -m "feat: expose verified raw cleanup for inbox sinks"
```

### Task 3: Rank XHS candidates by quality evidence

**Files:**
- Modify: `skills/clipsmith-xhs/tests/video.test.ts`
- Modify: `skills/clipsmith-xhs/scripts/core.ts`
- Modify: `skills/clipsmith-xhs/scripts/executor.ts`

- [ ] **Step 1: Write failing candidate tests**

```ts
test("candidate selection chooses resolution then bitrate", () => {
  const selected = selectPreferredPostVideoCandidate([
    { url: "https://sns-video.xhscdn.com/1080.mp4", source: "state", width: 1920, height: 1080, bitrate: 12_000_000 },
    { url: "https://sns-video.xhscdn.com/4k.mp4", source: "state", width: 3840, height: 2160, bitrate: 6_000_000 },
    { url: "https://sns-video.xhscdn.com/4k-high.mp4", source: "state", width: 3840, height: 2160, bitrate: 9_000_000 },
  ]);
  assert.equal(selected?.url, "https://sns-video.xhscdn.com/4k-high.mp4");
  assert.equal(selected?.selectionBasis, "metadata");
});

test("candidate selection qualifies metadata-free player fallback", () => {
  const selected = selectPreferredPostVideoCandidate([
    { url: "https://sns-video.xhscdn.com/a.mp4", source: "state" },
    { url: "https://sns-video.xhscdn.com/player.mp4", source: "player" },
  ]);
  assert.equal(selected?.url, "https://sns-video.xhscdn.com/player.mp4");
  assert.equal(selected?.selectionBasis, "player-fallback");
});

test("candidate selection chooses the highest declared HLS rendition", () => {
  const selected = selectPreferredPostVideoCandidate([
    { url: "https://sns-video.xhscdn.com/720.m3u8", source: "state", width: 1280, height: 720, bitrate: 3_000_000 },
    { url: "https://sns-video.xhscdn.com/2160.m3u8", source: "state", width: 3840, height: 2160, bitrate: 8_000_000 },
  ]);
  assert.equal(selected?.url, "https://sns-video.xhscdn.com/2160.m3u8");
});
```

- [ ] **Step 2: Verify RED**

Run the video tests. Expected: selector/type exports are missing.

- [ ] **Step 3: Implement deterministic metadata ranking**

Add:

```ts
export interface VideoCandidate {
  url: string;
  source: "state" | "player";
  codec?: string;
  width?: number;
  height?: number;
  frameRate?: number;
  bitrate?: number;
  size?: number;
}

export interface SelectedVideoCandidate extends VideoCandidate {
  selectionBasis: "metadata" | "url-hint" | "player-fallback";
}
```

Preserve numeric metadata present on XHS h264/h265 stream entries. Rank by
pixel count, bitrate, size, frame rate, codec, URL hints, and finally player
source. Keep `selectPreferredPostVideoUrls()` as a compatibility wrapper.
Expose optional candidates/selection on `PostSnapshot`. Log sanitized host/path,
metadata, and selection basis in `executor.ts`; never log signed queries.

- [ ] **Step 4: Verify GREEN and commit**

Run `npx tsx --test skills/clipsmith-xhs/tests/video.test.ts`, then:

```bash
git add skills/clipsmith-xhs/scripts/core.ts skills/clipsmith-xhs/scripts/executor.ts skills/clipsmith-xhs/tests/video.test.ts
git commit -m "feat: rank XHS video candidates by quality evidence"
```

### Task 4: Validate completed video files

**Files:**
- Modify: `skills/clipsmith-xhs/tests/video.test.ts`
- Modify: `skills/clipsmith-xhs/scripts/core.ts`

- [ ] **Step 1: Write failing probe-result tests**

Test a new `parseVideoProbe()` helper with valid 4K video + AAC JSON, missing
video stream JSON, and zero-duration JSON:

```ts
const valid = parseVideoProbe(JSON.stringify({
  streams: [
    { codec_type: "video", codec_name: "hevc", width: 3840, height: 2160, avg_frame_rate: "50/1", bit_rate: "6487781" },
    { codec_type: "audio", codec_name: "aac", bit_rate: "127992" },
  ],
  format: { duration: "11207.568", size: "9281146845", bit_rate: "6624914" },
}));
assert.equal(valid.width, 3840);
assert.equal(valid.height, 2160);
assert.equal(valid.hasAudio, true);
assert.throws(() => parseVideoProbe('{"streams":[],"format":{"duration":"0"}}'));
```

- [ ] **Step 2: Verify RED**

Run the named tests. Expected: `parseVideoProbe` is not exported.

- [ ] **Step 3: Implement ffprobe validation**

After the final `.part` rename, run:

```bash
ffprobe -v error -show_entries format=duration,size,bit_rate:stream=codec_type,codec_name,width,height,avg_frame_rate,bit_rate -of json <video>
```

Parse the result with `parseVideoProbe()`. Reject a missing video stream or
non-positive duration. Return the measured fields with the saved video result
and log resolution, frame rate, codecs, duration, and bitrate. Describe this as
measured output, never as proof of native source resolution.

- [ ] **Step 4: Verify GREEN and commit**

Run the video tests, then:

```bash
git add skills/clipsmith-xhs/scripts/core.ts skills/clipsmith-xhs/tests/video.test.ts
git commit -m "feat: validate completed XHS video streams"
```

### Task 5: Preserve interruptions and align the Skill

**Files:**
- Modify: `skills/clipsmith-xhs/tests/video.test.ts`
- Modify: `skills/clipsmith-xhs/scripts/core.ts`
- Modify: `skills/clipsmith-xhs/tests/test_regression.sh`
- Modify: `skills/clipsmith-xhs/SKILL.md`

- [ ] **Step 1: Write a failing interruption test**

Feed a response stream that emits bytes `[7, 8]` and then errors. Assert no
saved video, one failure, and that `video-001.mp4.part` still contains `[7, 8]`.

- [ ] **Step 2: Verify RED**

Run the named test. Expected: `.part` is absent because the catch block unlinks
it.

- [ ] **Step 3: Preserve the part and update the contract**

Remove only the catch-block unlink. Update `SKILL.md` to require background CDP
playback, qualified quality claims, candidate diagnostics, and:

```bash
uv run clipsmith sink inbox "<bundle_dir>" "<workspace>" \
  --raw-assets-dir "<raw_dir>" \
  --cleanup-raw-assets \
  --json
```

Require `raw_assets_cleanup: removed` before completion. Preserve raw and part
files on every failed or partial path. Keep video tests in the regression shell.

- [ ] **Step 4: Verify GREEN and commit**

Run `bash skills/clipsmith-xhs/tests/test_regression.sh`, then:

```bash
git add skills/clipsmith-xhs/SKILL.md skills/clipsmith-xhs/scripts/core.ts skills/clipsmith-xhs/tests/video.test.ts skills/clipsmith-xhs/tests/test_regression.sh
git commit -m "fix: preserve interrupted XHS captures and clean finalized raw data"
```

### Task 6: Full verification

- [ ] Run `uv run pytest tests/test_sinks.py tests/test_cli.py -q`.
- [ ] Run `bash skills/clipsmith-xhs/tests/test_regression.sh`.
- [ ] Run `uv run ruff format --check src/clipsmith/sinks.py src/clipsmith/cli.py tests/test_sinks.py tests/test_cli.py`.
- [ ] Run `git diff --check`, `git status --short`, and `git log --oneline -8`.
- [ ] Confirm implementation commits contain only planned files and unrelated
  pre-existing changes remain untouched.
