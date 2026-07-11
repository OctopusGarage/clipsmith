#!/usr/bin/env bash
# Install Clipsmith CLI and agent skills for Claude Code and/or Codex.
# Bash 3.2 compatible.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_DIR="$REPO_DIR/skills"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"

MODE="symlink"
ACTION="install"
WANT_CLAUDE=""
WANT_CODEX=""
WANT_CLI="1"
ONLY=""
SKIP=""
explicit_target=0

usage() {
  cat <<'EOF'
Usage: ./install.sh [options]

  (no flags)    Install CLI and auto-detected Claude/Codex skills
  --claude      Install skills into Claude Code only (~/.claude/skills)
  --codex       Install skills into Codex only ($CODEX_HOME/skills)
  --all         Force both Claude Code and Codex skill targets
  --copy        Copy skills instead of symlinking
  --no-cli      Do not install the clipsmith CLI
  --uninstall   Remove this repo's skill links and uninstall CLI
  --only a,b    Install only comma-separated skills
  --skip a,b    Install all skills except comma-separated skills
  -h, --help    Show this help
EOF
}

die() { echo "ERROR: $*" >&2; exit 1; }

prune_skill_copy() {
  dest="$1"
  rm -rf \
    "$dest/.DS_Store" \
    "$dest/.mypy_cache" \
    "$dest/.pytest_cache" \
    "$dest/.ruff_cache" \
    "$dest/.venv" \
    "$dest/__pycache__" \
    "$dest/coverage" \
    "$dest/coverage.xml" \
    "$dest/evals" \
    "$dest/htmlcov" \
    "$dest/node_modules" \
    "$dest/playwright-report" \
    "$dest/test-results" \
    "$dest/tests" \
    "$dest/venv"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --claude) WANT_CLAUDE=1; WANT_CODEX=""; explicit_target=1 ;;
    --codex) WANT_CODEX=1; WANT_CLAUDE=""; explicit_target=1 ;;
    --all) WANT_CLAUDE=1; WANT_CODEX=1; explicit_target=1 ;;
    --copy) MODE="copy" ;;
    --no-cli) WANT_CLI="" ;;
    --uninstall) ACTION="uninstall" ;;
    --only) ONLY="${2:-}"; [ -n "$ONLY" ] || die "--only needs a value"; shift ;;
    --skip) SKIP="${2:-}"; [ -n "$SKIP" ] || die "--skip needs a value"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
  shift
done

[ -d "$SKILLS_DIR" ] || die "missing skills directory: $SKILLS_DIR"

if [ "$explicit_target" -eq 0 ]; then
  [ -d "$HOME/.claude" ] && WANT_CLAUDE=1
  [ -d "$CODEX_HOME" ] && WANT_CODEX=1
fi

ALL=""
for d in "$SKILLS_DIR"/*/; do
  [ -d "$d" ] || continue
  ALL="$ALL $(basename "${d%/}")"
done
ALL="$(printf '%s\n' $ALL | sort | tr '\n' ' ')"
ALL="${ALL# }"; ALL="${ALL% }"

validate_names() {
  for name in $1; do
    case " $ALL " in
      *" $name "*) ;;
      *) die "unknown skill: $name (available: $ALL)" ;;
    esac
  done
}

if [ -n "$ONLY" ] && [ -n "$SKIP" ]; then
  die "--only and --skip are mutually exclusive"
fi

if [ -n "$ONLY" ]; then
  SELECTED="$(echo "$ONLY" | tr ',' ' ')"
  validate_names "$SELECTED"
elif [ -n "$SKIP" ]; then
  skip_list="$(echo "$SKIP" | tr ',' ' ')"
  validate_names "$skip_list"
  SELECTED=""
  for name in $ALL; do
    case " $skip_list " in *" $name "*) ;; *) SELECTED="$SELECTED $name" ;; esac
  done
  SELECTED="${SELECTED# }"
else
  SELECTED="$ALL"
fi

install_cli() {
  if [ -z "$WANT_CLI" ]; then
    return
  fi
  if ! command -v uv >/dev/null 2>&1; then
    die "uv is required to install the CLI. Install uv first or pass --no-cli."
  fi
  if [ "$ACTION" = "uninstall" ]; then
    uv tool uninstall clipsmith >/dev/null 2>&1 || true
    echo "[cli] uninstalled clipsmith if present"
  else
    uv tool install --force -e "$REPO_DIR"
    echo "[cli] installed clipsmith"
  fi
}

process_target() {
  target_root="$1"
  label="$2"
  changed=0
  skipped=0
  mkdir -p "$target_root"
  for src in "$SKILLS_DIR"/*/; do
    src="${src%/}"
    [ -d "$src" ] || continue
    name="$(basename "$src")"
    case " $SELECTED " in *" $name "*) ;; *) continue ;; esac
    dest="$target_root/$name"

    if [ "$ACTION" = "uninstall" ]; then
      if [ -L "$dest" ]; then
        case "$(readlink "$dest")" in
          "$REPO_DIR"/*) rm -f "$dest"; echo "[$label] removed link: $name"; changed=$((changed + 1)) ;;
          *) echo "[$label] skip foreign link: $name"; skipped=$((skipped + 1)) ;;
        esac
      elif [ -d "$dest" ]; then
        echo "[$label] skip real directory: $name"
        skipped=$((skipped + 1))
      fi
      continue
    fi

    if [ -L "$dest" ]; then
      case "$(readlink "$dest")" in
        "$REPO_DIR"/*) rm -f "$dest" ;;
        *) echo "[$label] skip foreign link: $name"; skipped=$((skipped + 1)); continue ;;
      esac
    elif [ -e "$dest" ]; then
      echo "[$label] skip existing non-link: $name"
      skipped=$((skipped + 1))
      continue
    fi

    if [ "$MODE" = "copy" ]; then
      cp -R "$src" "$dest"
      prune_skill_copy "$dest"
      echo "[$label] copied: $name"
    else
      ln -s "$src" "$dest"
      echo "[$label] linked: $name"
    fi
    changed=$((changed + 1))
  done
  echo "[$label] done: $changed changed, $skipped skipped"
}

install_cli
[ -n "$WANT_CLAUDE" ] && process_target "$HOME/.claude/skills" "claude"
[ -n "$WANT_CODEX" ] && process_target "$CODEX_HOME/skills" "codex"

if [ "$ACTION" = "install" ] && git -C "$REPO_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  git -C "$REPO_DIR" config core.hooksPath .githooks
  echo "[git] configured core.hooksPath=.githooks"
fi

echo "Done."
