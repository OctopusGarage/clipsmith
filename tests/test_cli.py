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
