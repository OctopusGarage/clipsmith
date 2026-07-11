import json

from clipsmith.quality_gate import (
    validate_project_quality_gate_result,
    validate_skill_quality_gates,
    validate_skill_quality_gates_result,
)


def _write_skill(root, name, quality_gate):
    skill_dir = root / "skills" / name
    skill_dir.mkdir(parents=True)
    docs_dir = root / "docs"
    docs_dir.mkdir(exist_ok=True)
    (docs_dir / "provider-quality-gate.md").write_text(
        "# Provider Quality Gate\n", encoding="utf-8"
    )
    (skill_dir / "SKILL.md").write_text(
        f"---\nname: {name}\n---\n# {name}\n", encoding="utf-8"
    )
    (skill_dir / "quality-gate.json").write_text(
        json.dumps(quality_gate), encoding="utf-8"
    )


def _valid_gate(name, *, capture_kind="article", ai_required=True):
    return {
        "version": 1,
        "skill": name,
        "capture_kind": capture_kind,
        "raw_evidence": ["post.md"],
        "deterministic_checks": [
            {"name": "bundle validation", "command": "uv run clipsmith validate-bundle"}
        ],
        "agent_ai_eval": {
            "required": ai_required,
            "prompt": "docs/provider-quality-gate.md",
        },
        "ready_report": ["Provider quality gate: PASS|FAIL"],
    }


def test_valid_quality_gate_has_no_issues(tmp_path):
    _write_skill(tmp_path, "clipsmith-web", _valid_gate("clipsmith-web"))

    issues = validate_skill_quality_gates(tmp_path)

    assert issues == []


def test_validate_result_returns_typed_quality_gate_plans(tmp_path):
    _write_skill(tmp_path, "clipsmith-web", _valid_gate("clipsmith-web"))

    result = validate_skill_quality_gates_result(tmp_path)

    assert result.is_valid
    assert result.messages() == []
    assert len(result.plans) == 1
    plan = result.plans[0]
    assert plan.skill == "clipsmith-web"
    assert plan.capture_kind == "article"
    assert plan.raw_evidence == ("post.md",)
    assert plan.deterministic_checks[0].name == "bundle validation"
    assert plan.deterministic_checks[0].command == "uv run clipsmith validate-bundle"
    assert plan.agent_ai_eval.required is True
    assert plan.agent_ai_eval.prompt == "docs/provider-quality-gate.md"
    assert plan.ready_report == ("Provider quality gate: PASS|FAIL",)
    assert result.to_json_dict()["plans"][0]["skill"] == "clipsmith-web"


def test_missing_quality_gate_is_reported(tmp_path):
    skill_dir = tmp_path / "skills" / "clipsmith-web"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: clipsmith-web\n---\n# clipsmith-web\n", encoding="utf-8"
    )

    issues = validate_skill_quality_gates(tmp_path)

    assert issues == [
        "skills/clipsmith-web missing quality-gate.json",
    ]


def test_quality_gate_skill_name_must_match_directory(tmp_path):
    _write_skill(tmp_path, "clipsmith-web", _valid_gate("other-skill"))

    issues = validate_skill_quality_gates(tmp_path)

    assert issues == [
        "skills/clipsmith-web quality-gate.json skill 'other-skill' != directory name"
    ]


def test_non_router_quality_gate_requires_agent_ai_eval(tmp_path):
    _write_skill(
        tmp_path,
        "clipsmith-web",
        _valid_gate("clipsmith-web", capture_kind="article", ai_required=False),
    )

    issues = validate_skill_quality_gates(tmp_path)

    assert issues == ["skills/clipsmith-web article capture must require agent_ai_eval"]


def test_router_quality_gate_may_skip_agent_ai_eval(tmp_path):
    _write_skill(
        tmp_path,
        "clipsmith-capture",
        _valid_gate("clipsmith-capture", capture_kind="router", ai_required=False),
    )

    issues = validate_skill_quality_gates(tmp_path)

    assert issues == []


def test_web_quality_gate_profiles_must_exist(tmp_path):
    gate = _valid_gate("clipsmith-web")
    gate["deterministic_checks"].append(
        {
            "name": "known profile eval",
            "command": "node scripts/eval.mjs --profile <profile>",
            "profiles": ["missing-profile"],
        }
    )
    _write_skill(tmp_path, "clipsmith-web", gate)
    eval_dir = tmp_path / "skills" / "clipsmith-web" / "evals"
    eval_dir.mkdir()
    (eval_dir / "web-capture-evals.json").write_text(
        json.dumps({"profiles": {}}), encoding="utf-8"
    )

    issues = validate_skill_quality_gates(tmp_path)

    assert issues == [
        "skills/clipsmith-web quality-gate.json references unknown eval profile: missing-profile"
    ]


def test_required_agent_eval_prompt_or_report_must_exist(tmp_path):
    gate = _valid_gate("clipsmith-web")
    gate["agent_ai_eval"]["prompt"] = "docs/missing-prompt.md"
    _write_skill(tmp_path, "clipsmith-web", gate)

    issues = validate_skill_quality_gates(tmp_path)

    assert issues == [
        "skills/clipsmith-web quality-gate.json agent_ai_eval.prompt path does not exist: docs/missing-prompt.md"
    ]


def test_project_quality_gate_result_validates_web_eval_profile_contract(tmp_path):
    gate = _valid_gate("clipsmith-web")
    gate["deterministic_checks"].append(
        {
            "name": "known profile eval",
            "command": "node scripts/eval.mjs --profile <profile>",
            "profiles": ["broken-profile"],
        }
    )
    _write_skill(tmp_path, "clipsmith-web", gate)
    eval_dir = tmp_path / "skills" / "clipsmith-web" / "evals"
    eval_dir.mkdir()
    (eval_dir / "web-capture-evals.json").write_text(
        json.dumps(
            {
                "profiles": {
                    "broken-profile": {
                        "source_url": "https://example.com/article",
                        "expected_status": "complete",
                    }
                }
            }
        ),
        encoding="utf-8",
    )

    result = validate_project_quality_gate_result(tmp_path)

    assert result.messages() == [
        "skills/clipsmith-web/evals/web-capture-evals.json profile broken-profile missing title_includes",
        "skills/clipsmith-web/evals/web-capture-evals.json profile broken-profile missing required_phrases",
        "skills/clipsmith-web/evals/web-capture-evals.json profile broken-profile missing forbidden_phrases",
    ]
