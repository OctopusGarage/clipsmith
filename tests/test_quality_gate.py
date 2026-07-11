import json

from clipsmith.quality_gate import (
    QualityGateRunner,
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


def test_skill_quality_gate_profiles_may_use_xhs_eval_file(tmp_path):
    gate = _valid_gate("clipsmith-xhs", capture_kind="social-post")
    gate["deterministic_checks"].append(
        {
            "name": "known XHS profile eval",
            "command": "node scripts/eval.mjs --note_dir <note_dir> --profile <profile>",
            "profiles": ["xhs-skill-long-term-asset"],
        }
    )
    _write_skill(tmp_path, "clipsmith-xhs", gate)
    eval_dir = tmp_path / "skills" / "clipsmith-xhs" / "evals"
    eval_dir.mkdir()
    (eval_dir / "xhs-capture-evals.json").write_text(
        json.dumps(
            {
                "profiles": {
                    "xhs-skill-long-term-asset": {
                        "source_url": "http://xhslink.com/o/3DeHS3JuRiS",
                        "expected_note_id": "6a51e1580000000006035d09",
                        "title_includes": "Skill 可能比 Agent 更像长期资产",
                        "min_image_count": 2,
                        "expected_ocr_count": 2,
                        "min_ocr_chars": 200,
                        "required_post_phrases": ["Skill 可能比 Agent 更像长期资产"],
                        "required_ocr_phrases": ["Skill本质是在做知识外化"],
                        "forbidden_phrases": ["页面不存在"],
                    }
                }
            }
        ),
        encoding="utf-8",
    )

    issues = validate_skill_quality_gates(tmp_path)

    assert issues == []


def test_skill_quality_gate_profiles_may_use_wechat_eval_file(tmp_path):
    gate = _valid_gate("clipsmith-wechat", capture_kind="article")
    gate["deterministic_checks"].append(
        {
            "name": "known WeChat profile eval",
            "command": "node scripts/eval.mjs --article_dir <article_dir> --profile <profile>",
            "profiles": ["wechat-wang-yangming-heart-study"],
        }
    )
    _write_skill(tmp_path, "clipsmith-wechat", gate)
    eval_dir = tmp_path / "skills" / "clipsmith-wechat" / "evals"
    eval_dir.mkdir()
    (eval_dir / "wechat-capture-evals.json").write_text(
        json.dumps(
            {
                "profiles": {
                    "wechat-wang-yangming-heart-study": {
                        "source_url": "https://mp.weixin.qq.com/s/cwvelGaEzQKHfultsDjDUg",
                        "expected_article_id": "cwvelGaEzQKHfultsDjDUg",
                        "title_includes": "王阳明心学",
                        "account_includes": "码农躺平日记",
                        "min_image_count": 1,
                        "min_article_chars": 1000,
                        "require_normalized_post": True,
                        "min_normalized_headings": 4,
                        "max_normalized_line_chars": 600,
                        "required_phrases": ["心即理", "知行合一", "致良知"],
                        "forbidden_phrases": ["登录后查看"],
                    }
                }
            }
        ),
        encoding="utf-8",
    )

    issues = validate_skill_quality_gates(tmp_path)

    assert issues == []


def test_skill_quality_gate_profiles_may_use_x_eval_file(tmp_path):
    gate = _valid_gate("clipsmith-x", capture_kind="social-post")
    gate["deterministic_checks"].append(
        {
            "name": "known X profile eval",
            "command": "node scripts/eval.mjs --post_dir <post_dir> --profile <profile>",
            "profiles": ["x-kingson-skill-runtime-text"],
        }
    )
    _write_skill(tmp_path, "clipsmith-x", gate)
    eval_dir = tmp_path / "skills" / "clipsmith-x" / "evals"
    eval_dir.mkdir()
    (eval_dir / "x-capture-evals.json").write_text(
        json.dumps(
            {
                "profiles": {
                    "x-kingson-skill-runtime-text": {
                        "source_url": "https://x.com/kingson4wu/status/2038257423081935288",
                        "expected_post_id": "2038257423081935288",
                        "author_handle": "kingson4wu",
                        "expected_type": "textOnly",
                        "min_post_chars": 200,
                        "min_image_count": 0,
                        "min_video_count": 0,
                        "require_mhtml": False,
                        "required_phrases": ["Agent Runtimes", "Skills"],
                        "forbidden_phrases": ["Log in"],
                    }
                }
            }
        ),
        encoding="utf-8",
    )

    issues = validate_skill_quality_gates(tmp_path)

    assert issues == []


def test_quality_gate_runner_materializes_commands_with_substitutions(tmp_path):
    gate = _valid_gate("clipsmith-web")
    gate["deterministic_checks"] = [
        {
            "name": "bundle validation",
            "command": "uv run clipsmith validate-bundle <bundle_dir>",
        }
    ]
    _write_skill(tmp_path, "clipsmith-web", gate)

    result = QualityGateRunner(tmp_path).plan(
        "clipsmith-web",
        substitutions={"bundle_dir": "/tmp/example bundle"},
    )

    assert result.skill == "clipsmith-web"
    assert result.ran is False
    assert len(result.commands) == 1
    assert result.commands[0].name == "bundle validation"
    assert (
        result.commands[0].command
        == "uv run clipsmith validate-bundle '/tmp/example bundle'"
    )
    assert result.commands[0].missing_placeholders == ()
    assert result.to_json_dict()["commands"][0]["runnable"] is True


def test_quality_gate_runner_skips_unresolved_placeholder_commands(tmp_path):
    gate = _valid_gate("clipsmith-web")
    gate["deterministic_checks"][0]["command"] = (
        "uv run clipsmith validate-bundle <bundle_dir>"
    )
    gate["deterministic_checks"].append(
        {
            "name": "known profile eval",
            "command": "node scripts/eval.mjs --bundle_dir <bundle_dir> --profile <profile>",
            "profiles": ["web-profile"],
        }
    )
    _write_skill(tmp_path, "clipsmith-web", gate)
    eval_dir = tmp_path / "skills" / "clipsmith-web" / "evals"
    eval_dir.mkdir()
    (eval_dir / "web-capture-evals.json").write_text(
        json.dumps(
            {
                "profiles": {
                    "web-profile": {
                        "source_url": "https://example.com/article",
                        "expected_status": "complete",
                        "title_includes": "Example",
                        "required_phrases": ["Example"],
                        "forbidden_phrases": ["Login"],
                    }
                }
            }
        ),
        encoding="utf-8",
    )

    result = QualityGateRunner(tmp_path).plan("clipsmith-web")

    assert [command.name for command in result.commands] == [
        "bundle validation",
        "known profile eval",
    ]
    assert result.commands[0].missing_placeholders == ("bundle_dir",)
    assert result.commands[1].missing_placeholders == ("bundle_dir", "profile")


def test_quality_gate_runner_executes_runnable_commands(tmp_path):
    gate = _valid_gate("clipsmith-web")
    gate["deterministic_checks"] = [
        {"name": "python smoke", "command": "python -c 'print(42)'"}
    ]
    _write_skill(tmp_path, "clipsmith-web", gate)

    result = QualityGateRunner(tmp_path).run("clipsmith-web")

    assert result.ran is True
    assert result.commands[0].exit_code == 0
    assert result.commands[0].stdout.strip() == "42"


def test_quality_gate_runner_does_not_pass_with_unresolved_placeholders(tmp_path):
    gate = _valid_gate("clipsmith-web")
    gate["deterministic_checks"] = [
        {"name": "needs bundle", "command": "python -c 'print(42)' <bundle_dir>"}
    ]
    _write_skill(tmp_path, "clipsmith-web", gate)

    result = QualityGateRunner(tmp_path).run("clipsmith-web")

    assert result.passed is False
    assert result.commands[0].exit_code is None
    assert result.commands[0].missing_placeholders == ("bundle_dir",)


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


def test_project_quality_gate_result_validates_xhs_eval_profile_contract(tmp_path):
    gate = _valid_gate("clipsmith-xhs", capture_kind="social-post")
    gate["deterministic_checks"].append(
        {
            "name": "known XHS profile eval",
            "command": "node scripts/eval.mjs --note_dir <note_dir> --profile <profile>",
            "profiles": ["broken-xhs-profile"],
        }
    )
    _write_skill(tmp_path, "clipsmith-xhs", gate)
    eval_dir = tmp_path / "skills" / "clipsmith-xhs" / "evals"
    eval_dir.mkdir()
    (eval_dir / "xhs-capture-evals.json").write_text(
        json.dumps(
            {
                "profiles": {
                    "broken-xhs-profile": {
                        "source_url": "http://xhslink.com/o/3DeHS3JuRiS",
                        "expected_note_id": "6a51e1580000000006035d09",
                    }
                }
            }
        ),
        encoding="utf-8",
    )

    result = validate_project_quality_gate_result(tmp_path)

    assert result.messages() == [
        "skills/clipsmith-xhs/evals/xhs-capture-evals.json profile broken-xhs-profile missing title_includes",
        "skills/clipsmith-xhs/evals/xhs-capture-evals.json profile broken-xhs-profile missing min_image_count",
        "skills/clipsmith-xhs/evals/xhs-capture-evals.json profile broken-xhs-profile missing expected_ocr_count",
        "skills/clipsmith-xhs/evals/xhs-capture-evals.json profile broken-xhs-profile missing min_ocr_chars",
        "skills/clipsmith-xhs/evals/xhs-capture-evals.json profile broken-xhs-profile missing required_post_phrases",
        "skills/clipsmith-xhs/evals/xhs-capture-evals.json profile broken-xhs-profile missing required_ocr_phrases",
        "skills/clipsmith-xhs/evals/xhs-capture-evals.json profile broken-xhs-profile missing forbidden_phrases",
    ]


def test_project_quality_gate_result_validates_wechat_eval_profile_contract(tmp_path):
    gate = _valid_gate("clipsmith-wechat", capture_kind="article")
    gate["deterministic_checks"].append(
        {
            "name": "known WeChat profile eval",
            "command": "node scripts/eval.mjs --article_dir <article_dir> --profile <profile>",
            "profiles": ["broken-wechat-profile"],
        }
    )
    _write_skill(tmp_path, "clipsmith-wechat", gate)
    eval_dir = tmp_path / "skills" / "clipsmith-wechat" / "evals"
    eval_dir.mkdir()
    (eval_dir / "wechat-capture-evals.json").write_text(
        json.dumps(
            {
                "profiles": {
                    "broken-wechat-profile": {
                        "source_url": "https://mp.weixin.qq.com/s/cwvelGaEzQKHfultsDjDUg",
                        "expected_article_id": "cwvelGaEzQKHfultsDjDUg",
                    }
                }
            }
        ),
        encoding="utf-8",
    )

    result = validate_project_quality_gate_result(tmp_path)

    assert result.messages() == [
        "skills/clipsmith-wechat/evals/wechat-capture-evals.json profile broken-wechat-profile missing title_includes",
        "skills/clipsmith-wechat/evals/wechat-capture-evals.json profile broken-wechat-profile missing account_includes",
        "skills/clipsmith-wechat/evals/wechat-capture-evals.json profile broken-wechat-profile missing min_image_count",
        "skills/clipsmith-wechat/evals/wechat-capture-evals.json profile broken-wechat-profile missing min_article_chars",
        "skills/clipsmith-wechat/evals/wechat-capture-evals.json profile broken-wechat-profile missing require_normalized_post",
        "skills/clipsmith-wechat/evals/wechat-capture-evals.json profile broken-wechat-profile missing min_normalized_headings",
        "skills/clipsmith-wechat/evals/wechat-capture-evals.json profile broken-wechat-profile missing max_normalized_line_chars",
        "skills/clipsmith-wechat/evals/wechat-capture-evals.json profile broken-wechat-profile missing required_phrases",
        "skills/clipsmith-wechat/evals/wechat-capture-evals.json profile broken-wechat-profile missing forbidden_phrases",
    ]


def test_project_quality_gate_result_validates_x_eval_profile_contract(tmp_path):
    gate = _valid_gate("clipsmith-x", capture_kind="social-post")
    gate["deterministic_checks"].append(
        {
            "name": "known X profile eval",
            "command": "node scripts/eval.mjs --post_dir <post_dir> --profile <profile>",
            "profiles": ["broken-x-profile"],
        }
    )
    _write_skill(tmp_path, "clipsmith-x", gate)
    eval_dir = tmp_path / "skills" / "clipsmith-x" / "evals"
    eval_dir.mkdir()
    (eval_dir / "x-capture-evals.json").write_text(
        json.dumps(
            {
                "profiles": {
                    "broken-x-profile": {
                        "source_url": "https://x.com/kingson4wu/status/2038257423081935288",
                        "expected_post_id": "2038257423081935288",
                    }
                }
            }
        ),
        encoding="utf-8",
    )

    result = validate_project_quality_gate_result(tmp_path)

    assert result.messages() == [
        "skills/clipsmith-x/evals/x-capture-evals.json profile broken-x-profile missing author_handle",
        "skills/clipsmith-x/evals/x-capture-evals.json profile broken-x-profile missing expected_type",
        "skills/clipsmith-x/evals/x-capture-evals.json profile broken-x-profile missing min_post_chars",
        "skills/clipsmith-x/evals/x-capture-evals.json profile broken-x-profile missing min_image_count",
        "skills/clipsmith-x/evals/x-capture-evals.json profile broken-x-profile missing min_video_count",
        "skills/clipsmith-x/evals/x-capture-evals.json profile broken-x-profile missing require_mhtml",
        "skills/clipsmith-x/evals/x-capture-evals.json profile broken-x-profile missing required_phrases",
        "skills/clipsmith-x/evals/x-capture-evals.json profile broken-x-profile missing forbidden_phrases",
    ]
