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
    assert (skills_root / "clipsmith-image-metadata-sanitize" / "skill.yaml").is_file()
    assert (skills_root / "clipsmith-video-metadata-sanitize" / "skill.yaml").is_file()
    assert not (skills_root / "clipsmith-video").exists()


def test_video_snapshot_skill_delegates_ocr_to_clipsmith_ocr():
    skill_md = (
        PROJECT_ROOT / "skills" / "clipsmith-video-snapshot" / "SKILL.md"
    ).read_text(encoding="utf-8")

    assert "clipsmith-ocr" in skill_md
    assert "Vision.framework" not in skill_md


def test_metadata_sanitize_skills_do_not_claim_visible_redaction_or_capture():
    skills_root = PROJECT_ROOT / "skills"
    skill_docs = [
        skills_root / "clipsmith-image-metadata-sanitize" / "SKILL.md",
        skills_root / "clipsmith-video-metadata-sanitize" / "SKILL.md",
    ]

    for path in skill_docs:
        text = path.read_text(encoding="utf-8")
        assert "hidden metadata" in text
        assert "visible" in text
        assert "ProviderRegistry" not in text
        assert "domains:" not in text

    image_text = skill_docs[0].read_text(encoding="utf-8")
    video_text = skill_docs[1].read_text(encoding="utf-8")
    assert "does not OCR, blur" in image_text
    assert "does not" in video_text
    assert "transcribe audio" in video_text
    assert "create snapshots" in video_text
    assert "run OCR" in video_text


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
