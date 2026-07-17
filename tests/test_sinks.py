from pathlib import Path

import pytest

from clipsmith.bundle import BundleRepository, CaptureBundle
from clipsmith.errors import BundleError
from clipsmith.sinks import BundleExporter, DirectorySink, InboxSink


FIXTURES = Path(__file__).parent / "fixtures"


def test_bundle_exporter_owns_copy_and_collision_policy(tmp_path):
    class FakeRepository:
        def read(self, bundle_root):
            assert bundle_root == tmp_path / "source"
            return CaptureBundle(
                schema="clipsmith.capture_bundle.v1",
                id="safe-id",
                platform="xhs",
                source_url="https://example.com/post",
            )

    copies = []

    def record_copy(source, target):
        copies.append((source, target))
        target.mkdir(parents=True)

    (tmp_path / "output" / "safe-id").mkdir(parents=True)
    exporter = BundleExporter(repository=FakeRepository(), copy_tree=record_copy)

    result = exporter.write_bundle(
        tmp_path / "source",
        lambda bundle: (tmp_path / "output", bundle.id, "bundle id"),
    )

    target = tmp_path / "output" / "safe-id-2"
    assert result == {"status": "written", "path": str(target)}
    assert copies == [(tmp_path / "source", target)]


def test_directory_sink_copies_bundle_to_output_dir(tmp_path):
    result = DirectorySink(tmp_path).write(FIXTURES / "valid-xhs-bundle")

    target = tmp_path / "20260707-example-xhs"
    assert result == {"status": "written", "path": str(target)}
    assert (target / "capture.json").is_file()
    assert (target / "post.md").read_text(encoding="utf-8") == (
        FIXTURES / "valid-xhs-bundle" / "post.md"
    ).read_text(encoding="utf-8")
    assert (target / "summary.md").is_file()


def test_inbox_sink_copies_bundle_to_platform_inbox(tmp_path):
    result = InboxSink(tmp_path).write(FIXTURES / "valid-xhs-bundle")

    target = tmp_path / "inbox" / "xhs" / "20260707-example-xhs"
    assert result == {"status": "written", "path": str(target)}
    assert (target / "capture.json").is_file()
    assert (target / "summary.md").is_file()


def test_inbox_sink_copies_raw_social_media_assets_to_item_assets(tmp_path):
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    (raw_dir / "post.md").write_text("# Post\n", encoding="utf-8")
    (raw_dir / "001.webp").write_bytes(b"cover")
    (raw_dir / "video-001.mp4").write_bytes(b"video")
    (raw_dir / "comments" / "images").mkdir(parents=True)
    (raw_dir / "comments" / "images" / "comment-001.jpg").write_bytes(b"comment")

    result = InboxSink(tmp_path).write(
        FIXTURES / "valid-xhs-bundle",
        raw_assets_dir=raw_dir,
    )

    target = tmp_path / "inbox" / "xhs" / "20260707-example-xhs"
    assert result == {
        "status": "written",
        "path": str(target),
        "assets_path": str(target / "assets"),
        "asset_count": "3",
    }
    assert (target / "assets" / "001.webp").read_bytes() == b"cover"
    assert (target / "assets" / "video-001.mp4").read_bytes() == b"video"
    assert (
        target / "assets" / "comments" / "images" / "comment-001.jpg"
    ).read_bytes() == b"comment"
    assert not (target / "assets" / "post.md").exists()


def test_inbox_sink_removes_raw_assets_after_verified_copy(tmp_path):
    workspace = tmp_path / "workspace"
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    (raw_dir / "001.webp").write_bytes(b"cover")
    (raw_dir / "video-001.mp4").write_bytes(b"video")

    result = InboxSink(workspace).write(
        FIXTURES / "valid-xhs-bundle",
        raw_assets_dir=raw_dir,
        cleanup_raw_assets=True,
    )

    assert result["raw_assets_cleanup"] == "removed"
    assert not raw_dir.exists()
    target = Path(result["path"])
    assert (target / "assets" / "001.webp").read_bytes() == b"cover"
    assert (target / "assets" / "video-001.mp4").read_bytes() == b"video"


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
    assert raw_dir.is_symlink()


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
    workspace = tmp_path / "workspace"
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    (raw_dir / "video.mp4").write_bytes(b"video")

    def corrupt_copy(_source, target):
        target.write_bytes(b"corrupt")

    with pytest.raises(BundleError, match="verification failed"):
        InboxSink(workspace, copy_file=corrupt_copy).write(
            FIXTURES / "valid-xhs-bundle",
            raw_assets_dir=raw_dir,
            cleanup_raw_assets=True,
        )

    assert raw_dir.exists()


def test_inbox_sink_keeps_raw_when_no_media_was_copied(tmp_path):
    workspace = tmp_path / "workspace"
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    (raw_dir / "post.md").write_text("# Post\n", encoding="utf-8")

    with pytest.raises(BundleError, match="No raw media assets"):
        InboxSink(workspace).write(
            FIXTURES / "valid-xhs-bundle",
            raw_assets_dir=raw_dir,
            cleanup_raw_assets=True,
        )

    assert raw_dir.exists()


def test_sinks_choose_unique_suffix_for_duplicate_writes(tmp_path):
    sink = DirectorySink(tmp_path)

    first = sink.write(FIXTURES / "valid-xhs-bundle")
    second = sink.write(FIXTURES / "valid-xhs-bundle")
    third = sink.write(FIXTURES / "valid-xhs-bundle")

    assert first["path"] == str(tmp_path / "20260707-example-xhs")
    assert second["path"] == str(tmp_path / "20260707-example-xhs-2")
    assert third["path"] == str(tmp_path / "20260707-example-xhs-3")
    assert (tmp_path / "20260707-example-xhs-2" / "capture.json").is_file()


def test_directory_sink_rejects_unsafe_bundle_id_without_copying_outside(tmp_path):
    bundle_root = _write_bundle(tmp_path / "source", bundle_id="../escaped")
    output_dir = tmp_path / "output"

    with pytest.raises(BundleError, match="Unsafe sink path segment"):
        DirectorySink(output_dir).write(bundle_root)

    assert not (tmp_path / "escaped").exists()
    assert not output_dir.exists()


def test_inbox_sink_rejects_unsafe_platform_without_copying_outside(tmp_path):
    bundle_root = _write_bundle(tmp_path / "source", platform="../escaped")
    workspace = tmp_path / "workspace"

    with pytest.raises(BundleError, match="Unsafe sink path segment"):
        InboxSink(workspace).write(bundle_root)

    assert not (workspace / "escaped").exists()
    assert not (workspace / "inbox").exists()


def test_inbox_sink_rejects_unsafe_bundle_id_without_copying_outside(tmp_path):
    bundle_root = _write_bundle(tmp_path / "source", bundle_id="../escaped-id")
    workspace = tmp_path / "workspace"

    with pytest.raises(BundleError, match="Unsafe sink path segment"):
        InboxSink(workspace).write(bundle_root)

    assert not (workspace / "inbox" / "escaped-id").exists()
    assert not (workspace / "inbox" / "xhs").exists()


def _write_bundle(
    root: Path, *, bundle_id: str = "safe-id", platform: str = "xhs"
) -> Path:
    BundleRepository().write(
        root,
        CaptureBundle(
            schema="clipsmith.capture_bundle.v1",
            id=bundle_id,
            platform=platform,
            source_url="https://example.com/post",
        ),
    )
    return root
