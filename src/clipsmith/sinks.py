from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
import shutil

from clipsmith.bundle import BundleRepository, CaptureBundle
from clipsmith.materialization import BundleSource, safe_path_segment, unique_target


type DestinationSelector = Callable[[CaptureBundle], tuple[Path, str, str]]
type CopyTree = Callable[[Path, Path], object]


class BundleExporter:
    def __init__(
        self,
        *,
        repository: BundleRepository | None = None,
        copy_tree: CopyTree = shutil.copytree,
    ) -> None:
        self.source = BundleSource(repository or BundleRepository())
        self._copy_tree = copy_tree

    def write_bundle(
        self,
        bundle_root: Path | str,
        destination_for_bundle: DestinationSelector,
    ) -> dict[str, str]:
        loaded = self.source.load(bundle_root)
        parent, name, label = destination_for_bundle(loaded.bundle)
        target = unique_target(
            parent, safe_path_segment(name, label=label, context="sink")
        )

        target.parent.mkdir(parents=True, exist_ok=True)
        self._copy_tree(loaded.root, target)
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
            platform = safe_path_segment(
                bundle.platform, label="platform", context="sink"
            )
            return self.workspace / "inbox" / platform, bundle.id, "bundle id"

        return self.exporter.write_bundle(bundle_root, destination)
