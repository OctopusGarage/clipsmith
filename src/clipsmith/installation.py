from __future__ import annotations

import json
import os
import platform
import shutil
from dataclasses import dataclass
from pathlib import Path

from clipsmith.errors import ClipsmithError


SKILL_COPY_EXCLUDE_NAMES = frozenset(
    {
        ".DS_Store",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        ".venv",
        "__pycache__",
        "coverage",
        "coverage.xml",
        "eval.mjs",
        "evals",
        "htmlcov",
        "node_modules",
        "playwright-report",
        "test-results",
        "tests",
        "venv",
    }
)


@dataclass(frozen=True)
class InstallOptions:
    action: str
    claude: bool
    codex: bool
    copy: bool = False
    only: str | None = None
    skip: str | None = None


@dataclass(frozen=True)
class InstallationOperation:
    label: str
    skill: str
    status: str

    def to_line(self) -> str:
        return f"[{self.label}] {self.status}: {self.skill}"

    def to_json_dict(self) -> dict[str, str]:
        return {"label": self.label, "skill": self.skill, "status": self.status}


@dataclass(frozen=True)
class InstallationTargetReport:
    label: str
    path: Path
    changed: int
    skipped: int
    operations: tuple[InstallationOperation, ...] = ()

    def to_lines(self) -> list[str]:
        return [
            *(operation.to_line() for operation in self.operations),
            f"[{self.label}] done: {self.changed} changed, {self.skipped} skipped",
        ]

    def to_json_dict(self) -> dict[str, object]:
        return {
            "label": self.label,
            "path": str(self.path),
            "changed": self.changed,
            "skipped": self.skipped,
            "operations": [operation.to_json_dict() for operation in self.operations],
        }


@dataclass(frozen=True)
class InstallationReport:
    action: str
    source_root: Path
    selected: tuple[str, ...]
    targets: tuple[InstallationTargetReport, ...] = ()
    message: str = ""

    def to_lines(self) -> list[str]:
        if self.message:
            return [self.message]
        lines: list[str] = []
        for target in self.targets:
            lines.extend(target.to_lines())
        return lines

    def to_json_dict(self) -> dict[str, object]:
        return {
            "action": self.action,
            "source_root": str(self.source_root),
            "selected": list(self.selected),
            "targets": [target.to_json_dict() for target in self.targets],
            "message": self.message,
        }


def install_skills(options: InstallOptions) -> list[str]:
    return install_skills_report(options).to_lines()


def install_skills_report(options: InstallOptions) -> InstallationReport:
    source_root = find_skills_source()
    selected = select_skills(source_root, only=options.only, skip=options.skip)
    targets = resolve_targets(options)

    if not targets:
        return InstallationReport(
            action=options.action,
            source_root=source_root,
            selected=tuple(selected),
            message="No agent skill targets selected or detected.",
        )

    reports: list[InstallationTargetReport] = []
    for label, target_root in targets:
        reports.append(
            _process_target(
                source_root=source_root,
                target_root=target_root,
                label=label,
                selected=selected,
                action=options.action,
                copy=options.copy,
            )
        )

    return InstallationReport(
        action=options.action,
        source_root=source_root,
        selected=tuple(selected),
        targets=tuple(reports),
    )


def doctor_checks() -> list[dict[str, str]]:
    checks = [
        _command_check("uv", "required for CLI source installs and Python skills"),
        _command_check("node", "required by TypeScript capture skills"),
        _command_check("npm", "used by TypeScript skill runners"),
        _command_check("npx", "used by TypeScript skill runners"),
        _command_check("pnpm", "optional; supported by copied skill lockfiles"),
        _command_check("git", "useful for source installs and project hooks"),
    ]

    skills_source = _safe_find_skills_source()
    if skills_source is None:
        checks.append(
            {
                "name": "skills_source",
                "status": "missing",
                "message": "Could not locate bundled or source skills directory",
            }
        )
    else:
        count = len(list_skill_names(skills_source))
        checks.append(
            {
                "name": "skills_source",
                "status": "ok",
                "message": f"Found {count} skills",
                "path": str(skills_source),
            }
        )

    claude_dir = Path.home() / ".claude" / "skills"
    codex_dir = (
        Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))) / "skills"
    )
    checks.append(_directory_check("claude_skills_dir", claude_dir))
    checks.append(_directory_check("codex_skills_dir", codex_dir))
    checks.append(_platform_check())
    return checks


def doctor_json(checks: list[dict[str, str]]) -> str:
    return json.dumps(
        {
            "status": "ok" if doctor_exit_code(checks) == 0 else "issues",
            "checks": checks,
        },
        ensure_ascii=False,
    )


def doctor_exit_code(checks: list[dict[str, str]]) -> int:
    return 1 if any(check["status"] == "missing" for check in checks) else 0


def find_skills_source() -> Path:
    source = _safe_find_skills_source()
    if source is None:
        raise ClipsmithError("Could not locate Clipsmith skills directory")
    return source


def list_skill_names(source_root: Path) -> list[str]:
    return sorted(
        path.name
        for path in source_root.iterdir()
        if path.is_dir() and (path / "SKILL.md").is_file()
    )


