#!/usr/bin/env bash
# Validate Clipsmith CLI, fixtures, and agent-skill project contracts.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "== pytest =="
uv run pytest -q

echo "== providers =="
uv run clipsmith providers --json >/tmp/clipsmith-providers.json

echo "== valid fixture bundle =="
uv run clipsmith validate-bundle tests/fixtures/valid-xhs-bundle --json

echo "== shell syntax =="
while IFS= read -r file; do
  bash -n "$file"
done < <({ [ -f install.sh ] && printf '%s\n' install.sh; find script .githooks -type f; } | sort)

echo "== optional python formatting =="
if uv run ruff --version >/dev/null 2>&1; then
  uv run ruff format --check src tests
else
  echo "ruff unavailable; skipping format check"
fi

echo "== skill contract =="
uv run python - <<'PY'
from __future__ import annotations

import json
from pathlib import Path
import re
import subprocess
import sys

from clipsmith.providers import ProviderRegistry

root = Path.cwd()
skills_root = root / "skills"
name_re = re.compile(r"^[a-z0-9-]{1,64}$")
secret_re = re.compile(
    r"(sk-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,})"
)
errors: list[str] = []


def fail(message: str) -> None:
    errors.append(f"ERROR: {message}")


def parse_frontmatter_name(path: Path) -> str:
    lines = path.read_text("utf-8").splitlines()
    if not lines or lines[0].strip() != "---":
        return ""
    for line in lines[1:]:
        if line.strip() == "---":
            break
        if line.startswith("name:"):
            return line.split(":", 1)[1].strip().strip("'\"")
    return ""


def openai_yaml_has_contract(path: Path) -> tuple[bool, list[str]]:
    text = path.read_text("utf-8")
    missing: list[str] = []
    if "display_name:" not in text:
        missing.append("display_name")
    if "default_prompt:" not in text:
        missing.append("default_prompt")
    if "description:" not in text and "short_description:" not in text:
        missing.append("description")
    return not missing, missing


def read_top_level_yamlish_keys(path: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    for line in path.read_text("utf-8").splitlines():
        if not line or line.startswith(" ") or line.startswith("-") or ":" not in line:
            continue
        key, value = line.split(":", 1)
        result[key.strip()] = value.strip().strip("'\"")
    return result


def path_reference_is_safe(value: str) -> bool:
    if not value:
        return True
    if value.startswith(("/", "~")):
        return False
    if ".." in Path(value).parts:
        return False
    return True


if not skills_root.is_dir():
    fail("missing skills/ directory")
else:
    skill_dirs = sorted(path for path in skills_root.iterdir() if path.is_dir())
    if not skill_dirs:
        fail("skills/ has no skill directories")
    for skill_dir in skill_dirs:
        name = skill_dir.name
        print(f"Checking {skill_dir.relative_to(root)}")
        if not name_re.match(name):
            fail(f"bad skill directory name: {name}")

        skill_md = skill_dir / "SKILL.md"
        if not skill_md.is_file():
            fail(f"{name} missing SKILL.md")
        else:
            frontmatter_name = parse_frontmatter_name(skill_md)
            if frontmatter_name != name:
                fail(f"{name} SKILL.md name {frontmatter_name!r} != directory name")

        openai_yaml = skill_dir / "agents" / "openai.yaml"
        if not openai_yaml.is_file():
            fail(f"{name} missing agents/openai.yaml")
        else:
            ok, missing = openai_yaml_has_contract(openai_yaml)
            if not ok:
                fail(f"{name} agents/openai.yaml missing {', '.join(missing)}")

        skill_yaml = skill_dir / "skill.yaml"
        if skill_yaml.is_file():
            keys = read_top_level_yamlish_keys(skill_yaml)
            executor = keys.get("executor")
            if executor and not (skill_dir / executor).is_file():
                fail(f"{name} skill.yaml executor does not exist: {executor}")

provider_skills = {provider.skill for provider in ProviderRegistry.default().list()}
actual_skills = {path.name for path in skills_root.iterdir() if path.is_dir()} if skills_root.is_dir() else set()
missing_provider_skills = sorted(provider_skills - actual_skills)
if missing_provider_skills:
    fail(f"provider registry references missing skills: {missing_provider_skills}")

providers_json = json.loads(Path("/tmp/clipsmith-providers.json").read_text("utf-8"))
json_skills = {item["skill"] for item in providers_json}
if json_skills != provider_skills:
    fail("providers CLI JSON does not match ProviderRegistry.default()")

tracked_files = {
    line.strip()
    for line in subprocess.run(
        ["git", "ls-files"], check=True, text=True, stdout=subprocess.PIPE
    ).stdout.splitlines()
}
if ".env" in tracked_files:
    fail(".env must not be tracked")

env_example = root / ".env.example"
if env_example.is_file() and secret_re.search(env_example.read_text("utf-8")):
    fail(".env.example appears to contain a credential-shaped value")

fixtures_root = root / "tests" / "fixtures"
for capture_json in fixtures_root.glob("**/capture.json"):
    data = json.loads(capture_json.read_text("utf-8"))
    for key in ("source_url", "canonical_url"):
        value = data.get(key)
        if isinstance(value, str) and (value.startswith("file:/") or value.startswith("~")):
            fail(f"{capture_json.relative_to(root)} has unsafe {key}: {value}")
    for item in [*data.get("content_files", []), *data.get("assets", [])]:
        value = item.get("path") if isinstance(item, dict) else None
        if isinstance(value, str) and not path_reference_is_safe(value):
            fail(f"{capture_json.relative_to(root)} has unsafe bundle path: {value}")

if errors:
    print("\n".join(errors), file=sys.stderr)
    sys.exit(1)

print("skill contract OK")
PY

echo "check-health: OK"
