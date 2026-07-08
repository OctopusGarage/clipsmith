from pathlib import Path

import pytest

from clipsmith.bundle import BundleRepository, CaptureBundle
from clipsmith.errors import BundleError
from clipsmith.sinks import AlcoveInboxSink, DirectorySink


FIXTURES = Path(__file__).parent / "fixtures"


def test_directory_sink_copies_bundle_to_output_dir(tmp_path):
    result = DirectorySink(tmp_path).write(FIXTURES / "valid-xhs-bundle")

    target = tmp_path / "20260707-example-xhs"
    assert result == {"status": "written", "path": str(target)}
    assert (target / "capture.json").is_file()
    assert (target / "post.md").read_text(encoding="utf-8") == (
        FIXTURES / "valid-xhs-bundle" / "post.md"
    ).read_text(encoding="utf-8")
    assert (target / "image_01.bin").read_bytes() == (
        FIXTURES / "valid-xhs-bundle" / "image_01.bin"
    ).read_bytes()


def test_alcove_inbox_sink_copies_bundle_to_platform_inbox(tmp_path):
    result = AlcoveInboxSink(tmp_path).write(FIXTURES / "valid-xhs-bundle")

    target = tmp_path / "inbox" / "xhs" / "20260707-example-xhs"
    assert result == {"status": "written", "path": str(target)}
    assert (target / "capture.json").is_file()
    assert (target / "summary.md").is_file()


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


def test_alcove_inbox_sink_rejects_unsafe_platform_without_copying_outside(tmp_path):
    bundle_root = _write_bundle(tmp_path / "source", platform="../escaped")
    workspace = tmp_path / "workspace"

    with pytest.raises(BundleError, match="Unsafe sink path segment"):
        AlcoveInboxSink(workspace).write(bundle_root)

    assert not (workspace / "escaped").exists()
    assert not (workspace / "inbox").exists()


def test_alcove_inbox_sink_rejects_unsafe_bundle_id_without_copying_outside(tmp_path):
    bundle_root = _write_bundle(tmp_path / "source", bundle_id="../escaped-id")
    workspace = tmp_path / "workspace"

    with pytest.raises(BundleError, match="Unsafe sink path segment"):
        AlcoveInboxSink(workspace).write(bundle_root)

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
