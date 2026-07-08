# Install Clipsmith

Clipsmith has two install surfaces:

- the `clipsmith` CLI
- agent skills for Claude Code and Codex

## Quick Install From GitHub

```bash
uv tool install --force git+https://github.com/OctopusGarage/clipsmith.git
clipsmith install --all
clipsmith doctor
```

This installs the CLI, symlinks all bundled skills into Claude Code and Codex,
then checks local dependencies.

```text
~/.claude/skills/
$CODEX_HOME/skills/   # defaults to ~/.codex/skills
```

Restart Claude Code or Codex after installing skills.

## Source Clone Install

```bash
git clone https://github.com/OctopusGarage/clipsmith.git
cd clipsmith
./install.sh --all
```

The source installer installs the CLI from the local clone and links skills from
that checkout. Use this when developing skills or when you want changes in the
clone to be visible immediately.

## CLI Only

```bash
uv tool install --force git+https://github.com/OctopusGarage/clipsmith.git
clipsmith --version
clipsmith providers --json
```

For editable local development, run `uv tool install --force -e .` from a clone.

## Skills

```bash
clipsmith install --all
clipsmith install --claude
clipsmith install --codex
```

Use `--copy` if you want a snapshot copy instead of symlinks.

Source clone equivalents:

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

`doctor` checks for the bundled skills directory, Claude/Codex skill targets,
and common runtime dependencies such as `uv`, Node.js, npm/npx, pnpm, git, and
macOS Vision OCR support.

## Uninstall

```bash
clipsmith uninstall --all
```

The uninstall command removes symlinks created by this repository. It does not
delete foreign skill directories or copied skill snapshots.

Source clone equivalent:

```bash
./install.sh --all --uninstall
```
