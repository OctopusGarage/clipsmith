import json
import tomllib
from pathlib import Path

from clipsmith.cli import main


FIXTURES = Path(__file__).parent / "fixtures"


def test_cli_version(capsys):
    code = main(["--version"])
    captured = capsys.readouterr()

    assert code == 0
    assert captured.out.strip() == "clipsmith 0.1.0"


def test_providers_json(capsys):
    code = main(["providers", "--json"])
    captured = capsys.readouterr()

    assert code == 0
    assert json.loads(captured.out) == [
        {
            "name": "xhs",
            "mode": "skill",
            "skill": "clipsmith-xhs",
            "domains": ["xiaohongshu.com", "xhslink.com"],
        },
        {
            "name": "x",
            "mode": "skill",
            "skill": "clipsmith-x",
            "domains": ["x.com", "twitter.com"],
        },
        {
            "name": "wechat",
            "mode": "skill",
            "skill": "clipsmith-wechat",
            "domains": ["mp.weixin.qq.com", "weixin.qq.com"],
        },
        {"name": "web", "mode": "skill", "skill": "clipsmith-web", "domains": ["*"]},
        {"name": "image-ocr", "mode": "skill", "skill": "clipsmith-ocr", "domains": []},
    ]


def test_providers_table_prints_execution_mode(capsys):
    code = main(["providers"])
    captured = capsys.readouterr()

    assert code == 0
    assert captured.out.splitlines()[0] == "name\tmode\tskill\tdomains"
    assert "xhs\tskill\tclipsmith-xhs\txiaohongshu.com, xhslink.com" in captured.out


def test_validate_bundle_json_reports_missing_capture_json(tmp_path, capsys):
    code = main(["validate-bundle", str(tmp_path), "--json"])
    captured = capsys.readouterr()

    assert code == 1
    assert json.loads(captured.out) == {
        "issues": [
            {
                "kind": "missing_capture_json",
                "path": "capture.json",
                "message": "Bundle is missing capture.json",
            }
        ]
    }


def test_validate_bundle_success(capsys):
    code = main(["validate-bundle", str(FIXTURES / "valid-xhs-bundle")])
    captured = capsys.readouterr()

    assert code == 0
    assert captured.out.strip() == "Bundle is valid"


def test_sink_directory_json_copies_bundle(tmp_path, capsys):
    output_dir = tmp_path / "output"

    code = main(
        [
            "sink",
            "directory",
            str(FIXTURES / "valid-xhs-bundle"),
            str(output_dir),
            "--json",
        ]
    )
    captured = capsys.readouterr()

    target = output_dir / "20260707-example-xhs"
    assert code == 0
    assert json.loads(captured.out) == {"status": "written", "path": str(target)}
    assert (target / "capture.json").is_file()


def test_sink_inbox_json_copies_bundle_to_platform_inbox(tmp_path, capsys):
    workspace = tmp_path / "workspace"

    code = main(
        [
            "sink",
            "inbox",
            str(FIXTURES / "valid-xhs-bundle"),
            str(workspace),
            "--json",
        ]
    )
    captured = capsys.readouterr()

    target = workspace / "inbox" / "xhs" / "20260707-example-xhs"
    assert code == 0
    assert json.loads(captured.out) == {"status": "written", "path": str(target)}
    assert (target / "capture.json").is_file()


def test_export_okf_json_writes_okf_concept(tmp_path, capsys):
    code = main(
        [
            "export",
            "okf",
            str(FIXTURES / "valid-xhs-bundle"),
            str(tmp_path),
            "--json",
        ]
    )
    captured = capsys.readouterr()

    target = tmp_path / "xhs" / "20260707-example-xhs.md"
    assert code == 0
    assert json.loads(captured.out) == {"status": "written", "path": str(target)}
    assert target.is_file()


def test_normalize_raw_json_writes_valid_bundle(tmp_path, capsys):
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    (raw_dir / "post.md").write_text(
        "# Example X Post\n\nCaptured post body.\n",
        encoding="utf-8",
    )
    bundle_dir = tmp_path / "20260711-example-x"

    code = main(
        [
            "normalize",
            "raw",
            "x",
            str(raw_dir),
            str(bundle_dir),
            "--source-url",
            "https://x.com/kingson4wu/status/2038257423081935288",
            "--title",
            "Example X Post",
            "--json",
        ]
    )
    captured = capsys.readouterr()

    assert code == 0
    assert json.loads(captured.out) == {
        "status": "written",
        "path": str(bundle_dir),
        "issues": [],
    }
    assert main(["validate-bundle", str(bundle_dir)]) == 0


def test_quality_gates_json_can_materialize_skill_commands(tmp_path, capsys):
    skill_dir = tmp_path / "skills" / "clipsmith-web"
    skill_dir.mkdir(parents=True)
    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "provider-quality-gate.md").write_text(
        "# Provider Quality Gate\n", encoding="utf-8"
    )
    (skill_dir / "quality-gate.json").write_text(
        json.dumps(
            {
                "version": 1,
                "skill": "clipsmith-web",
                "capture_kind": "article",
                "raw_evidence": ["post.md"],
                "deterministic_checks": [
                    {
                        "name": "bundle validation",
                        "command": "uv run clipsmith validate-bundle <bundle_dir> --json",
                    }
                ],
                "agent_ai_eval": {
                    "required": True,
                    "prompt": "docs/provider-quality-gate.md",
                },
                "ready_report": ["Provider quality gate: PASS|FAIL"],
            }
        ),
        encoding="utf-8",
    )

    code = main(
        [
            "quality-gates",
            "--root",
            str(tmp_path),
            "--skill",
            "clipsmith-web",
            "--bundle-dir",
            "/tmp/example bundle",
            "--json",
        ]
    )
    captured = capsys.readouterr()

    assert code == 0
    payload = json.loads(captured.out)
    assert payload["ran"] is False
    assert payload["commands"][0]["command"] == (
        "uv run clipsmith validate-bundle '/tmp/example bundle' --json"
    )
    assert payload["commands"][0]["runnable"] is True


