# OpenCode Notifier Add-on

Portable OpenCode addon for native OS notifications, extending `super-turing-opencode` with idle, question, and permission alerts.

Addon separado para notificaciones nativas del SO en OpenCode.

## Qué hace

Instala un plugin que notifica cuando OpenCode:

- terminó una tarea y ya acepta un nuevo prompt,
- hizo una pregunta y espera respuesta humana,
- o está esperando un permiso para continuar.

## Alcance de esta extracción

Este repo separa el notifier del stack base `super-turing-opencode` sin cambiar todavía su contrato runtime principal:

- instala el plugin en `~/.config/opencode/plugins/opencode-notify.ts`,
- mantiene la configuración opcional en `~/.config/opencode/notify.json`,
- no toca `opencode.json`,
- no toca `tui.json`.

## Dependencia runtime actual

Por ahora este addon **asume** que la instalación destino ya tiene disponibles las dependencias JS esperadas por los plugins de OpenCode, típicamente en:

- `~/.config/opencode/node_modules/@opencode-ai/plugin`
- `~/.config/opencode/node_modules/@opencode-ai/sdk`

Eso hoy queda cubierto naturalmente si ya usás `super-turing-opencode` como stack base.

## Instalación

Guía más detallada: [`INSTALLATION.md`](./INSTALLATION.md)

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

## Status

```bash
bash scripts/status.sh
```

Reporta si:

- el plugin está instalado,
- el archivo instalado coincide con el source del repo,
- existe `notify.json`,
- están presentes las dependencias runtime esperadas.

## Uninstall

```bash
bash scripts/uninstall.sh
```

Por defecto:

- elimina solo `plugins/opencode-notify.ts`,
- deja `notify.json` intacto.

Opcionalmente:

```bash
bash scripts/uninstall.sh --remove-config
```

## Configuración local

El plugin lee `~/.config/opencode/notify.json`.

Ejemplo base:

```jsonc
{
  "quietHours": {
    "enabled": true,
    "start": "22:00",
    "end": "08:00"
  },
  "sounds": {
    "idle": "Glass",
    "question": "Submarine",
    "permission": "Submarine"
  }
}
```

También podés copiar `notify.example.json`.

## Plataformas y comportamiento

- macOS: usa `osascript`
- Linux: usa `notify-send`
- Linux/GNOME Terminal: intenta click-to-focus best-effort
- Linux/X11: puede aprovechar `wmctrl` o `xdotool` si están instalados
- Windows: usa PowerShell / MessageBox en modo best-effort

## Helpers Linux opcionales

Si usás GNOME/X11, instalar `wmctrl` y `xdotool` mejora el fallback de focus de ventana:

```bash
sudo apt install wmctrl xdotool
```

## Limitaciones conocidas

- esta primera extracción separa ownership y lifecycle, no independencia total de dependencias JS,
- no valida todavía layouts alternativos de autoload; por eso mantiene el path runtime ya probado,
- no migra ni limpia automáticamente configuraciones históricas salvo que lo pidas explícitamente con `--remove-config`.
