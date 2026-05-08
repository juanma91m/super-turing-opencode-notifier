# Instalación del addon notifier

## Requisitos

- `opencode` ya instalado
- una base de OpenCode ya funcional
- dependencias runtime equivalentes a las del stack base en `~/.config/opencode/node_modules/`

En la práctica, el caso soportado hoy es usar este addon encima de una instalación que ya tenga `super-turing-opencode` o una base equivalente.

## Instalación

```bash
git clone https://github.com/juanma91m/super-turing-opencode-notifier.git
cd super-turing-opencode-notifier
bash scripts/install.sh
```

Opciones útiles:

```bash
bash scripts/install.sh --dry-run
bash scripts/install.sh --target-dir "$HOME/.config/opencode"
bash scripts/install.sh --install-example-config
```

## Qué instala

- plugin en `~/.config/opencode/plugins/opencode-notify.ts`
- opcionalmente `~/.config/opencode/notify.json` a partir de `notify.example.json`

No toca:

- `opencode.json`
- `tui.json`

## Linux / GNOME / X11

Si usás GNOME Terminal y querés mejorar el click-to-focus del notifier en X11, conviene tener:

- `wmctrl`
- `xdotool`

Ejemplo en Debian/Ubuntu:

```bash
sudo apt install wmctrl xdotool
```

## Validación

```bash
bash scripts/status.sh
```

Resultado esperado mínimo:

- `plugin_installed=yes`
- `plugin_matches_repo=yes`

Si además instalaste config de ejemplo:

- `notify_config_present=yes`

## Desinstalación

```bash
bash scripts/uninstall.sh
```

Para remover también `notify.json`:

```bash
bash scripts/uninstall.sh --remove-config
```
