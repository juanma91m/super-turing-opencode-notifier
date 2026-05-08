#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
TARGET_DIR="${HOME}/.config/opencode"
DRY_RUN=0
INSTALL_EXAMPLE_CONFIG=0

PLUGIN_SOURCE="$REPO_DIR/plugins/opencode-notify.ts"
PLUGIN_DEST_REL="plugins/opencode-notify.ts"
PLUGIN_DEST="$TARGET_DIR/$PLUGIN_DEST_REL"
EXAMPLE_CONFIG_SOURCE="$REPO_DIR/notify.example.json"
CONFIG_DEST="$TARGET_DIR/notify.json"

usage() {
  cat <<'EOF'
Usage: bash scripts/install.sh [options]

Options:
  --target-dir <path>           Target OpenCode config dir (default: ~/.config/opencode)
  --dry-run                     Show actions without writing files
  --install-example-config      Copy notify.example.json if notify.json does not exist
  -h, --help                    Show this help
EOF
}

log() {
  printf '[notifier-install] %s\n' "$*"
}

warn() {
  printf '[notifier-install][warn] %s\n' "$*" >&2
}

join_by_space() {
  local IFS=' '
  printf '%s' "$*"
}

is_gnome_desktop() {
  local desktop="${XDG_CURRENT_DESKTOP:-}:${XDG_SESSION_DESKTOP:-}"
  desktop="$(printf '%s' "$desktop" | tr '[:upper:]' '[:lower:]')"
  [[ "$desktop" == *gnome* ]]
}

focus_helpers_install_hint() {
  local packages=("$@")
  local package_list
  package_list="$(join_by_space "${packages[@]}")"

  if command -v apt-get >/dev/null 2>&1; then
    printf 'sudo apt install %s' "$package_list"
    return 0
  fi

  if command -v dnf >/dev/null 2>&1; then
    printf 'sudo dnf install %s' "$package_list"
    return 0
  fi

  if command -v pacman >/dev/null 2>&1; then
    printf 'sudo pacman -S %s' "$package_list"
    return 0
  fi

  if command -v zypper >/dev/null 2>&1; then
    printf 'sudo zypper install %s' "$package_list"
    return 0
  fi

  printf '%s' "$package_list"
}

run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '[dry-run] %s\n' "$*"
    return 0
  fi
  "$@"
}

maybe_backup_existing_plugin() {
  local timestamp backup_dir
  if [[ ! -e "$PLUGIN_DEST" ]]; then
    return 0
  fi

  if cmp -s "$PLUGIN_SOURCE" "$PLUGIN_DEST"; then
    log "El plugin ya está instalado y coincide con este repo"
    return 0
  fi

  timestamp="$(date +%Y%m%d-%H%M%S)"
  backup_dir="$TARGET_DIR/.notifier-backups/$timestamp"
  run mkdir -p "$(dirname -- "$backup_dir/$PLUGIN_DEST_REL")"
  run cp "$PLUGIN_DEST" "$backup_dir/$PLUGIN_DEST_REL"
  log "Backup del plugin previo: $backup_dir/$PLUGIN_DEST_REL"
}

maybe_warn_runtime_deps() {
  local missing=()

  [[ -e "$TARGET_DIR/node_modules/@opencode-ai/plugin/package.json" ]] || missing+=("@opencode-ai/plugin")
  [[ -e "$TARGET_DIR/node_modules/@opencode-ai/sdk/package.json" ]] || missing+=("@opencode-ai/sdk")

  if [[ "${#missing[@]}" -gt 0 ]]; then
    warn "No se detectaron dependencias runtime esperadas en $TARGET_DIR/node_modules: ${missing[*]}"
    warn "Si no usás super-turing-opencode como base, asegurá una instalación equivalente antes de probar el plugin"
  fi
}

maybe_warn_gnome_focus_helpers() {
  local missing=()
  local hint
  local package_list
  local session_type="${XDG_SESSION_TYPE:-desconocido}"

  if [[ "$(uname -s)" != "Linux" ]]; then
    return 0
  fi

  if ! is_gnome_desktop; then
    return 0
  fi

  command -v wmctrl >/dev/null 2>&1 || missing+=("wmctrl")
  command -v xdotool >/dev/null 2>&1 || missing+=("xdotool")

  if [[ "${#missing[@]}" -eq 0 ]]; then
    return 0
  fi

  hint="$(focus_helpers_install_hint "${missing[@]}")"
  package_list="$(join_by_space "${missing[@]}")"

  if [[ "$session_type" == "x11" ]]; then
    warn "Entorno GNOME/X11 detectado. Para mejorar el click-to-focus del notifier conviene instalar ${package_list}. Sugerencia: ${hint}"
    return 0
  fi

  warn "Entorno GNOME detectado (sesión ${session_type}). Si también usás GNOME/X11, conviene instalar ${package_list} para mejorar el click-to-focus del notifier. Sugerencia: ${hint}"
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
    --install-example-config)
      INSTALL_EXAMPLE_CONFIG=1
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

if [[ ! -f "$PLUGIN_SOURCE" ]]; then
  printf 'Missing plugin source: %s\n' "$PLUGIN_SOURCE" >&2
  exit 1
fi

log "Repo dir: $REPO_DIR"
log "Target dir: $TARGET_DIR"

maybe_warn_runtime_deps
maybe_warn_gnome_focus_helpers
maybe_backup_existing_plugin

run mkdir -p "$(dirname -- "$PLUGIN_DEST")"
run cp "$PLUGIN_SOURCE" "$PLUGIN_DEST"
log "Plugin instalado en $PLUGIN_DEST"

if [[ "$INSTALL_EXAMPLE_CONFIG" -eq 1 ]]; then
  if [[ -e "$CONFIG_DEST" ]]; then
    log "Se deja intacto $CONFIG_DEST porque ya existe"
  else
    run cp "$EXAMPLE_CONFIG_SOURCE" "$CONFIG_DEST"
    log "Configuración de ejemplo instalada en $CONFIG_DEST"
  fi
fi

log "Instalación finalizada"
