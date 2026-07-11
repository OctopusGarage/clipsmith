from __future__ import annotations

from dataclasses import asdict, dataclass
import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any


ALLOWED_CAPTURE_KINDS = {"router", "article", "social-post", "ocr"}
QUALITY_GATE_FILE = "quality-gate.json"
WEB_EVAL_FILE = "evals/web-capture-evals.json"
REQUIRED_WEB_EVAL_PROFILE_KEYS = (
    "source_url",
    "expected_status",
    "title_includes",
    "required_phrases",
    "forbidden_phrases",
)


@dataclass(frozen=True)
class QualityGateIssue:
    kind: str
    path: str
    message: str

    def to_json_dict(self) -> dict[str, str]:
        return asdict(self)


@dataclass(frozen=True)
class DeterministicCheck:
    name: str
    command: str
    profiles: tuple[str, ...] = ()

    def to_json_dict(self) -> dict[str, object]:
        return {
            "name": self.name,
            "command": self.command,
            "profiles": list(self.profiles),
        }


@dataclass(frozen=True)
class AgentAIEval:
    required: bool
    prompt: str = ""
    report: str = ""
    reason: str = ""

    def to_json_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class QualityGatePlan:
    skill: str
    capture_kind: str
    skill_dir: Path
    raw_evidence: tuple[str, ...]
    deterministic_checks: tuple[DeterministicCheck, ...]
    agent_ai_eval: AgentAIEval
    ready_report: tuple[str, ...]

    def to_json_dict(self) -> dict[str, object]:
        return {
            "skill": self.skill,
            "capture_kind": self.capture_kind,
            "skill_dir": str(self.skill_dir),
            "raw_evidence": list(self.raw_evidence),
            "deterministic_checks": [
                check.to_json_dict() for check in self.deterministic_checks
            ],
            "agent_ai_eval": self.agent_ai_eval.to_json_dict(),
            "ready_report": list(self.ready_report),
        }


@dataclass(frozen=True)
class QualityGateValidation:
    issues: tuple[QualityGateIssue, ...] = ()
    plans: tuple[QualityGatePlan, ...] = ()

    @property
    def is_valid(self) -> bool:
        return not self.issues

    def messages(self) -> list[str]:
        return [issue.message for issue in self.issues]

    def to_json_dict(self) -> dict[str, object]:
        return {
            "issues": [issue.to_json_dict() for issue in self.issues],
            "plans": [plan.to_json_dict() for plan in self.plans],
        }


def validate_skill_quality_gates(root: Path | str) -> list[str]:
    return validate_skill_quality_gates_result(root).messages()


