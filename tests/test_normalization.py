import json

import pytest

from clipsmith.bundle import BundleRepository
from clipsmith.errors import BundleError
from clipsmith.normalization import RawCaptureNormalizationRequest, RawCaptureNormalizer


def test_normalizer_writes_valid_xhs_bundle_with_ocr(tmp_path):
    raw_dir = tmp_path / "raw-xhs"
    raw_dir.mkdir()
    (raw_dir / "post.md").write_text(
        "# Skill 可能比 Agent 更像长期资产\n\n"
        "Source: http://xhslink.com/o/3DeHS3JuRiS\n\n"
        "这是一篇关于 Skill 长期复用价值的小红书笔记。\n",
        encoding="utf-8",
    )
    (raw_dir / "ocr.md").write_text(
        "# OCR\n\n## Image 001\n\nLoop engineering\n",
        encoding="utf-8",
    )
    bundle_dir = tmp_path / "20260711-xhs-skill-asset"

    result = RawCaptureNormalizer().normalize(
        RawCaptureNormalizationRequest(
            provider="xhs",
            raw_dir=raw_dir,
            bundle_dir=bundle_dir,
            source_url="http://xhslink.com/o/3DeHS3JuRiS",
            canonical_url="https://www.xiaohongshu.com/explore/example",
            title="Skill 可能比 Agent 更像长期资产",
            author="Kingson Wu",
            captured_at="2026-07-11T17:30:00+09:00",
        )
    )

    assert result.to_json_dict() == {
        "status": "written",
        "path": str(bundle_dir),
        "issues": [],
    }
    assert BundleRepository().validate(bundle_dir) == []
    bundle = json.loads((bundle_dir / "capture.json").read_text(encoding="utf-8"))
    assert bundle["id"] == "20260711-xhs-skill-asset"
    assert bundle["platform"] == "xhs"
    assert bundle["content_files"] == [
        {"path": "summary.md", "kind": "summary", "required_for_review": True},
        {"path": "post.md", "kind": "post", "required_for_review": True},
        {"path": "ocr.md", "kind": "ocr-text", "required_for_review": True},
    ]
    assert "Skill 可能比 Agent 更像长期资产" in (bundle_dir / "summary.md").read_text(
        encoding="utf-8"
    )
    assert "Loop engineering" in (bundle_dir / "ocr.md").read_text(encoding="utf-8")


def test_normalizer_converts_wechat_article_to_post(tmp_path):
    raw_dir = tmp_path / "raw-wechat"
    raw_dir.mkdir()
    (raw_dir / "article.md").write_text(
        "# 王阳明心学\n\n"
        "Source: https://mp.weixin.qq.com/s/cwvelGaEzQKHfultsDjDUg\n\n"
        "这篇文章讨论知行合一与长期主义。\n",
        encoding="utf-8",
    )
    bundle_dir = tmp_path / "20260711-wechat-wang-yangming"

    RawCaptureNormalizer().normalize(
        RawCaptureNormalizationRequest(
            provider="wechat",
            raw_dir=raw_dir,
            bundle_dir=bundle_dir,
            source_url="https://mp.weixin.qq.com/s/cwvelGaEzQKHfultsDjDUg",
            title="王阳明心学",
            author="Kingson Wu",
        )
    )

    assert BundleRepository().validate(bundle_dir) == []
    assert (
        (bundle_dir / "post.md").read_text(encoding="utf-8").startswith("# 王阳明心学")
    )
    assert not (bundle_dir / "article.md").exists()
    bundle = BundleRepository().read(bundle_dir)
    assert bundle.platform == "wechat"
    assert [content.path for content in bundle.content_files] == [
        "summary.md",
        "post.md",
    ]


def test_normalizer_rejects_raw_dir_without_primary_content(tmp_path):
    raw_dir = tmp_path / "raw-empty"
    raw_dir.mkdir()

    with pytest.raises(BundleError, match="post.md or article.md"):
        RawCaptureNormalizer().normalize(
            RawCaptureNormalizationRequest(
                provider="x",
                raw_dir=raw_dir,
                bundle_dir=tmp_path / "bundle",
                source_url="https://x.com/kingson4wu/status/example",
            )
        )
