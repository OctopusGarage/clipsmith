from __future__ import annotations

from collections.abc import Mapping
from dataclasses import asdict, dataclass, field
import json
from pathlib import Path
from typing import Any

from clipsmith.errors import BundleError


BUNDLE_SCHEMA = "clipsmith.capture_bundle.v1"
VALID_STATUSES = {"complete", "partial", "failed", "needs_manual_action"}
CAPTURE_FILE = "capture.json"
ALLOWED_CONTENT_FILE_PATHS = {"post.md", "summary.md", "ocr.md", "ocr.txt"}
ALLOWED_OCR_IMAGE_ASSET_KINDS = {"ocr-image"}
ALLOWED_WEB_RAW_ASSET_PATHS_BY_KIND = {
    "web-cleaned-html": {"raw/source.html"},
    "web-rendered-text": {"raw/rendered.txt"},
    "web-metadata": {"raw/metadata.json"},
    "web-full-html-compressed": {"raw/source.full.html.gz"},
    "web-mhtml": {"raw/page.mhtml"},
}
REQUIRED_FIELDS = (
    "schema",
    "id",
    "platform",
    "source_url",
    "content_files",
    "assets",
    "warnings",
    "status",
)


@dataclass(frozen=True)
class ContentFile:
    path: str
    kind: str
    required_for_review: bool = False


@dataclass(frozen=True)
class AssetFile:
    path: str
    kind: str


@dataclass(frozen=True)
class BundleIssue:
    kind: str
    path: str
    message: str

    def to_json_dict(self) -> dict[str, str]:
        return {
            "kind": self.kind,
            "path": self.path,
            "message": self.message,
        }


@dataclass(frozen=True)
class BundleValidation:
    issues: tuple[BundleIssue, ...] = ()

    @property
    def is_valid(self) -> bool:
        return not self.issues

    def to_json_dict(self) -> dict[str, list[dict[str, str]]]:
        return {"issues": [issue.to_json_dict() for issue in self.issues]}


@dataclass(frozen=True)
class CaptureBundle:
    schema: str
    id: str
    platform: str
    source_url: str
    canonical_url: str = ""
    title: str = ""
    author: str = ""
    published_at: str = ""
    captured_at: str = ""
    content_files: list[ContentFile] = field(default_factory=list)
    assets: list[AssetFile] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    status: str = "complete"
    payload_keys: frozenset[str] = field(
        default_factory=frozenset, repr=False, compare=False
    )


