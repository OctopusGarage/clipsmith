from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import UTC, datetime
import json
from pathlib import Path
from uuid import uuid4

from clipsmith.bundle import BundleRepository
from clipsmith.errors import ClipsmithError
from clipsmith.providers import ProviderInfo, ProviderRegistry


JOB_SCHEMA = "clipsmith.capture_job.v1"
PENDING = "pending"
DONE = "done"


class CaptureError(ClipsmithError):
    """Raised when a capture job cannot be created or finalized."""


@dataclass(frozen=True)
class CaptureJob:
    job_id: str
    target: str
    provider: str
    status: str
    job_path: Path
    created_at: str
    updated_at: str
    bundle_path: Path | None = None

    def to_json_dict(self) -> dict[str, str]:
        payload = asdict(self)
        payload["schema"] = JOB_SCHEMA
        payload["job_path"] = str(self.job_path)
        if self.bundle_path is None:
            payload.pop("bundle_path")
        else:
            payload["bundle_path"] = str(self.bundle_path)
        return payload


def start_capture_job(
    target: str,
    *,
    provider: str | None = None,
    state_dir: Path | str | None = None,
    registry: ProviderRegistry | None = None,
) -> CaptureJob:
    registry = registry or ProviderRegistry.default()
    selected = _select_provider(
        target=target, provider_name=provider, registry=registry
    )
    now = _utc_now()
    state_path = _state_path(state_dir)
    job_id, job_path = _new_job_location(state_path)

    job = CaptureJob(
        job_id=job_id,
        target=target,
        provider=selected.name,
        status=PENDING,
        job_path=job_path,
        created_at=now,
        updated_at=now,
    )
    _write_job(job, create=True)
    return job


def finalize_capture_job(
    job_id_or_path: str | Path,
    bundle_path: str | Path,
    *,
    state_dir: Path | str | None = None,
    bundle_repository: BundleRepository | None = None,
) -> CaptureJob:
    repository = bundle_repository or BundleRepository()
    bundle_root = Path(bundle_path).expanduser()
    issues = repository.validate(bundle_root)
    if issues:
        details = "; ".join(issue["message"] for issue in issues)
        raise CaptureError(f"Bundle validation failed: {details}")

    job = read_capture_job(job_id_or_path, state_dir=state_dir)
    updated = CaptureJob(
        job_id=job.job_id,
        target=job.target,
        provider=job.provider,
        status=DONE,
        job_path=job.job_path,
        created_at=job.created_at,
        updated_at=_utc_now(),
        bundle_path=bundle_root,
    )
    _write_job(updated)
    return updated


def read_capture_job(
    job_id_or_path: str | Path, *, state_dir: Path | str | None = None
) -> CaptureJob:
    job_path = _job_path(job_id_or_path, state_dir=state_dir)
    job_json = job_path / "job.json"
    try:
        payload = json.loads(job_json.read_text(encoding="utf-8"))
    except OSError as exc:
        raise CaptureError(
            f"Could not read capture job {job_id_or_path}: {exc}"
        ) from exc
    except json.JSONDecodeError as exc:
        raise CaptureError(f"Could not parse {job_json}: {exc}") from exc

    if not isinstance(payload, dict):
        raise CaptureError("job.json must contain a JSON object")
    if payload.get("schema") != JOB_SCHEMA:
        raise CaptureError(
            f"Unsupported capture job schema: {payload.get('schema', '')}"
        )

    try:
        return CaptureJob(
            job_id=str(payload["job_id"]),
            target=str(payload["target"]),
            provider=str(payload["provider"]),
            status=str(payload["status"]),
            job_path=job_path,
            created_at=str(payload["created_at"]),
            updated_at=str(payload["updated_at"]),
            bundle_path=Path(str(payload["bundle_path"])).expanduser()
            if "bundle_path" in payload
            else None,
        )
    except KeyError as exc:
        raise CaptureError(f"Capture job metadata is missing {exc.args[0]}") from exc


def _select_provider(
    *, target: str, provider_name: str | None, registry: ProviderRegistry
) -> ProviderInfo:
    if provider_name is not None:
        for candidate in registry.list():
            if candidate.name == provider_name:
                return candidate
        raise CaptureError(f"Unknown provider: {provider_name}")

    provider = registry.match(target)
    if provider is None:
        raise CaptureError(f"No provider matches target: {target}")
    return provider


def _write_job(job: CaptureJob, *, create: bool = False) -> None:
    job.job_path.mkdir(parents=True, exist_ok=not create)
    job_json = job.job_path / "job.json"
    job_json.write_text(
        json.dumps(job.to_json_dict(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _job_path(job_id_or_path: str | Path, *, state_dir: Path | str | None) -> Path:
    candidate = Path(job_id_or_path).expanduser()
    if (candidate / "job.json").is_file():
        return candidate
    if candidate.is_file() and candidate.name == "job.json":
        return candidate.parent

    value = str(job_id_or_path)
    if (
        candidate.is_absolute()
        or "/" in value
        or "\\" in value
        or ".." in candidate.parts
    ):
        raise CaptureError(f"Unsafe capture job id: {job_id_or_path}")
    return _state_path(state_dir) / "jobs" / str(job_id_or_path)


def _state_path(state_dir: Path | str | None) -> Path:
    if state_dir is None:
        return Path.cwd() / ".clipsmith"
    return Path(state_dir).expanduser()


def _new_job_location(state_path: Path) -> tuple[str, Path]:
    for _ in range(10):
        job_id = _new_job_id()
        job_path = state_path / "jobs" / job_id
        if not job_path.exists():
            return job_id, job_path
    raise CaptureError("Could not allocate a unique capture job id")


def _new_job_id() -> str:
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    return f"cap-{stamp}-{uuid4().hex[:12]}"


def _utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
