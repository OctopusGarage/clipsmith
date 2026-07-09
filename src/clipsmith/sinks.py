from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
import shutil

from clipsmith.bundle import BundleRepository, CaptureBundle
from clipsmith.errors import BundleError


type DestinationSelector = Callable[[CaptureBundle], tuple[Path, str, str]]
type CopyTree = Callable[[Path, Path], object]


class BundleExporter:
    def __init__(
        self,
        *,
        repository: BundleRepository | None = None,
        copy_tree: CopyTree = shutil.copytree,
    ) -> None:
        self.repository = repository or BundleRepository()
        self._copy_tree = copy_tree

    def write_bundle(
        self,
        bundle_root: Path | str,
        destination_for_bundle: DestinationSelector,
    ) -> dict[str, str]:
        bundle_root_path = Path(bundle_root).expanduser()
        bundle = self.repository.read(bundle_root_path)
        parent, name, label = destination_for_bundle(bundle)
        target = _unique_target(parent, _safe_path_segment(name, label=label))

        target.parent.mkdir(parents=True, exist_ok=True)
        self._copy_tree(bundle_root_path, target)
        return {"status": "written", "path": str(target)}


class DirectorySink:
    def __init__(self, output_dir: Path | str) -> None:
        self.output_dir = Path(output_dir).expanduser()
        self.exporter = BundleExporter()

    def write(self, bundle_root: Path | str) -> dict[str, str]:
        return self.exporter.write_bundle(
            bundle_root,
            lambda bundle: (self.output_dir, bundle.id, "bundle id"),
        )


class InboxSink:
    def __init__(self, workspace: Path | str) -> None:
        self.workspace = Path(workspace).expanduser()
        self.exporter = BundleExporter()

    def write(self, bundle_root: Path | str) -> dict[str, str]:
        def destination(bundle: CaptureBundle) -> tuple[Path, str, str]:
            platform = _safe_path_segment(bundle.platform, label="platform")
            return self.workspace / "inbox" / platform, bundle.id, "bundle id"

        return self.exporter.write_bundle(bundle_root, destination)


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
