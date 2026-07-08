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
