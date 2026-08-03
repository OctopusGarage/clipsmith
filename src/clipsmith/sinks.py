from __future__ import annotations

from collections.abc import Callable
from hashlib import file_digest
from pathlib import Path
import shutil

from clipsmith.bundle import BundleRepository, CaptureBundle
from clipsmith.errors import BundleError
from clipsmith.materialization import BundleSource, safe_path_segment, unique_target


type DestinationSelector = Callable[[CaptureBundle], tuple[Path, str, str]]
type CopyTree = Callable[[Path, Path], object]
type CopyFile = Callable[[Path, Path], object]

MEDIA_ASSET_SUFFIXES = {
    ".avif",
    ".gif",
    ".heic",
    ".jpeg",
    ".jpg",
    ".m4a",
    ".mp3",
    ".m4v",
    ".mov",
    ".mp4",
    ".wav",
    ".png",
    ".aac",
    ".flac",
    ".ogg",
    ".webm",
    ".webp",
}


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
    def __init__(
        self,
        workspace: Path | str,
        *,
        copy_file: CopyFile = shutil.copy2,
    ) -> None:
        self.workspace = Path(workspace).expanduser()
        self.exporter = BundleExporter()
        self._copy_file = copy_file

    def write(
        self,
        bundle_root: Path | str,
        *,
        raw_assets_dir: Path | str | None = None,
        cleanup_raw_assets: bool = False,
    ) -> dict[str, str]:
        def destination(bundle: CaptureBundle) -> tuple[Path, str, str]:
            platform = safe_path_segment(
                bundle.platform, label="platform", context="sink"
            )
            return self.workspace / "inbox" / platform, bundle.id, "bundle id"

        raw_dir = (
            Path(raw_assets_dir).expanduser() if raw_assets_dir is not None else None
        )
        resolved_raw_dir = None
        if cleanup_raw_assets:
            if raw_dir is None:
                raise BundleError("Raw cleanup requires --raw-assets-dir")
            resolved_raw_dir = _assert_safe_raw_cleanup_path(raw_dir, self.workspace)

        result = self.exporter.write_bundle(bundle_root, destination)
        if raw_assets_dir is None:
            return result

        target = Path(result["path"])
        copied_assets = copy_raw_media_assets(
            raw_dir,
            target,
            copy_file=self._copy_file,
        )
        result["assets_path"] = str(target / "assets")
        result["asset_count"] = str(len(copied_assets))
        if cleanup_raw_assets:
            assert resolved_raw_dir is not None
            _assert_raw_and_target_are_separate(resolved_raw_dir, target)
            _verify_copied_media_assets(copied_assets)
            shutil.rmtree(resolved_raw_dir)
            result["raw_assets_cleanup"] = "removed"
        return result


def copy_raw_media_assets(
    raw_assets_dir: Path,
    inbox_item_dir: Path,
    *,
    copy_file: CopyFile = shutil.copy2,
) -> list[tuple[Path, Path]]:
    if not raw_assets_dir.is_dir():
        return []

    copied: list[tuple[Path, Path]] = []
    assets_dir = inbox_item_dir / "assets"
    raw_root = raw_assets_dir.resolve(strict=False)
    for source in sorted(raw_assets_dir.rglob("*")):
        if not source.is_file() or source.suffix.lower() not in MEDIA_ASSET_SUFFIXES:
            continue
        try:
            relative = source.resolve(strict=False).relative_to(raw_root)
        except (OSError, ValueError):
            continue
        target = assets_dir / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        copy_file(source, target)
        copied.append((source, target))
    return copied


def _assert_safe_raw_cleanup_path(raw_dir: Path, workspace: Path) -> Path:
    if raw_dir.is_symlink() or not raw_dir.is_dir():
        raise BundleError(f"Unsafe raw cleanup path: {raw_dir}")

    resolved = raw_dir.resolve(strict=True)
    workspace_resolved = workspace.resolve(strict=False)
    forbidden = {
        Path(resolved.anchor),
        Path.home().resolve(),
        workspace_resolved,
        (workspace_resolved / "inbox").resolve(strict=False),
    }
    if resolved in forbidden or resolved in workspace_resolved.parents:
        raise BundleError(f"Unsafe raw cleanup path: {raw_dir}")
    return resolved


def _assert_raw_and_target_are_separate(raw_dir: Path, target: Path) -> None:
    target_resolved = target.resolve(strict=False)
    if (
        raw_dir == target_resolved
        or raw_dir in target_resolved.parents
        or target_resolved in raw_dir.parents
    ):
        raise BundleError(f"Unsafe raw cleanup path: {raw_dir}")


def _verify_copied_media_assets(copied_assets: list[tuple[Path, Path]]) -> None:
    if not copied_assets:
        raise BundleError(
            "No raw media assets were copied; raw directory was preserved"
        )

    for source, target in copied_assets:
        if not target.is_file() or source.stat().st_size != target.stat().st_size:
            raise BundleError(f"Raw media verification failed: {source}")
        if _sha256(source) != _sha256(target):
            raise BundleError(f"Raw media verification failed: {source}")


def _sha256(path: Path) -> str:
    with path.open("rb") as handle:
        return file_digest(handle, "sha256").hexdigest()
