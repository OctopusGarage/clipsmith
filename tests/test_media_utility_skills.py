from pathlib import Path


PROJECT_ROOT = Path(__file__).parents[1]
LOCAL_CHECKOUT_PATH = "/" + "/".join(
    ["Users", "kingsonwu", "programming", "OctopusGarage", "clipsmith"]
)


def test_media_utility_skills_are_split_by_single_responsibility():
    skills_root = PROJECT_ROOT / "skills"

    assert (skills_root / "clipsmith-video-audio" / "skill.yaml").is_file()
    assert (skills_root / "clipsmith-audio-transcript" / "skill.yaml").is_file()
    assert (skills_root / "clipsmith-video-snapshot" / "skill.yaml").is_file()
    assert not (skills_root / "clipsmith-video").exists()


def test_video_snapshot_skill_delegates_ocr_to_clipsmith_ocr():
    skill_md = (
        PROJECT_ROOT / "skills" / "clipsmith-video-snapshot" / "SKILL.md"
    ).read_text(encoding="utf-8")

    assert "clipsmith-ocr" in skill_md
    assert "Vision.framework" not in skill_md


def test_runtime_docs_do_not_embed_local_checkout_path():
    scanned_roots = [
        PROJECT_ROOT / "AGENTS.md",
        PROJECT_ROOT / "CLAUDE.md",
        PROJECT_ROOT / "README.md",
        PROJECT_ROOT / "docs",
        PROJECT_ROOT / "skills",
    ]
    offenders = []

    for root in scanned_roots:
        files = [root] if root.is_file() else sorted(root.rglob("*"))
        for path in files:
            if not path.is_file():
                continue
            if any(part in {"node_modules", ".venv"} for part in path.parts):
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            if LOCAL_CHECKOUT_PATH in text:
                offenders.append(path.relative_to(PROJECT_ROOT).as_posix())

    assert offenders == []
