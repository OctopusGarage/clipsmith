from __future__ import annotations

from collections.abc import Callable
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


class CaptureJobStore:
    def __init__(
        self,
        state_dir: Path | str | None = None,
        *,
        id_factory: Callable[[], str] | None = None,
        clock: Callable[[], str] | None = None,
    ) -> None:
        self.state_path = self._state_path(state_dir)
        self._id_factory = id_factory or _new_job_id
        self._clock = clock or _utc_now

    def create(self, *, target: str, provider: str) -> CaptureJob:
        now = self._clock()
        job_id, job_path = self._new_job_location()
        job = CaptureJob(
            job_id=job_id,
            target=target,
            provider=provider,
            status=PENDING,
            job_path=job_path,
            created_at=now,
            updated_at=now,
        )
        self.write(job, create=True)
        return job

    def read(self, job_id_or_path: str | Path) -> CaptureJob:
        job_path = self._job_path(job_id_or_path)
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
            raise CaptureError(
                f"Capture job metadata is missing {exc.args[0]}"
            ) from exc

    def mark_done(self, job: CaptureJob, bundle_path: str | Path) -> CaptureJob:
        updated = CaptureJob(
            job_id=job.job_id,
            target=job.target,
            provider=job.provider,
            status=DONE,
            job_path=job.job_path,
            created_at=job.created_at,
            updated_at=self._clock(),
            bundle_path=Path(bundle_path).expanduser(),
        )
        self.write(updated)
        return updated

    def write(self, job: CaptureJob, *, create: bool = False) -> None:
        job.job_path.mkdir(parents=True, exist_ok=not create)
        job_json = job.job_path / "job.json"
        job_json.write_text(
            json.dumps(job.to_json_dict(), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    def _job_path(self, job_id_or_path: str | Path) -> Path:
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
        return self.state_path / "jobs" / str(job_id_or_path)

    def _new_job_location(self) -> tuple[str, Path]:
        for _ in range(10):
            job_id = self._id_factory()
            job_path = self.state_path / "jobs" / job_id
            if not job_path.exists():
                return job_id, job_path
        raise CaptureError("Could not allocate a unique capture job id")

    @staticmethod
    def _state_path(state_dir: Path | str | None) -> Path:
        if state_dir is None:
            return Path.cwd() / ".clipsmith"
        return Path(state_dir).expanduser()


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
    store = CaptureJobStore(state_dir)
    return store.create(target=target, provider=selected.name)


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

    store = CaptureJobStore(state_dir)
    job = store.read(job_id_or_path)
    return store.mark_done(job, bundle_root)


def read_capture_job(
    job_id_or_path: str | Path, *, state_dir: Path | str | None = None
) -> CaptureJob:
    return CaptureJobStore(state_dir).read(job_id_or_path)


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


def _new_job_id() -> str:
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    return f"cap-{stamp}-{uuid4().hex[:12]}"


def _utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
