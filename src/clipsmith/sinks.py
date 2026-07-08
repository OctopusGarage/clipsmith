from __future__ import annotations

from pathlib import Path
import shutil

from clipsmith.bundle import BundleRepository
from clipsmith.errors import BundleError


class DirectorySink:
    def __init__(self, output_dir: Path | str) -> None:
        self.output_dir = Path(output_dir).expanduser()
        self.repository = BundleRepository()

    def write(self, bundle_root: Path | str) -> dict[str, str]:
        bundle_root_path = Path(bundle_root).expanduser()
        bundle = self.repository.read(bundle_root_path)
        bundle_id = _safe_path_segment(bundle.id, label="bundle id")
        target = _unique_target(self.output_dir, bundle_id)

        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(bundle_root_path, target)
        return {"status": "written", "path": str(target)}


class AlcoveInboxSink:
    def __init__(self, workspace: Path | str) -> None:
        self.workspace = Path(workspace).expanduser()
        self.repository = BundleRepository()

    def write(self, bundle_root: Path | str) -> dict[str, str]:
        bundle_root_path = Path(bundle_root).expanduser()
        bundle = self.repository.read(bundle_root_path)
        platform = _safe_path_segment(bundle.platform, label="platform")
        bundle_id = _safe_path_segment(bundle.id, label="bundle id")
        inbox_dir = self.workspace / "inbox" / platform
        target = _unique_target(inbox_dir, bundle_id)

        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(bundle_root_path, target)
        return {"status": "written", "path": str(target)}


def _unique_target(parent: Path, name: str) -> Path:
    target = parent / name
    if not target.exists():
        return target

    suffix = 2
    while True:
        target = parent / f"{name}-{suffix}"
        if not target.exists():
            return target
        suffix += 1


def _safe_path_segment(value: str, *, label: str) -> str:
    if (
        not value
        or Path(value).is_absolute()
        or value in {".", ".."}
        or "/" in value
        or "\\" in value
    ):
        raise BundleError(f"Unsafe sink path segment for {label}: {value}")
    return value
