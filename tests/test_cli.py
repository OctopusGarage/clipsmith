import json
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
