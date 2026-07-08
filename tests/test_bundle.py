import json
from pathlib import Path

from clipsmith.bundle import BundleRepository, CaptureBundle


FIXTURES = Path(__file__).parent / "fixtures"


def test_valid_bundle_has_no_issues():
    issues = BundleRepository().validate(FIXTURES / "valid-xhs-bundle")

    assert issues == []


def test_missing_required_content_file_is_reported():
    issues = BundleRepository().validate(FIXTURES / "invalid-missing-summary")

    assert issues == [
        {
            "kind": "missing_content_file",
            "path": "summary.md",
            "message": "Required content file is missing: summary.md",
        }
    ]


def test_content_file_path_must_not_escape_bundle_root(tmp_path):
    outside = tmp_path / "outside.md"
    outside.write_text("outside bundle", encoding="utf-8")
    root = tmp_path / "bundle"
    root.mkdir()
    (root / "capture.json").write_text(
        json.dumps(
            {
                "schema": "clipsmith.capture_bundle.v1",
                "id": "unsafe-path",
                "platform": "xhs",
                "source_url": "https://www.xiaohongshu.com/explore/abc",
                "content_files": [
                    {
                        "path": "../outside.md",
                        "kind": "summary",
                        "required_for_review": True,
                    }
                ],
                "assets": [],
                "warnings": [],
                "status": "complete",
            }
        ),
        encoding="utf-8",
    )

    issues = BundleRepository().validate(root)

    assert issues == [
        {
            "kind": "invalid_content_file_path",
            "path": "../outside.md",
            "message": "Content file path must stay within bundle root: ../outside.md",
        }
    ]


def test_asset_path_must_not_escape_bundle_root(tmp_path):
    outside = tmp_path / "outside.bin"
    outside.write_text("outside bundle", encoding="utf-8")
    root = tmp_path / "bundle"
    root.mkdir()
    (root / "capture.json").write_text(
        json.dumps(
            {
                "schema": "clipsmith.capture_bundle.v1",
                "id": "unsafe-asset-path",
                "platform": "xhs",
                "source_url": "https://www.xiaohongshu.com/explore/abc",
                "content_files": [],
                "assets": [{"path": "../outside.bin", "kind": "image"}],
                "warnings": [],
                "status": "complete",
            }
        ),
        encoding="utf-8",
    )

    issues = BundleRepository().validate(root)

    assert issues == [
        {
            "kind": "invalid_asset_file_path",
            "path": "../outside.bin",
            "message": "Asset file path must stay within bundle root: ../outside.bin",
        }
    ]


def test_missing_required_bundle_fields_are_reported(tmp_path):
    root = tmp_path / "bundle"
    root.mkdir()
    (root / "capture.json").write_text(
        json.dumps({"schema": "clipsmith.capture_bundle.v1", "status": "complete"}),
        encoding="utf-8",
    )

    issues = BundleRepository().validate(root)

    assert issues == [
        {
            "kind": "missing_required_field",
            "path": "capture.json",
            "message": "Required field is missing: id",
        },
        {
            "kind": "missing_required_field",
            "path": "capture.json",
            "message": "Required field is missing: platform",
        },
        {
            "kind": "missing_required_field",
            "path": "capture.json",
            "message": "Required field is missing: source_url",
        },
        {
            "kind": "missing_required_field",
            "path": "capture.json",
            "message": "Required field is missing: content_files",
        },
        {
            "kind": "missing_required_field",
            "path": "capture.json",
            "message": "Required field is missing: assets",
        },
        {
            "kind": "missing_required_field",
            "path": "capture.json",
            "message": "Required field is missing: warnings",
        },
    ]


def test_non_object_capture_json_is_reported(tmp_path):
    root = tmp_path / "bundle"
    root.mkdir()
    (root / "capture.json").write_text("[]", encoding="utf-8")

    issues = BundleRepository().validate(root)

    assert issues == [
        {
            "kind": "invalid_capture_json",
            "path": "capture.json",
            "message": "capture.json must contain a JSON object",
        }
    ]


def test_non_object_content_file_or_asset_entry_is_reported(tmp_path):
    root = tmp_path / "bundle"
    root.mkdir()
    (root / "capture.json").write_text(
        json.dumps(
            {
                "schema": "clipsmith.capture_bundle.v1",
                "id": "invalid-entries",
                "platform": "xhs",
                "source_url": "https://www.xiaohongshu.com/explore/abc",
                "content_files": ["summary.md"],
                "assets": ["image_01.bin"],
                "warnings": [],
                "status": "complete",
            }
        ),
        encoding="utf-8",
    )

    issues = BundleRepository().validate(root)

    assert issues == [
        {
            "kind": "invalid_capture_json",
            "path": "capture.json",
            "message": "content_files entries must be JSON objects",
        }
    ]


def test_non_object_asset_entry_is_reported(tmp_path):
    root = tmp_path / "bundle"
    root.mkdir()
    (root / "capture.json").write_text(
        json.dumps(
            {
                "schema": "clipsmith.capture_bundle.v1",
                "id": "invalid-assets",
                "platform": "xhs",
                "source_url": "https://www.xiaohongshu.com/explore/abc",
                "content_files": [],
                "assets": ["image_01.bin"],
                "warnings": [],
                "status": "complete",
            }
        ),
        encoding="utf-8",
    )

    issues = BundleRepository().validate(root)

    assert issues == [
        {
            "kind": "invalid_capture_json",
            "path": "capture.json",
            "message": "assets entries must be JSON objects",
        }
    ]


def test_non_array_warnings_is_reported(tmp_path):
    root = tmp_path / "bundle"
    root.mkdir()
    (root / "capture.json").write_text(
        json.dumps(
            {
                "schema": "clipsmith.capture_bundle.v1",
                "id": "invalid-warnings",
                "platform": "xhs",
                "source_url": "https://www.xiaohongshu.com/explore/abc",
                "content_files": [],
                "assets": [],
                "warnings": "warning",
                "status": "complete",
            }
        ),
        encoding="utf-8",
    )

    issues = BundleRepository().validate(root)

    assert issues == [
        {
            "kind": "invalid_capture_json",
            "path": "capture.json",
            "message": "warnings must be a JSON array",
        }
    ]


def test_read_bundle_returns_typed_data():
    bundle = BundleRepository().read(FIXTURES / "valid-xhs-bundle")

    assert isinstance(bundle, CaptureBundle)
    assert bundle.schema == "clipsmith.capture_bundle.v1"
    assert bundle.platform == "xhs"
    assert bundle.title == "Example XHS Post"


def test_write_bundle_round_trips(tmp_path):
    source = BundleRepository().read(FIXTURES / "valid-xhs-bundle")
    target = tmp_path / "bundle"

    BundleRepository().write(target, source)

    payload = json.loads((target / "capture.json").read_text(encoding="utf-8"))
    assert payload["schema"] == "clipsmith.capture_bundle.v1"
    assert payload["title"] == "Example XHS Post"
