from __future__ import annotations

import json
from pathlib import Path

from clipsmith.bundle import BundleRepository, CaptureBundle
from clipsmith.errors import BundleError
from clipsmith.materialization import BundleSource, safe_path_segment, unique_target


TYPE_BY_PLATFORM = {
    "web": "Article",
    "wechat": "Article",
    "x": "Social Post",
    "xhs": "Social Post",
    "image-ocr": "OCR Capture",
}

TAG_KIND_BY_PLATFORM = {
    "web": "article",
    "wechat": "article",
    "x": "social-post",
    "xhs": "social-post",
    "image-ocr": "ocr",
}


class OkfExporter:
    def __init__(
        self,
        output_dir: Path | str,
        *,
        repository: BundleRepository | None = None,
    ) -> None:
        self.output_dir = Path(output_dir).expanduser()
        self.source = BundleSource(
            repository or BundleRepository(),
            invalid_message_prefix="Cannot export invalid bundle",
        )

    def write(self, bundle_root: Path | str) -> dict[str, str]:
        loaded = self.source.load(bundle_root)
        bundle = loaded.bundle
        target = unique_target(
            self.output_dir
            / safe_path_segment(bundle.platform, label="platform", context="OKF"),
            safe_path_segment(bundle.id, label="bundle id", context="OKF"),
            suffix=".md",
        )
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(_render_okf_concept(loaded.root, bundle), encoding="utf-8")
        return {"status": "written", "path": str(target)}


def _render_okf_concept(bundle_root: Path, bundle: CaptureBundle) -> str:
    resource = bundle.canonical_url or bundle.source_url
    frontmatter = {
        "type": TYPE_BY_PLATFORM.get(bundle.platform, "Capture"),
        "title": bundle.title or bundle.id,
        "description": _description_for(bundle),
        "resource": resource,
        "tags": _tags_for(bundle),
        "timestamp": bundle.captured_at or bundle.published_at,
        "clipsmith_schema": bundle.schema,
        "clipsmith_bundle_id": bundle.id,
        "clipsmith_platform": bundle.platform,
        "clipsmith_status": bundle.status,
    }
    body_parts = [_frontmatter(frontmatter), _content_text(bundle_root, "post.md")]
    summary = _optional_content_text(bundle_root, "summary.md")
    if summary:
        body_parts.extend(["# Capture Summary\n\n" + _strip_heading(summary)])
    ocr = _optional_content_text(bundle_root, "ocr.md") or _optional_content_text(
        bundle_root, "ocr.txt"
    )
    if ocr:
        body_parts.extend(["# OCR Transcript\n\n" + _strip_heading(ocr)])
    if resource:
        body_parts.extend([f"# Citations\n\n[1] [Source]({resource})"])
    return "\n\n".join(part.strip() for part in body_parts if part.strip()) + "\n"


def _frontmatter(values: dict[str, object]) -> str:
    lines = ["---"]
    for key, value in values.items():
        if value is None or value == "" or value == []:
            continue
        lines.append(f"{key}: {json.dumps(value, ensure_ascii=False)}")
    lines.append("---")
    return "\n".join(lines)


def _description_for(bundle: CaptureBundle) -> str:
    kind = {
        "web": "article",
        "wechat": "article",
        "x": "post",
        "xhs": "post",
        "image-ocr": "OCR capture",
    }.get(bundle.platform, "capture")
    if bundle.author:
        return f"Captured {bundle.platform} {kind} from {bundle.author}."
    return f"Captured {bundle.platform} {kind}."


def _tags_for(bundle: CaptureBundle) -> list[str]:
    tags = ["clipsmith", bundle.platform]
    kind = TAG_KIND_BY_PLATFORM.get(bundle.platform)
    if kind:
        tags.append(kind)
    return tags


def _content_text(bundle_root: Path, path: str) -> str:
    target = bundle_root / path
    try:
        return target.read_text(encoding="utf-8")
    except OSError as exc:
        raise BundleError(f"Could not read bundle content file {path}: {exc}") from exc


def _optional_content_text(bundle_root: Path, path: str) -> str:
    target = bundle_root / path
    if not target.is_file():
        return ""
    return _content_text(bundle_root, path)


def _strip_heading(text: str) -> str:
    lines = text.strip().splitlines()
    if lines and lines[0].startswith("# "):
        return "\n".join(lines[1:]).strip()
    return text.strip()
