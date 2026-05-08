#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
TARGET_DIR="${HOME}/.config/opencode"

PLUGIN_SOURCE="$REPO_DIR/plugins/opencode-notify.ts"
PLUGIN_DEST_REL="plugins/opencode-notify.ts"
PLUGIN_DEST="$TARGET_DIR/$PLUGIN_DEST_REL"
CONFIG_DEST="$TARGET_DIR/notify.json"

usage() {
  cat <<'EOF'
Usage: bash scripts/status.sh [options]

Options:
  --target-dir <path>   Target OpenCode config dir (default: ~/.config/opencode)
  -h, --help            Show this help
EOF
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --target-dir)
      TARGET_DIR="$2"
      PLUGIN_DEST="$TARGET_DIR/$PLUGIN_DEST_REL"
      CONFIG_DEST="$TARGET_DIR/notify.json"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

printf 'target_dir=%s\n' "$TARGET_DIR"

if [[ -e "$PLUGIN_DEST" ]]; then
  printf 'plugin_installed=yes\n'
  if cmp -s "$PLUGIN_SOURCE" "$PLUGIN_DEST"; then
    printf 'plugin_matches_repo=yes\n'
  else
    printf 'plugin_matches_repo=no\n'
  fi
else
  printf 'plugin_installed=no\n'
  printf 'plugin_matches_repo=unknown\n'
fi

if [[ -e "$CONFIG_DEST" ]]; then
  printf 'notify_config_present=yes\n'
else
  printf 'notify_config_present=no\n'
fi

if [[ -e "$TARGET_DIR/node_modules/@opencode-ai/plugin/package.json" ]]; then
  printf 'runtime_dep_plugin=yes\n'
else
  printf 'runtime_dep_plugin=no\n'
fi

if [[ -e "$TARGET_DIR/node_modules/@opencode-ai/sdk/package.json" ]]; then
  printf 'runtime_dep_sdk=yes\n'
else
  printf 'runtime_dep_sdk=no\n'
fi