class BundleRepository:
    def read(self, root: Path | str) -> CaptureBundle:
        root_path = Path(root).expanduser()
        payload = self._read_payload(root_path)
        return self._bundle_from_payload(payload)

    def write(self, root: Path | str, bundle: CaptureBundle) -> Path:
        root_path = Path(root).expanduser()
        root_path.mkdir(parents=True, exist_ok=True)
        payload = asdict(bundle)
        payload.pop("payload_keys", None)
        path = root_path / CAPTURE_FILE
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        return path

    def validate(self, root: Path | str) -> list[dict[str, str]]:
        return self.validate_result(root).to_json_dict()["issues"]

    def validate_result(self, root: Path | str) -> BundleValidation:
        root_path = Path(root).expanduser()
        issues: list[BundleIssue] = []
        allowed_file_paths = {CAPTURE_FILE}
        referenced_file_paths = {CAPTURE_FILE}
        capture_path = root_path / CAPTURE_FILE
        if not capture_path.is_file():
            return BundleValidation(
                (
                    BundleIssue(
                        kind="missing_capture_json",
                        path=CAPTURE_FILE,
                        message=f"Bundle is missing {CAPTURE_FILE}",
                    ),
                )
            )
        try:
            payload = self._read_payload(root_path)
            bundle = self._bundle_from_payload(payload)
        except BundleError as exc:
            return BundleValidation(
                (
                    BundleIssue(
                        kind="invalid_capture_json",
                        path=CAPTURE_FILE,
                        message=str(exc),
                    ),
                )
            )
        if bundle.schema != BUNDLE_SCHEMA:
            issues.append(
                BundleIssue(
                    kind="unsupported_schema",
                    path=CAPTURE_FILE,
                    message=f"Unsupported schema: {bundle.schema}",
                )
            )
        for field_name in REQUIRED_FIELDS:
            if field_name not in payload:
                issues.append(
                    BundleIssue(
                        kind="missing_required_field",
                        path=CAPTURE_FILE,
                        message=f"Required field is missing: {field_name}",
                    )
                )
        if bundle.status not in VALID_STATUSES:
            issues.append(
                BundleIssue(
                    kind="invalid_status",
                    path=CAPTURE_FILE,
                    message=f"Invalid status: {bundle.status}",
                )
            )
        for content_file in bundle.content_files:
            path_issue = self._invalid_bundle_path_issue(
                root_path=root_path,
                bundle_path=content_file.path,
                kind="invalid_content_file_path",
                label="Content file",
            )
            if path_issue is not None:
                issues.append(path_issue)
                continue
            referenced_file_paths.add(content_file.path)
            if content_file.path not in ALLOWED_CONTENT_FILE_PATHS:
                issues.append(
                    BundleIssue(
                        kind="unsupported_content_file",
                        path=content_file.path,
                        message=(
                            "Only post.md, summary.md, ocr.md, and ocr.txt "
                            "content files are allowed: "
                            f"{content_file.path}"
                        ),
                    )
                )
                continue
            allowed_file_paths.add(content_file.path)
            if (
                content_file.required_for_review
                and not (root_path / content_file.path).is_file()
            ):
                issues.append(
                    BundleIssue(
                        kind="missing_content_file",
                        path=content_file.path,
                        message=f"Required content file is missing: {content_file.path}",
                    )
                )
        for asset in bundle.assets:
            path_issue = self._invalid_bundle_path_issue(
                root_path=root_path,
                bundle_path=asset.path,
                kind="invalid_asset_file_path",
                label="Asset file",
            )
            if path_issue is not None:
                issues.append(path_issue)
                continue
            referenced_file_paths.add(asset.path)
            if not self._asset_file_is_allowed(asset):
                issues.append(
                    BundleIssue(
                        kind="unsupported_asset_file",
                        path=asset.path,
                        message=self._unsupported_asset_file_message(asset),
                    )
                )
                continue
            allowed_file_paths.add(asset.path)
            if not (root_path / asset.path).is_file():
                issues.append(
                    BundleIssue(
                        kind="missing_asset_file",
                        path=asset.path,
                        message=f"Asset file is missing: {asset.path}",
                    )
                )
        for actual_file_path in self._actual_bundle_file_paths(root_path):
            if (
                actual_file_path not in allowed_file_paths
                and actual_file_path not in referenced_file_paths
            ):
                issues.append(
                    BundleIssue(
                        kind="unexpected_bundle_file",
                        path=actual_file_path,
                        message=f"Bundle file is not allowed: {actual_file_path}",
                    )
                )
        return BundleValidation(tuple(issues))

    def _read_payload(self, root_path: Path) -> dict[str, Any]:
        capture_path = root_path / CAPTURE_FILE
        try:
            payload = json.loads(capture_path.read_text(encoding="utf-8"))
        except OSError as exc:
            raise BundleError(f"Could not read {capture_path}: {exc}") from exc
        except json.JSONDecodeError as exc:
            raise BundleError(f"Could not parse {capture_path}: {exc}") from exc
        if not isinstance(payload, dict):
            raise BundleError("capture.json must contain a JSON object")
        return payload

    def _bundle_from_payload(self, payload: dict[str, Any]) -> CaptureBundle:
        content_file_payloads = payload.get("content_files", [])
        if not isinstance(content_file_payloads, list):
            raise BundleError("content_files must be a JSON array")
        if not all(isinstance(item, Mapping) for item in content_file_payloads):
            raise BundleError("content_files entries must be JSON objects")
        content_files = [
            ContentFile(
                path=str(item.get("path", "")),
                kind=str(item.get("kind", "")),
                required_for_review=bool(item.get("required_for_review", False)),
            )
            for item in content_file_payloads
        ]
        asset_payloads = payload.get("assets", [])
        if not isinstance(asset_payloads, list):
            raise BundleError("assets must be a JSON array")
        if not all(isinstance(item, Mapping) for item in asset_payloads):
            raise BundleError("assets entries must be JSON objects")
        assets = [
            AssetFile(path=str(item.get("path", "")), kind=str(item.get("kind", "")))
            for item in asset_payloads
        ]
        warning_payloads = payload.get("warnings", [])
        if not isinstance(warning_payloads, list):
            raise BundleError("warnings must be a JSON array")
        return CaptureBundle(
            schema=str(payload.get("schema", "")),
            id=str(payload.get("id", "")),
            platform=str(payload.get("platform", "")),
            source_url=str(payload.get("source_url", "")),
            canonical_url=str(payload.get("canonical_url", "")),
            title=str(payload.get("title", "")),
            author=str(payload.get("author", "")),
            published_at=str(payload.get("published_at", "")),
            captured_at=str(payload.get("captured_at", "")),
            content_files=content_files,
            assets=assets,
            warnings=[str(item) for item in warning_payloads],
            status=str(payload.get("status", "")),
            payload_keys=frozenset(payload.keys()),
        )

    def _actual_bundle_file_paths(self, root_path: Path) -> list[str]:
        if not root_path.is_dir():
            return []
        root_resolved = root_path.resolve(strict=False)
        paths: list[str] = []
        for path in root_path.rglob("*"):
            if not path.is_file():
                continue
            try:
                relative_path = path.resolve(strict=False).relative_to(root_resolved)
            except (OSError, ValueError):
                continue
            paths.append(relative_path.as_posix())
        return sorted(paths)

    def _invalid_bundle_path_issue(
        self,
        *,
        root_path: Path,
        bundle_path: str,
        kind: str,
        label: str,
    ) -> BundleIssue | None:
        path = Path(bundle_path)
        if path.is_absolute():
            return BundleIssue(
                kind=kind,
                path=bundle_path,
                message=f"{label} path must stay within bundle root: {bundle_path}",
            )
        try:
            root_resolved = root_path.resolve(strict=False)
            candidate_resolved = (root_path / path).resolve(strict=False)
            candidate_resolved.relative_to(root_resolved)
        except (OSError, ValueError):
            return BundleIssue(
                kind=kind,
                path=bundle_path,
                message=f"{label} path must stay within bundle root: {bundle_path}",
            )
        return None

    def _asset_file_is_allowed(self, asset: AssetFile) -> bool:
        if asset.kind in ALLOWED_OCR_IMAGE_ASSET_KINDS:
            return True
        return asset.path in ALLOWED_WEB_RAW_ASSET_PATHS_BY_KIND.get(asset.kind, set())

    def _unsupported_asset_file_message(self, asset: AssetFile) -> str:
        if asset.kind in ALLOWED_WEB_RAW_ASSET_PATHS_BY_KIND:
            return f"Unsupported asset file for kind {asset.kind}: {asset.path}"
        return (
            f"Only OCR and web raw audit assets are allowed in a bundle: {asset.path}"
        )
