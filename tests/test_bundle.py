import json
from pathlib import Path

from clipsmith.bundle import BundleRepository, BundleValidation, CaptureBundle


FIXTURES = Path(__file__).parent / "fixtures"


def test_valid_bundle_has_no_issues():
    issues = BundleRepository().validate(FIXTURES / "valid-xhs-bundle")

    assert issues == []


def test_validate_result_returns_typed_bundle_issues():
    validation = BundleRepository().validate_result(
        FIXTURES / "invalid-missing-summary"
    )

    assert isinstance(validation, BundleValidation)
    assert not validation.is_valid
    assert validation.to_json_dict() == {
        "issues": [
            {
                "kind": "missing_content_file",
                "path": "summary.md",
                "message": "Required content file is missing: summary.md",
            }
        ]
    }


def test_missing_required_content_file_is_reported():
    issues = BundleRepository().validate(FIXTURES / "invalid-missing-summary")

    assert issues == [
        {
            "kind": "missing_content_file",
            "path": "summary.md",
            "message": "Required content file is missing: summary.md",
        }
    ]


def test_unreferenced_bundle_file_is_reported(tmp_path):
    root = tmp_path / "bundle"
    root.mkdir()
    (root / "post.md").write_text("# Post\n", encoding="utf-8")
    (root / "summary.md").write_text("# Summary\n", encoding="utf-8")
    (root / "image_01.jpg").write_bytes(b"not allowed")
    (root / "capture.json").write_text(
        json.dumps(
            {
                "schema": "clipsmith.capture_bundle.v1",
                "id": "extra-file",
                "platform": "xhs",
                "source_url": "https://www.xiaohongshu.com/explore/abc",
                "content_files": [
                    {
                        "path": "summary.md",
                        "kind": "summary",
                        "required_for_review": True,
                    },
                    {"path": "post.md", "kind": "post", "required_for_review": True},
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
            "kind": "unexpected_bundle_file",
            "path": "image_01.jpg",
            "message": "Bundle file is not allowed: image_01.jpg",
        }
    ]


def test_post_summary_ocr_text_and_ocr_image_assets_are_allowed(tmp_path):
    root = tmp_path / "bundle"
    root.mkdir()
    (root / "post.md").write_text("# OCR Text\n", encoding="utf-8")
    (root / "summary.md").write_text("# Summary\n", encoding="utf-8")
    (root / "ocr.md").write_text("# OCR Transcript\n\nRaw text", encoding="utf-8")
    (root / "ocr-image.jpg").write_bytes(b"ocr image")
    (root / "capture.json").write_text(
        json.dumps(
            {
                "schema": "clipsmith.capture_bundle.v1",
                "id": "ocr-image",
                "platform": "image-ocr",
                "source_url": "/tmp/source.jpg",
                "content_files": [
                    {
                        "path": "summary.md",
                        "kind": "summary",
                        "required_for_review": True,
                    },
                    {"path": "post.md", "kind": "post", "required_for_review": True},
                    {
                        "path": "ocr.md",
                        "kind": "ocr-text",
                        "required_for_review": True,
                    },
                ],
                "assets": [{"path": "ocr-image.jpg", "kind": "ocr-image"}],
                "warnings": [],
                "status": "complete",
            }
        ),
        encoding="utf-8",
    )

    issues = BundleRepository().validate(root)

    assert issues == []


def test_non_ocr_assets_are_reported(tmp_path):
    root = tmp_path / "bundle"
    root.mkdir()
    (root / "post.md").write_text("# Post\n", encoding="utf-8")
    (root / "summary.md").write_text("# Summary\n", encoding="utf-8")
    (root / "image_01.jpg").write_bytes(b"regular media")
    (root / "capture.json").write_text(
        json.dumps(
            {
                "schema": "clipsmith.capture_bundle.v1",
                "id": "media-asset",
                "platform": "xhs",
                "source_url": "https://www.xiaohongshu.com/explore/abc",
                "content_files": [
                    {
                        "path": "summary.md",
                        "kind": "summary",
                        "required_for_review": True,
                    },
                    {"path": "post.md", "kind": "post", "required_for_review": True},
                ],
                "assets": [{"path": "image_01.jpg", "kind": "image"}],
                "warnings": [],
                "status": "complete",
            }
        ),
        encoding="utf-8",
    )

    issues = BundleRepository().validate(root)

    assert issues == [
        {
            "kind": "unsupported_asset_file",
            "path": "image_01.jpg",
            "message": (
                "Only OCR and web raw audit assets are allowed in a bundle: image_01.jpg"
            ),
        }
    ]


def test_web_raw_audit_assets_are_allowed_only_at_fixed_paths(tmp_path):
    root = tmp_path / "bundle"
    raw = root / "raw"
    raw.mkdir(parents=True)
    (root / "post.md").write_text("# Post\n", encoding="utf-8")
    (root / "summary.md").write_text("# Summary\n", encoding="utf-8")
    (raw / "source.html").write_text("<main><p>Article</p></main>\n", encoding="utf-8")
    (raw / "rendered.txt").write_text("Article\n", encoding="utf-8")
    (raw / "metadata.json").write_text("{}\n", encoding="utf-8")
    (root / "capture.json").write_text(
        json.dumps(
            {
                "schema": "clipsmith.capture_bundle.v1",
                "id": "web-article",
                "platform": "web",
                "source_url": "https://example.com/article",
                "content_files": [
                    {
                        "path": "summary.md",
                        "kind": "summary",
                        "required_for_review": True,
                    },
                    {"path": "post.md", "kind": "post", "required_for_review": True},
                ],
                "assets": [
                    {"path": "raw/source.html", "kind": "web-cleaned-html"},
                    {"path": "raw/rendered.txt", "kind": "web-rendered-text"},
                    {"path": "raw/metadata.json", "kind": "web-metadata"},
                ],
                "warnings": [],
                "status": "complete",
            }
        ),
        encoding="utf-8",
    )

    issues = BundleRepository().validate(root)

    assert issues == []


def test_web_raw_audit_asset_wrong_path_is_reported(tmp_path):
    root = tmp_path / "bundle"
    raw = root / "raw"
    raw.mkdir(parents=True)
    (root / "post.md").write_text("# Post\n", encoding="utf-8")
    (root / "summary.md").write_text("# Summary\n", encoding="utf-8")
    (raw / "extra.html").write_text("<main>Extra</main>\n", encoding="utf-8")
    (root / "capture.json").write_text(
        json.dumps(
            {
                "schema": "clipsmith.capture_bundle.v1",
                "id": "web-article",
                "platform": "web",
                "source_url": "https://example.com/article",
                "content_files": [
                    {
                        "path": "summary.md",
                        "kind": "summary",
                        "required_for_review": True,
                    },
                    {"path": "post.md", "kind": "post", "required_for_review": True},
                ],
                "assets": [{"path": "raw/extra.html", "kind": "web-cleaned-html"}],
                "warnings": [],
                "status": "complete",
            }
        ),
        encoding="utf-8",
    )

    issues = BundleRepository().validate(root)

    assert issues == [
        {
            "kind": "unsupported_asset_file",
            "path": "raw/extra.html",
            "message": "Unsupported asset file for kind web-cleaned-html: raw/extra.html",
        }
    ]


def test_unsupported_content_file_is_reported(tmp_path):
    root = tmp_path / "bundle"
    root.mkdir()
    (root / "article.md").write_text("# Article\n", encoding="utf-8")
    (root / "capture.json").write_text(
        json.dumps(
            {
                "schema": "clipsmith.capture_bundle.v1",
                "id": "article-file",
                "platform": "web",
                "source_url": "https://example.com/article",
                "content_files": [
                    {
                        "path": "article.md",
                        "kind": "article",
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
            "kind": "unsupported_content_file",
            "path": "article.md",
            "message": (
                "Only post.md, summary.md, ocr.md, and ocr.txt content files "
                "are allowed: article.md"
            ),
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
