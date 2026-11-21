from clipsmith.installation import InstallOptions, install_skills_report


def test_install_skills_report_returns_structured_operations_without_printing(
    tmp_path, monkeypatch, capsys
):
    codex_home = tmp_path / "codex"
    monkeypatch.setenv("CODEX_HOME", str(codex_home))

    report = install_skills_report(
        InstallOptions(
            action="install",
            claude=False,
            codex=True,
            copy=False,
            only="clipsmith-capture",
        )
    )
    captured = capsys.readouterr()

    assert captured.out == ""
    assert report.action == "install"
    assert report.selected == ("clipsmith-capture",)
    assert len(report.targets) == 1
    assert report.targets[0].label == "codex"
    assert report.targets[0].changed == 1
    assert report.targets[0].skipped == 0
    assert report.targets[0].operations[0].status == "linked"
    assert report.to_lines() == [
        "[codex] linked: clipsmith-capture",
        "[codex] done: 1 changed, 0 skipped",
    ]


def test_uninstall_one_browser_skill_keeps_shared_runtime(tmp_path, monkeypatch):
    codex_home = tmp_path / "codex"
    monkeypatch.setenv("CODEX_HOME", str(codex_home))

    install_report = install_skills_report(
        InstallOptions(
            action="install",
            claude=False,
            codex=True,
            copy=False,
            only="clipsmith-xhs,clipsmith-wechat",
        )
    )
    shared = codex_home / "skills" / "_shared"
    assert install_report.targets[0].changed == 3
    assert shared.is_dir()

    uninstall_report = install_skills_report(
        InstallOptions(
            action="uninstall",
            claude=False,
            codex=True,
            copy=False,
            only="clipsmith-xhs",
        )
    )

    assert uninstall_report.targets[0].operations[0].skill == "clipsmith-xhs"
    assert shared.is_dir()


def test_doctor_reports_missing_web_runtime(tmp_path, monkeypatch):
    from clipsmith.installation import doctor_checks

    source = tmp_path / "skills"
    skill = source / "clipsmith-web"
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text("---\nname: clipsmith-web\n---\n")
    (skill / "package.json").write_text('{"type":"module"}')
    monkeypatch.setattr(
        "clipsmith.installation._safe_find_skills_source", lambda: source
    )
    checks = {c["name"]: c for c in doctor_checks()}
    assert checks["clipsmith_web_runtime"]["status"] == "missing"
    assert "npm ci" in checks["clipsmith_web_runtime"]["message"]
