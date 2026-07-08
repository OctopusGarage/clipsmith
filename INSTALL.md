# Install Clipsmith

Clipsmith has two install surfaces:

- the `clipsmith` CLI
- agent skills for Claude Code and Codex

## Quick Install From GitHub

```bash
git clone https://github.com/OctopusGarage/clipsmith.git
cd clipsmith
./install.sh --all
```

This installs the CLI from the local clone and symlinks all skills into:

```text
~/.claude/skills/
$CODEX_HOME/skills/   # defaults to ~/.codex/skills
```

Restart Claude Code or Codex after installing skills.

## CLI Only

Install directly from GitHub:

```bash
uv tool install --force git+https://github.com/OctopusGarage/clipsmith.git
clipsmith --version
clipsmith providers --json
```

For editable local development:

```bash
git clone https://github.com/OctopusGarage/clipsmith.git
cd clipsmith
uv tool install --force -e .
```

## Skills Only

```bash
./install.sh --all --no-cli
./install.sh --claude --no-cli
./install.sh --codex --no-cli
```

Use `--copy` if you want a snapshot copy instead of symlinks.

## Uninstall

```bash
./install.sh --all --uninstall
```

The uninstall command removes symlinks created by this repository. It does not
delete foreign skill directories or copied skill snapshots.
