from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
import shutil

from clipsmith.bundle import (
    BUNDLE_SCHEMA,
    CaptureBundle,
    ContentFile,
    BundleRepository,
)
from clipsmith.errors import BundleError


ALLOWED_RAW_PROVIDERS = {"web", "wechat", "x", "xhs", "image-ocr"}
PRIMARY_CONTENT_FILES = ("post.md", "article.md")
SUMMARY_MAX_CHARS = 480


@dataclass(frozen=True)
class RawCaptureNormalizationRequest:
    provider: str
    raw_dir: Path | str
    bundle_dir: Path | str
    source_url: str
    canonical_url: str = ""
    title: str = ""
    author: str = ""
    published_at: str = ""
    captured_at: str = ""
    status: str = "complete"
    overwrite: bool = False


@dataclass(frozen=True)
class RawCaptureNormalizationResult:
    status: str
    path: str
    issues: tuple[dict[str, str], ...] = ()

    def to_json_dict(self) -> dict[str, object]:
        return {
            "status": self.status,
            "path": self.path,
            "issues": [dict(issue) for issue in self.issues],
        }


class RawCaptureNormalizer:
    def __init__(self, repository: BundleRepository | None = None) -> None:
        self.repository = repository or BundleRepository()

    def normalize(
        self, request: RawCaptureNormalizationRequest
    ) -> RawCaptureNormalizationResult:
        provider = request.provider.strip()
        if provider not in ALLOWED_RAW_PROVIDERS:
            raise BundleError(f"Unsupported raw provider: {request.provider}")
        if not request.source_url.strip():
            raise BundleError("source_url is required for raw normalization")

        raw_dir = Path(request.raw_dir).expanduser()
        bundle_dir = Path(request.bundle_dir).expanduser()
        if not raw_dir.is_dir():
            raise BundleError(f"Raw capture directory does not exist: {raw_dir}")
        if bundle_dir.exists() and any(bundle_dir.iterdir()) and not request.overwrite:
            raise BundleError(
                f"Bundle directory is not empty: {bundle_dir}. Use overwrite to replace it."
            )

        primary = self._primary_content_file(raw_dir)
        primary_text = primary.read_text(encoding="utf-8")
        summary = self._summary_text(raw_dir, primary_text, request.title)
        ocr_file = self._ocr_file(raw_dir)

        if request.overwrite and bundle_dir.exists():
            shutil.rmtree(bundle_dir)
        bundle_dir.mkdir(parents=True, exist_ok=True)

        (bundle_dir / "post.md").write_text(primary_text, encoding="utf-8")
        (bundle_dir / "summary.md").write_text(summary, encoding="utf-8")
        content_files = [
            ContentFile(path="summary.md", kind="summary", required_for_review=True),
            ContentFile(path="post.md", kind="post", required_for_review=True),
        ]
        if ocr_file is not None:
            ocr_target = "ocr.md" if ocr_file.suffix == ".md" else "ocr.txt"
            shutil.copyfile(ocr_file, bundle_dir / ocr_target)
            content_files.append(
                ContentFile(
                    path=ocr_target,
                    kind="ocr-text",
                    required_for_review=True,
                )
            )

        bundle = CaptureBundle(
            schema=BUNDLE_SCHEMA,
            id=bundle_dir.name,
            platform=provider,
            source_url=request.source_url,
            canonical_url=request.canonical_url,
            title=request.title,
            author=request.author,
            published_at=request.published_at,
            captured_at=request.captured_at,
            content_files=content_files,
            assets=[],
            warnings=[],
            status=request.status,
        )
        self.repository.write(bundle_dir, bundle)
        validation = self.repository.validate_result(bundle_dir)
        if not validation.is_valid:
            first = validation.issues[0]
            raise BundleError(
                f"Normalized bundle is invalid: {first.path}: {first.message}"
            )
        return RawCaptureNormalizationResult(status="written", path=str(bundle_dir))

    def _primary_content_file(self, raw_dir: Path) -> Path:
        for filename in PRIMARY_CONTENT_FILES:
            target = raw_dir / filename
            if target.is_file():
                return target
        raise BundleError(
            f"Raw capture directory must contain post.md or article.md: {raw_dir}"
        )

    def _summary_text(self, raw_dir: Path, primary_text: str, title: str) -> str:
        raw_summary = raw_dir / "summary.md"
        if raw_summary.is_file():
            return raw_summary.read_text(encoding="utf-8")

        heading = title.strip() or _first_markdown_heading(primary_text) or "Capture"
        body = _summary_body(primary_text)
        if body:
            return f"# Summary\n\n**{heading}**\n\n{body}\n"
        return f"# Summary\n\n**{heading}**\n"

    def _ocr_file(self, raw_dir: Path) -> Path | None:
        for filename in ("ocr.md", "ocr.txt"):
            target = raw_dir / filename
            if target.is_file():
                return target
        return None


def _first_markdown_heading(text: str) -> str:
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            return stripped.lstrip("#").strip()
    return ""


def _summary_body(text: str) -> str:
    lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if re.match(
            r"^(source|url|canonical url|author|published|captured):", stripped, re.I
        ):
            continue
        lines.append(stripped)
    body = " ".join(lines)
    body = re.sub(r"\s+", " ", body).strip()
    if len(body) <= SUMMARY_MAX_CHARS:
        return body
    return body[: SUMMARY_MAX_CHARS - 3].rstrip() + "..."
