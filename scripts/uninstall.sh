#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
TARGET_DIR="${HOME}/.config/opencode"
DRY_RUN=0
REMOVE_CONFIG=0

PLUGIN_DEST_REL="plugins/opencode-notify.ts"
PLUGIN_DEST="$TARGET_DIR/$PLUGIN_DEST_REL"
CONFIG_DEST="$TARGET_DIR/notify.json"

usage() {
  cat <<'EOF'
Usage: bash scripts/uninstall.sh [options]

Options:
  --target-dir <path>   Target OpenCode config dir (default: ~/.config/opencode)
  --dry-run             Show actions without writing files
  --remove-config       Remove notify.json too
  -h, --help            Show this help
EOF
}

log() {
  printf '[notifier-uninstall] %s\n' "$*"
}

run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '[dry-run] %s\n' "$*"
    return 0
  fi
  "$@"
}

backup_and_remove() {
  local source_path="$1"
  local rel_path="$2"
  local timestamp backup_dir

  if [[ ! -e "$source_path" ]]; then
    return 0
  fi

  timestamp="$(date +%Y%m%d-%H%M%S)"
  backup_dir="$TARGET_DIR/.notifier-backups/uninstall-$timestamp"
  run mkdir -p "$(dirname -- "$backup_dir/$rel_path")"
  run cp "$source_path" "$backup_dir/$rel_path"
  run rm -f "$source_path"
  log "Backup creado y archivo removido: $backup_dir/$rel_path"
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --target-dir)
      TARGET_DIR="$2"
      PLUGIN_DEST="$TARGET_DIR/$PLUGIN_DEST_REL"
      CONFIG_DEST="$TARGET_DIR/notify.json"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --remove-config)
      REMOVE_CONFIG=1
      shift
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

log "Repo dir: $REPO_DIR"
log "Target dir: $TARGET_DIR"

if [[ -e "$PLUGIN_DEST" ]]; then
  backup_and_remove "$PLUGIN_DEST" "$PLUGIN_DEST_REL"
else
  log "No existe $PLUGIN_DEST; no hay nada que remover"
fi

if [[ "$REMOVE_CONFIG" -eq 1 ]]; then
  if [[ -e "$CONFIG_DEST" ]]; then
    backup_and_remove "$CONFIG_DEST" "notify.json"
  else
    log "No existe $CONFIG_DEST; no hay config para remover"
  fi
else
  log "Se deja intacto $CONFIG_DEST"
fi

log "Uninstall finalizado"