def test_install_all_links_skills_into_agent_targets(tmp_path, monkeypatch, capsys):
    home = tmp_path / "home"
    codex_home = tmp_path / "codex"
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("CODEX_HOME", str(codex_home))

    code = main(["install", "--all"])
    captured = capsys.readouterr()

    assert code == 0
    assert "[claude] linked: clipsmith-capture" in captured.out
    assert "[codex] linked: clipsmith-capture" in captured.out
    assert (home / ".claude" / "skills" / "clipsmith-capture").is_symlink()
    assert (codex_home / "skills" / "clipsmith-capture").is_symlink()


def test_install_copy_excludes_development_assets(tmp_path, monkeypatch, capsys):
    codex_home = tmp_path / "codex"
    monkeypatch.setenv("CODEX_HOME", str(codex_home))

    code = main(
        [
            "install",
            "--codex",
            "--copy",
            "--only",
            "clipsmith-xhs,clipsmith-ocr",
        ]
    )
    captured = capsys.readouterr()

    xhs = codex_home / "skills" / "clipsmith-xhs"
    ocr = codex_home / "skills" / "clipsmith-ocr"
    assert code == 0
    assert "[codex] copied: clipsmith-xhs" in captured.out
    assert (xhs / "SKILL.md").is_file()
    assert (xhs / "scripts" / "run.ts").is_file()
    assert not (xhs / "scripts" / "eval.mjs").exists()
    assert not (xhs / "evals").exists()
    assert not (xhs / "tests").exists()
    assert not (xhs / "node_modules").exists()
    assert not (ocr / ".venv").exists()


def test_wheel_force_include_uses_runtime_skill_whitelist():
    pyproject = tomllib.loads(Path("pyproject.toml").read_text(encoding="utf-8"))
    force_include = pyproject["tool"]["hatch"]["build"]["targets"]["wheel"][
        "force-include"
    ]

    assert force_include.get("skills") is None
    for source, destination in force_include.items():
        if source == "script/eval-harness.mjs":
            assert destination == "clipsmith/script/eval-harness.mjs"
            continue
        assert source.startswith("skills/")
        assert destination.startswith("clipsmith/skills/")
        assert "/evals" not in source
        assert "/tests" not in source
        assert "/node_modules" not in source
        assert "/.venv" not in source


def test_uninstall_all_removes_owned_skill_links(tmp_path, monkeypatch, capsys):
    home = tmp_path / "home"
    codex_home = tmp_path / "codex"
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("CODEX_HOME", str(codex_home))
    assert main(["install", "--all"]) == 0
    capsys.readouterr()

    code = main(["uninstall", "--all"])
    captured = capsys.readouterr()

    assert code == 0
    assert "[claude] removed link: clipsmith-capture" in captured.out
    assert "[codex] removed link: clipsmith-capture" in captured.out
    assert not (home / ".claude" / "skills" / "clipsmith-capture").exists()
    assert not (codex_home / "skills" / "clipsmith-capture").exists()


def test_doctor_json_reports_tooling_status(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    monkeypatch.setenv("CODEX_HOME", str(tmp_path / "codex"))

    def fake_which(command):
        return f"/usr/bin/{command}" if command in {"uv", "node"} else None

    monkeypatch.setattr("clipsmith.installation.shutil.which", fake_which)

    code = main(["doctor", "--json"])
    captured = capsys.readouterr()

    payload = json.loads(captured.out)
    checks = {check["name"]: check for check in payload["checks"]}
    assert code == 1
    assert checks["skills_source"]["status"] == "ok"
    assert checks["uv"]["status"] == "ok"
    assert checks["node"]["status"] == "ok"
    assert checks["npm"]["status"] == "missing"
    assert checks["claude_skills_dir"]["status"] == "missing"


def test_quality_gates_json_reports_typed_plans(tmp_path, capsys):
    skill_dir = tmp_path / "skills" / "clipsmith-web"
    skill_dir.mkdir(parents=True)
    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "provider-quality-gate.md").write_text(
        "# Provider Quality Gate\n", encoding="utf-8"
    )
    (skill_dir / "SKILL.md").write_text(
        "---\nname: clipsmith-web\n---\n# clipsmith-web\n", encoding="utf-8"
    )
    (skill_dir / "quality-gate.json").write_text(
        json.dumps(
            {
                "version": 1,
                "skill": "clipsmith-web",
                "capture_kind": "article",
                "raw_evidence": ["post.md"],
                "deterministic_checks": [
                    {
                        "name": "bundle validation",
                        "command": "uv run clipsmith validate-bundle <bundle_dir> --json",
                    }
                ],
                "agent_ai_eval": {
                    "required": True,
                    "prompt": "docs/provider-quality-gate.md",
                },
                "ready_report": ["Provider quality gate: PASS|FAIL"],
            }
        ),
        encoding="utf-8",
    )

    code = main(["quality-gates", "--root", str(tmp_path), "--json"])
    captured = capsys.readouterr()

    payload = json.loads(captured.out)
    assert code == 0
    assert payload["issues"] == []
    assert payload["plans"][0]["skill"] == "clipsmith-web"
    assert payload["plans"][0]["deterministic_checks"][0]["name"] == (
        "bundle validation"
    )
