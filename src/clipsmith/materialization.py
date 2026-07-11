from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from clipsmith.bundle import BundleRepository, CaptureBundle
from clipsmith.errors import BundleError


@dataclass(frozen=True)
class LoadedBundle:
    root: Path
    bundle: CaptureBundle


class BundleSource:
    def __init__(
        self,
        repository: BundleRepository | None = None,
        *,
        invalid_message_prefix: str = "Cannot use invalid bundle",
    ) -> None:
        self.repository = repository or BundleRepository()
        self.invalid_message_prefix = invalid_message_prefix

    def load(self, root: Path | str) -> LoadedBundle:
        root_path = Path(root).expanduser()
        if hasattr(self.repository, "validate_result"):
            validation = self.repository.validate_result(root_path)
            if not validation.is_valid:
                first = validation.issues[0]
                raise BundleError(
                    f"{self.invalid_message_prefix}: {first.path}: {first.message}"
                )
        return LoadedBundle(root=root_path, bundle=self.repository.read(root_path))


def unique_target(parent: Path, name: str, *, suffix: str = "") -> Path:
    target = parent / f"{name}{suffix}"
    if not target.exists():
        return target

    counter = 2
    while True:
        target = parent / f"{name}-{counter}{suffix}"
        if not target.exists():
            return target
        counter += 1


def safe_path_segment(value: str, *, label: str, context: str = "") -> str:
    if (
        not value
        or Path(value).is_absolute()
        or value in {".", ".."}
        or "/" in value
        or "\\" in value
    ):
        if context:
            raise BundleError(f"Unsafe {context} path segment for {label}: {value}")
        raise BundleError(f"Unsafe {label} path segment: {value}")
    return value
