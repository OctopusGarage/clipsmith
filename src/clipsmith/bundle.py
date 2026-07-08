from __future__ import annotations

from collections.abc import Mapping
from dataclasses import asdict, dataclass, field
import json
from pathlib import Path
from typing import Any

from clipsmith.errors import BundleError


BUNDLE_SCHEMA = "clipsmith.capture_bundle.v1"
VALID_STATUSES = {"complete", "partial", "failed", "needs_manual_action"}
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
        capture_path = root_path / "capture.json"
        try:
            payload = json.loads(capture_path.read_text(encoding="utf-8"))
        except OSError as exc:
            raise BundleError(f"Could not read {capture_path}: {exc}") from exc
        except json.JSONDecodeError as exc:
            raise BundleError(f"Could not parse {capture_path}: {exc}") from exc
        if not isinstance(payload, dict):
            raise BundleError("capture.json must contain a JSON object")
        return self._bundle_from_payload(payload)

    def write(self, root: Path | str, bundle: CaptureBundle) -> Path:
        root_path = Path(root).expanduser()
        root_path.mkdir(parents=True, exist_ok=True)
        payload = asdict(bundle)
        payload.pop("payload_keys", None)
        path = root_path / "capture.json"
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        return path

    def validate(self, root: Path | str) -> list[dict]:
        root_path = Path(root).expanduser()
        issues: list[dict] = []
        capture_path = root_path / "capture.json"
        if not capture_path.is_file():
            return [
                {
                    "kind": "missing_capture_json",
                    "path": "capture.json",
                    "message": "Bundle is missing capture.json",
                }
            ]
        try:
            bundle = self.read(root_path)
        except BundleError as exc:
            return [
                {
                    "kind": "invalid_capture_json",
                    "path": "capture.json",
                    "message": str(exc),
                }
            ]
        if bundle.schema != BUNDLE_SCHEMA:
            issues.append(
                {
                    "kind": "unsupported_schema",
                    "path": "capture.json",
                    "message": f"Unsupported schema: {bundle.schema}",
                }
            )
        for field_name in REQUIRED_FIELDS:
            if field_name not in bundle.payload_keys:
                issues.append(
                    {
                        "kind": "missing_required_field",
                        "path": "capture.json",
                        "message": f"Required field is missing: {field_name}",
                    }
                )
        if bundle.status not in VALID_STATUSES:
            issues.append(
                {
                    "kind": "invalid_status",
                    "path": "capture.json",
                    "message": f"Invalid status: {bundle.status}",
                }
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
            if (
                content_file.required_for_review
                and not (root_path / content_file.path).is_file()
            ):
                issues.append(
                    {
                        "kind": "missing_content_file",
                        "path": content_file.path,
                        "message": f"Required content file is missing: {content_file.path}",
                    }
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
            if not (root_path / asset.path).is_file():
                issues.append(
                    {
                        "kind": "missing_asset_file",
                        "path": asset.path,
                        "message": f"Asset file is missing: {asset.path}",
                    }
                )
        return issues

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

    def _invalid_bundle_path_issue(
        self,
        *,
        root_path: Path,
        bundle_path: str,
        kind: str,
        label: str,
    ) -> dict[str, str] | None:
        path = Path(bundle_path)
        if path.is_absolute():
            return {
                "kind": kind,
                "path": bundle_path,
                "message": f"{label} path must stay within bundle root: {bundle_path}",
            }
        try:
            root_resolved = root_path.resolve(strict=False)
            candidate_resolved = (root_path / path).resolve(strict=False)
            candidate_resolved.relative_to(root_resolved)
        except (OSError, ValueError):
            return {
                "kind": kind,
                "path": bundle_path,
                "message": f"{label} path must stay within bundle root: {bundle_path}",
            }
        return None