def validate_skill_quality_gates_result(root: Path | str) -> QualityGateValidation:
    root_path = Path(root)
    skills_root = root_path / "skills"
    if not skills_root.is_dir():
        return QualityGateValidation(
            (
                QualityGateIssue(
                    kind="missing_skills_dir",
                    path="skills",
                    message="missing skills/ directory",
                ),
            )
        )

    issues: list[QualityGateIssue] = []
    plans: list[QualityGatePlan] = []
    for skill_dir in sorted(path for path in skills_root.iterdir() if path.is_dir()):
        relative = skill_dir.relative_to(root_path).as_posix()
        gate_path = skill_dir / QUALITY_GATE_FILE
        if not gate_path.is_file():
            _add_issue(
                issues,
                "missing_quality_gate",
                relative,
                f"{relative} missing {QUALITY_GATE_FILE}",
            )
            continue
        try:
            payload = json.loads(gate_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            _add_issue(
                issues,
                "invalid_json",
                f"{relative}/{QUALITY_GATE_FILE}",
                f"{relative}/{QUALITY_GATE_FILE} is invalid JSON: {exc}",
            )
            continue
        if not isinstance(payload, Mapping):
            _add_issue(
                issues,
                "invalid_shape",
                f"{relative}/{QUALITY_GATE_FILE}",
                f"{relative}/{QUALITY_GATE_FILE} must contain a JSON object",
            )
            continue
        plan = _quality_gate_plan_from_payload(skill_dir, root_path, payload, issues)
        if plan is not None:
            plans.append(plan)
    return QualityGateValidation(tuple(issues), tuple(plans))


def validate_project_quality_gate_result(root: Path | str) -> QualityGateValidation:
    root_path = Path(root)
    result = validate_skill_quality_gates_result(root_path)
    issues = list(result.issues)
    issues.extend(_validate_web_eval_profile_contracts(root_path))
    return QualityGateValidation(tuple(issues), result.plans)


def _quality_gate_plan_from_payload(
    skill_dir: Path,
    root_path: Path,
    payload: Mapping[str, Any],
    issues: list[QualityGateIssue],
) -> QualityGatePlan | None:
    relative = skill_dir.relative_to(root_path).as_posix()
    skill_name = skill_dir.name

    if payload.get("version") != 1:
        _add_issue(
            issues,
            "invalid_version",
            f"{relative}/{QUALITY_GATE_FILE}",
            f"{relative} quality-gate.json version must be 1",
        )
    if payload.get("skill") != skill_name:
        _add_issue(
            issues,
            "skill_name_mismatch",
            f"{relative}/{QUALITY_GATE_FILE}",
            f"{relative} quality-gate.json skill {payload.get('skill')!r} != directory name",
        )

    capture_kind = payload.get("capture_kind")
    if capture_kind not in ALLOWED_CAPTURE_KINDS:
        _add_issue(
            issues,
            "invalid_capture_kind",
            f"{relative}/{QUALITY_GATE_FILE}",
            f"{relative} quality-gate.json has invalid capture_kind: {capture_kind}",
        )

    raw_evidence = _require_string_list(issues, relative, payload, "raw_evidence")
    ready_report = _require_string_list(issues, relative, payload, "ready_report")
    deterministic_checks = _validate_deterministic_checks(
        issues, relative, skill_dir, payload
    )
    agent_ai_eval = _validate_agent_ai_eval(
        issues, relative, skill_dir, root_path, capture_kind, payload
    )
    if not isinstance(capture_kind, str):
        capture_kind = ""
    if agent_ai_eval is None:
        agent_ai_eval = AgentAIEval(required=False)
    return QualityGatePlan(
        skill=skill_name,
        capture_kind=capture_kind,
        skill_dir=skill_dir,
        raw_evidence=raw_evidence,
        deterministic_checks=deterministic_checks,
        agent_ai_eval=agent_ai_eval,
        ready_report=ready_report,
    )


def _require_string_list(
    issues: list[QualityGateIssue],
    relative: str,
    payload: Mapping[str, Any],
    key: str,
) -> tuple[str, ...]:
    value = payload.get(key)
    if (
        not isinstance(value, list)
        or not value
        or not all(isinstance(item, str) and item.strip() for item in value)
    ):
        _add_issue(
            issues,
            f"invalid_{key}",
            f"{relative}/{QUALITY_GATE_FILE}",
            f"{relative} quality-gate.json {key} must be a non-empty string list",
        )
        return ()
    return tuple(item.strip() for item in value)


def _validate_deterministic_checks(
    issues: list[QualityGateIssue],
    relative: str,
    skill_dir: Path,
    payload: Mapping[str, Any],
) -> tuple[DeterministicCheck, ...]:
    checks = payload.get("deterministic_checks")
    if not isinstance(checks, list) or not checks:
        _add_issue(
            issues,
            "invalid_deterministic_checks",
            f"{relative}/{QUALITY_GATE_FILE}",
            f"{relative} quality-gate.json deterministic_checks must be a non-empty list",
        )
        return ()
    known_profiles = _known_eval_profiles(skill_dir)
    result: list[DeterministicCheck] = []
    for index, check in enumerate(checks):
        if not isinstance(check, Mapping):
            _add_issue(
                issues,
                "invalid_deterministic_check",
                f"{relative}/{QUALITY_GATE_FILE}",
                f"{relative} quality-gate.json deterministic_checks[{index}] must be an object",
            )
            continue
        name = check.get("name")
        command = check.get("command")
        for key in ("name", "command"):
            value = check.get(key)
            if not isinstance(value, str) or not value.strip():
                _add_issue(
                    issues,
                    "invalid_deterministic_check",
                    f"{relative}/{QUALITY_GATE_FILE}",
                    f"{relative} quality-gate.json deterministic_checks[{index}].{key} "
                    "must be a non-empty string",
                )
        profiles = check.get("profiles", [])
        if not isinstance(profiles, list) or not all(
            isinstance(item, str) and item for item in profiles
        ):
            _add_issue(
                issues,
                "invalid_eval_profiles",
                f"{relative}/{QUALITY_GATE_FILE}",
                f"{relative} quality-gate.json deterministic_checks[{index}].profiles "
                "must be a string list when present",
            )
            continue
        for profile in profiles:
            if profile not in known_profiles:
                _add_issue(
                    issues,
                    "unknown_eval_profile",
                    f"{relative}/{QUALITY_GATE_FILE}",
                    f"{relative} quality-gate.json references unknown eval profile: {profile}",
                )
        if (
            isinstance(name, str)
            and name.strip()
            and isinstance(command, str)
            and command.strip()
        ):
            result.append(
                DeterministicCheck(
                    name=name.strip(),
                    command=command.strip(),
                    profiles=tuple(item.strip() for item in profiles),
                )
            )
    return tuple(result)


def _validate_agent_ai_eval(
    issues: list[QualityGateIssue],
    relative: str,
    skill_dir: Path,
    root_path: Path,
    capture_kind: object,
    payload: Mapping[str, Any],
) -> AgentAIEval | None:
    agent_eval = payload.get("agent_ai_eval")
    if not isinstance(agent_eval, Mapping):
        _add_issue(
            issues,
            "invalid_agent_ai_eval",
            f"{relative}/{QUALITY_GATE_FILE}",
            f"{relative} quality-gate.json agent_ai_eval must be an object",
        )
        return None
    required = agent_eval.get("required")
    if not isinstance(required, bool):
        _add_issue(
            issues,
            "invalid_agent_ai_eval_required",
            f"{relative}/{QUALITY_GATE_FILE}",
            f"{relative} quality-gate.json agent_ai_eval.required must be boolean",
        )
        return None
    if capture_kind != "router" and not required:
        _add_issue(
            issues,
            "missing_required_agent_ai_eval",
            f"{relative}/{QUALITY_GATE_FILE}",
            f"{relative} {capture_kind} capture must require agent_ai_eval",
        )
    if required and not any(
        agent_eval.get(key) for key in ("prompt", "report", "reason")
    ):
        _add_issue(
            issues,
            "missing_agent_ai_eval_reference",
            f"{relative}/{QUALITY_GATE_FILE}",
            f"{relative} quality-gate.json required agent_ai_eval needs prompt, report, or reason",
        )
    prompt = _optional_string(agent_eval.get("prompt"))
    report = _optional_string(agent_eval.get("report"))
    reason = _optional_string(agent_eval.get("reason"))
    for key, value in (("prompt", prompt), ("report", report)):
        if value and not _declared_reference_exists(
            skill_dir=skill_dir, root_path=root_path, reference=value
        ):
            _add_issue(
                issues,
                "missing_agent_ai_eval_reference_path",
                f"{relative}/{QUALITY_GATE_FILE}",
                f"{relative} quality-gate.json agent_ai_eval.{key} path does not exist: {value}",
            )
    return AgentAIEval(required=required, prompt=prompt, report=report, reason=reason)


def _validate_web_eval_profile_contracts(root_path: Path) -> list[QualityGateIssue]:
    issues: list[QualityGateIssue] = []
    skills_root = root_path / "skills"
    if not skills_root.is_dir():
        return issues
    for profile_path in sorted(skills_root.glob(f"*/{WEB_EVAL_FILE}")):
        relative = profile_path.relative_to(root_path).as_posix()
        try:
            payload = json.loads(profile_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            _add_issue(
                issues,
                "invalid_web_eval_json",
                relative,
                f"{relative} is invalid JSON: {exc}",
            )
            continue
        if not isinstance(payload, Mapping):
            _add_issue(
                issues,
                "invalid_web_eval_shape",
                relative,
                f"{relative} must contain a JSON object",
            )
            continue
        profiles = payload.get("profiles")
        if not isinstance(profiles, Mapping) or not profiles:
            _add_issue(
                issues,
                "invalid_web_eval_profiles",
                relative,
                f"{relative} profiles must be a non-empty object",
            )
            continue
        for profile_name, profile in profiles.items():
            if not isinstance(profile, Mapping):
                _add_issue(
                    issues,
                    "invalid_web_eval_profile",
                    relative,
                    f"{relative} profile {profile_name} must be an object",
                )
                continue
            for key in REQUIRED_WEB_EVAL_PROFILE_KEYS:
                if key not in profile:
                    _add_issue(
                        issues,
                        "missing_web_eval_profile_field",
                        relative,
                        f"{relative} profile {profile_name} missing {key}",
                    )
    return issues


def _known_eval_profiles(skill_dir: Path) -> set[str]:
    profiles_path = skill_dir / WEB_EVAL_FILE
    if not profiles_path.is_file():
        return set()
    try:
        payload = json.loads(profiles_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return set()
    profiles = payload.get("profiles", {})
    if not isinstance(profiles, Mapping):
        return set()
    return {str(name) for name in profiles}


def _declared_reference_exists(
    *, skill_dir: Path, root_path: Path, reference: str
) -> bool:
    path = Path(reference)
    if path.is_absolute() or ".." in path.parts:
        return False
    return (skill_dir / path).is_file() or (root_path / path).is_file()


def _optional_string(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()


def _add_issue(
    issues: list[QualityGateIssue], kind: str, path: str, message: str
) -> None:
    issues.append(QualityGateIssue(kind=kind, path=path, message=message))
