# Install Clipsmith

Clipsmith ships as a CLI plus agent skills for Codex and Claude Code.

## GitHub Install

```bash
uv tool install --force git+https://github.com/OctopusGarage/clipsmith.git
clipsmith install --all
clipsmith doctor
```

Skill targets:

```text
~/.claude/skills/
$CODEX_HOME/skills/   # defaults to ~/.codex/skills
```

Restart Codex or Claude Code after installing skills.

## Source Install

```bash
git clone https://github.com/OctopusGarage/clipsmith.git
cd clipsmith
./install.sh --all
```

Use this when developing the repo or when skill changes should be visible
immediately.

## CLI Only

```bash
uv tool install --force git+https://github.com/OctopusGarage/clipsmith.git
clipsmith providers --json
```

Editable local install:

```bash
uv tool install --force -e .
```

## Skills Only

```bash
clipsmith install --all
clipsmith install --claude
clipsmith install --codex
clipsmith install --all --copy
```

Source equivalents:

```bash
./install.sh --all --no-cli
./install.sh --claude --no-cli
./install.sh --codex --no-cli
```

## Doctor

```bash
clipsmith doctor
clipsmith doctor --json
```

Doctor checks skill locations and common runtime tools such as `uv`, Node.js,
npm/npx, pnpm, git, and macOS Vision OCR support.

## Uninstall

```bash
clipsmith uninstall --all
./install.sh --all --uninstall
```

Uninstall removes links created by Clipsmith. It does not delete foreign skill
directories or copied snapshots.
