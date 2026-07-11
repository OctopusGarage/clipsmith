from pathlib import Path

import pytest

from clipsmith.errors import BundleError
from clipsmith.okf import OkfExporter


FIXTURES = Path(__file__).parent / "fixtures"


def test_okf_exporter_writes_concept_markdown_with_frontmatter(tmp_path):
    result = OkfExporter(tmp_path).write(FIXTURES / "valid-xhs-bundle")

    target = tmp_path / "xhs" / "20260707-example-xhs.md"
    assert result == {"status": "written", "path": str(target)}
    text = target.read_text(encoding="utf-8")

    assert text.startswith("---\n")
    assert 'type: "Social Post"\n' in text
    assert 'title: "Example XHS Post"\n' in text
    assert 'description: "Captured xhs post from Example Author."\n' in text
    assert 'resource: "https://www.xiaohongshu.com/explore/abc"\n' in text
    assert 'tags: ["clipsmith", "xhs", "social-post"]\n' in text
    assert 'timestamp: "2026-07-07T15:30:00+08:00"\n' in text
    assert 'clipsmith_bundle_id: "20260707-example-xhs"\n' in text
    assert "# Example XHS Post\n\nRaw post content." in text
    assert "# Capture Summary\n" in text
    assert (
        "# Citations\n\n[1] [Source](https://www.xiaohongshu.com/explore/abc)" in text
    )


def test_okf_exporter_rejects_invalid_bundle(tmp_path):
    bundle = tmp_path / "bundle"
    bundle.mkdir()

    with pytest.raises(BundleError, match="Cannot export invalid bundle"):
        OkfExporter(tmp_path / "okf").write(bundle)
