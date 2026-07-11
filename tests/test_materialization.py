import pytest

from clipsmith.errors import BundleError
from clipsmith.materialization import BundleSource, safe_path_segment, unique_target


def test_bundle_source_rejects_invalid_bundle(tmp_path):
    with pytest.raises(BundleError, match="Cannot use invalid bundle"):
        BundleSource().load(tmp_path)


def test_safe_path_segment_rejects_traversal():
    with pytest.raises(BundleError, match="Unsafe test path segment"):
        safe_path_segment("../bad", label="test")


def test_unique_target_adds_numeric_suffix(tmp_path):
    (tmp_path / "bundle").mkdir()
    (tmp_path / "bundle-2").mkdir()

    assert unique_target(tmp_path, "bundle") == tmp_path / "bundle-3"
    assert unique_target(tmp_path, "bundle", suffix=".md") == tmp_path / "bundle.md"