def select_skills(
    source_root: Path, *, only: str | None = None, skip: str | None = None
) -> list[str]:
    available = list_skill_names(source_root)
    if only and skip:
        raise ClipsmithError("--only and --skip are mutually exclusive")

    if only:
        selected = _split_names(only)
        _validate_names(selected, available)
        return selected

    if skip:
        skipped = _split_names(skip)
        _validate_names(skipped, available)
        return [name for name in available if name not in skipped]

    return available


def resolve_targets(options: InstallOptions) -> list[tuple[str, Path]]:
    targets: list[tuple[str, Path]] = []
    explicit = options.claude or options.codex
    home = Path.home()
    codex_home = Path(os.environ.get("CODEX_HOME", str(home / ".codex")))

    if options.claude or (not explicit and (home / ".claude").is_dir()):
        targets.append(("claude", home / ".claude" / "skills"))
    if options.codex or (not explicit and codex_home.is_dir()):
        targets.append(("codex", codex_home / "skills"))
    return targets


def print_doctor(checks: list[dict[str, str]]) -> list[str]:
    return [
        f"{check['status']}\t{check['name']}\t{check.get('message', '')}"
        for check in checks
    ]


def _safe_find_skills_source() -> Path | None:
    candidates = [
        Path(__file__).resolve().parents[2] / "skills",
        Path(__file__).resolve().parent / "skills",
    ]
    for candidate in candidates:
        if candidate.is_dir() and any(candidate.glob("*/SKILL.md")):
            return candidate
    return None


def _process_target(
    *,
    source_root: Path,
    target_root: Path,
    label: str,
    selected: list[str],
    action: str,
    copy: bool,
) -> InstallationTargetReport:
    changed = 0
    skipped = 0
    operations: list[InstallationOperation] = []
    target_root.mkdir(parents=True, exist_ok=True)

    for name in selected:
        source = source_root / name
        destination = target_root / name

        if action == "uninstall":
            if destination.is_symlink():
                link_target = Path(os.readlink(destination))
                if not link_target.is_absolute():
                    link_target = destination.parent / link_target
                if _is_owned_link(link_target.resolve(), source_root.resolve()):
                    destination.unlink()
                    operations.append(
                        InstallationOperation(label, name, "removed link")
                    )
                    changed += 1
                else:
                    operations.append(
                        InstallationOperation(label, name, "skip foreign link")
                    )
                    skipped += 1
            elif destination.exists():
                operations.append(
                    InstallationOperation(label, name, "skip real directory")
                )
                skipped += 1
            continue

        if destination.is_symlink():
            link_target = Path(os.readlink(destination))
            if not link_target.is_absolute():
                link_target = destination.parent / link_target
            if _is_owned_link(link_target.resolve(), source_root.resolve()):
                destination.unlink()
            else:
                operations.append(
                    InstallationOperation(label, name, "skip foreign link")
                )
                skipped += 1
                continue
        elif destination.exists():
            operations.append(
                InstallationOperation(label, name, "skip existing non-link")
            )
            skipped += 1
            continue

        if copy:
            shutil.copytree(source, destination, ignore=_ignore_skill_copy_names)
            operations.append(InstallationOperation(label, name, "copied"))
        else:
            destination.symlink_to(source, target_is_directory=True)
            operations.append(InstallationOperation(label, name, "linked"))
        changed += 1

    return InstallationTargetReport(
        label=label,
        path=target_root,
        changed=changed,
        skipped=skipped,
        operations=tuple(operations),
    )


def _is_owned_link(link_target: Path, source_root: Path) -> bool:
    return link_target == source_root or source_root in link_target.parents


def _ignore_skill_copy_names(_directory: str, names: list[str]) -> set[str]:
    return {name for name in names if name in SKILL_COPY_EXCLUDE_NAMES}


def _split_names(value: str) -> list[str]:
    return [name.strip() for name in value.split(",") if name.strip()]


def _validate_names(names: list[str], available: list[str]) -> None:
    unknown = [name for name in names if name not in available]
    if unknown:
        raise ClipsmithError(
            f"Unknown skill: {', '.join(unknown)} (available: {', '.join(available)})"
        )


def _command_check(command: str, message: str) -> dict[str, str]:
    path = shutil.which(command)
    check = {
        "name": command,
        "status": "ok" if path else "missing",
        "message": message,
    }
    if path:
        check["path"] = path
    return check


def _directory_check(name: str, path: Path) -> dict[str, str]:
    return {
        "name": name,
        "status": "ok" if path.is_dir() else "missing",
        "message": "Agent skills directory",
        "path": str(path),
    }


def _platform_check() -> dict[str, str]:
    if platform.system() == "Darwin":
        return {
            "name": "macos_vision_ocr",
            "status": "ok",
            "message": "macOS Vision OCR skill can run on this platform",
        }
    return {
        "name": "macos_vision_ocr",
        "status": "missing",
        "message": "clipsmith-ocr currently requires macOS Vision APIs",
    }
