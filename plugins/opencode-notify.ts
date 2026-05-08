import type { Plugin } from "@opencode-ai/plugin"
import type { Event } from "@opencode-ai/sdk"
import { spawn as spawnProcess } from "node:child_process"
import { homedir, platform } from "node:os"
import { join } from "node:path"
import { readFile } from "node:fs/promises"
import { createInterface } from "node:readline"

type NotifyEventKind = "idle" | "question" | "permission"
type NotifyLogger = (message: string, data?: Record<string, unknown>) => Promise<unknown> | void

const MAX_PARENT_CHAIN_DEPTH = 12

interface NotifyConfig {
  quietHours: {
    enabled: boolean
    start: string
    end: string
  }
  sounds: {
    idle?: string
    question?: string
    permission?: string
  }
}

const DEFAULT_CONFIG: NotifyConfig = {
  quietHours: {
    enabled: false,
    start: "22:00",
    end: "08:00",
  },
  sounds: {
    idle: "Glass",
    question: "Submarine",
    permission: "Submarine",
  },
}

const CONFIG_PATH = join(homedir(), ".config", "opencode", "notify.json")
const DEDUPE_WINDOW_MS = 1500
const LINUX_CLICK_ACTION_NAME = "default"
const LINUX_CLICK_ACTION_LABEL = "Traer GNOME Terminal al frente"
const LINUX_CLICK_TO_FOCUS_TIMEOUT_MS = 45000
const LINUX_ACTIVATION_TOKEN_WAIT_MS = 1000
const GNOME_TERMINAL_DBUS_DEST = "org.gnome.Terminal"
const GNOME_TERMINAL_DBUS_PATH = "/org/gnome/Terminal"
const GNOME_TERMINAL_X11_WMCTRL_TARGETS = [
  "org.gnome.Terminal.Gnome-terminal",
  "gnome-terminal-server.Gnome-terminal",
  "Gnome-terminal",
  "org.gnome.Terminal",
]
const GNOME_TERMINAL_X11_XDOTOOL_SEARCHES = [
  ["--classname", "Gnome-terminal"],
  ["--class", "org.gnome.Terminal"],
  ["--class", "gnome-terminal-server"],
] as const

let linuxClickToFocusSupported: boolean | null = null

function stripJsonComments(text: string): string {
  return text
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
}

async function loadConfig(): Promise<NotifyConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8")
    const parsed = JSON.parse(stripJsonComments(raw)) as Partial<NotifyConfig>
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      quietHours: {
        ...DEFAULT_CONFIG.quietHours,
        ...(parsed.quietHours ?? {}),
      },
      sounds: {
        ...DEFAULT_CONFIG.sounds,
        ...(parsed.sounds ?? {}),
      },
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

function toMinutes(value: string): number | null {
  const match = value.match(/^(\d{2}):(\d{2})$/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null
  return hours * 60 + minutes
}

function isQuietHours(config: NotifyConfig): boolean {
  if (!config.quietHours.enabled) return false
  const start = toMinutes(config.quietHours.start)
  const end = toMinutes(config.quietHours.end)
  if (start === null || end === null) return false

  const now = new Date()
  const current = now.getHours() * 60 + now.getMinutes()
  if (start > end) return current >= start || current < end
  return current >= start && current < end
}

async function runOsascript(script: string): Promise<string | null> {
  if (platform() !== "darwin") return null
  try {
    const proc = Bun.spawn(["osascript", "-e", script], { stdout: "pipe", stderr: "pipe" })
    return (await new Response(proc.stdout).text()).trim() || null
  } catch {
    return null
  }
}

function detectTerminalProcess(): string | null {
  const termProgram = (process.env.TERM_PROGRAM ?? "").toLowerCase()
  if (termProgram.includes("vscode")) return "Code"
  if (termProgram.includes("apple_terminal")) return "Terminal"
  if (termProgram.includes("iterm")) return "iTerm2"
  if (termProgram.includes("wezterm")) return "WezTerm"
  if (termProgram.includes("ghostty")) return "Ghostty"
  if (termProgram.includes("warp")) return "Warp"
  if (process.env.KITTY_WINDOW_ID) return "kitty"
  if (process.env.GHOSTTY_RESOURCES_DIR) return "Ghostty"
  if (process.env.TMUX) return "tmux"
  return null
}

function isGnomeTerminalSession(): boolean {
  const termProgram = (process.env.TERM_PROGRAM ?? "").toLowerCase()
  if (termProgram.includes("gnome-terminal")) return true
  return !!process.env.GNOME_TERMINAL_SERVICE || !!process.env.GNOME_TERMINAL_SCREEN
}

async function isTerminalFocused(kind: NotifyEventKind): Promise<boolean> {
  if (kind === "question" || kind === "permission") return false
  const terminalProcess = detectTerminalProcess()
  if (!terminalProcess || platform() !== "darwin") return false
  const frontmost = await runOsascript(
    'tell application "System Events" to get name of first application process whose frontmost is true',
  )
  return !!frontmost && frontmost.toLowerCase() === terminalProcess.toLowerCase()
}

function getLinuxUrgency(kind: NotifyEventKind): "normal" | "critical" {
  if (kind === "question" || kind === "permission") return "critical"
  return "normal"
}

function buildLinuxNotifyArgs(
  kind: NotifyEventKind,
  title: string,
  message: string,
  sound?: string,
  action?: string,
): string[] {
  const args = ["-a", "OpenCode", "-u", getLinuxUrgency(kind)]
  if (sound) args.push("-h", `string:sound-name:${sound}`)
  if (action) args.push("-A", action)
  args.push(title, message)
  return args
}

async function canUseLinuxClickToFocus(): Promise<boolean> {
  if (platform() !== "linux") return false
  if (!isGnomeTerminalSession()) return false
  if (!Bun.which("notify-send") || !Bun.which("gdbus") || !Bun.which("dbus-monitor")) return false
  if (linuxClickToFocusSupported !== null) return linuxClickToFocusSupported

  try {
    const proc = Bun.spawn(
      [
        "gdbus",
        "call",
        "--session",
        "--dest",
        "org.freedesktop.Notifications",
        "--object-path",
        "/org/freedesktop/Notifications",
        "--method",
        "org.freedesktop.Notifications.GetCapabilities",
      ],
      { stdout: "pipe", stderr: "ignore", stdin: "ignore" },
    )
    const output = await new Response(proc.stdout).text()
    linuxClickToFocusSupported = /(^|[^a-z])actions([^a-z]|$)/i.test(output)
  } catch {
    linuxClickToFocusSupported = false
  }

  return linuxClickToFocusSupported
}

function escapeGVariantString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runCommandAndGetExitCode(command: string, args: string[]): Promise<number | null> {
  try {
    const proc = Bun.spawn([command, ...args], { stdout: "ignore", stderr: "ignore", stdin: "ignore" })
    return await proc.exited
  } catch {
    return null
  }
}

function canUseLinuxX11FocusFallback(): boolean {
  return platform() === "linux" && (process.env.XDG_SESSION_TYPE ?? "").toLowerCase() === "x11"
}

function getSessionTitleFromNotificationTitle(title: string): string | null {
  const prefix = "OpenCode: "
  if (!title.startsWith(prefix)) return null
  const sessionTitle = title.slice(prefix.length).trim()
  return sessionTitle || null
}

async function focusGnomeTerminalTabBySessionTitle(sessionTitle: string, log?: NotifyLogger): Promise<boolean> {
  if (platform() !== "linux") return false
  if (!sessionTitle.trim()) return false
  if (!Bun.which("python3")) return false

  const script = String.raw`
import sys
import gi

gi.require_version('Atspi', '2.0')
from gi.repository import Atspi

session_title = sys.argv[1].strip()
if not session_title:
    raise SystemExit(1)

candidates = [
    f"OC | {session_title}",
    session_title,
    f"OpenCode: {session_title}",
]

def try_select(tab_list, matcher):
    selection = tab_list.get_selection_iface()
    if selection is None:
        return None
    for index in range(tab_list.get_child_count()):
        tab = tab_list.get_child_at_index(index)
        name = (tab.get_name() or '').strip()
        if matcher(name):
            if selection.select_child(index):
                print(name)
                return True
    return None

def walk(node):
    try:
        role = node.get_role_name()
    except Exception:
        return False

    if role == 'page tab list':
        for candidate in candidates:
            result = try_select(node, lambda name, candidate=candidate: name == candidate)
            if result:
                return True
        result = try_select(node, lambda name: session_title in name)
        if result:
            return True

    try:
        child_count = node.get_child_count()
    except Exception:
        child_count = 0

    for index in range(child_count):
        if walk(node.get_child_at_index(index)):
            return True
    return False

Atspi.init()
desktop = Atspi.get_desktop(0)
for app_index in range(desktop.get_child_count()):
    app = desktop.get_child_at_index(app_index)
    if app.get_name() != 'org.gnome.Terminal':
        continue
    if walk(app):
        raise SystemExit(0)

raise SystemExit(1)
`

  try {
    const proc = Bun.spawn(["python3", "-c", script, sessionTitle], {
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
    })
    const selectedTabName = (await new Response(proc.stdout).text()).trim()
    const exitCode = await proc.exited
    if (exitCode === 0) {
      void log?.("linux exact tab focus succeeded", { sessionTitle, selectedTabName })
      return true
    }
  } catch {
    // best effort
  }

  void log?.("linux exact tab focus failed", { sessionTitle })
  return false
}

async function focusGnomeTerminalWithWmctrl(log?: NotifyLogger): Promise<boolean> {
  if (!Bun.which("wmctrl")) return false
  for (const target of GNOME_TERMINAL_X11_WMCTRL_TARGETS) {
    const exitCode = await runCommandAndGetExitCode("wmctrl", ["-x", "-a", target])
    if (exitCode === 0) {
      void log?.("linux x11 focus fallback succeeded", { helper: "wmctrl", target })
      return true
    }
  }
  void log?.("linux x11 focus fallback failed", { helper: "wmctrl" })
  return false
}

async function focusGnomeTerminalWithXdotool(log?: NotifyLogger): Promise<boolean> {
  if (!Bun.which("xdotool")) return false
  for (const searchArgs of GNOME_TERMINAL_X11_XDOTOOL_SEARCHES) {
    const exitCode = await runCommandAndGetExitCode("xdotool", [
      "search",
      "--onlyvisible",
      ...searchArgs,
      "windowactivate",
      "--sync",
    ])
    if (exitCode === 0) {
      void log?.("linux x11 focus fallback succeeded", { helper: "xdotool", searchArgs })
      return true
    }
  }
  void log?.("linux x11 focus fallback failed", { helper: "xdotool" })
  return false
}

async function focusGnomeTerminalX11(log?: NotifyLogger): Promise<boolean> {
  if (!canUseLinuxX11FocusFallback()) return false
  if (await focusGnomeTerminalWithWmctrl(log)) return true
  if (await focusGnomeTerminalWithXdotool(log)) return true
  void log?.("linux x11 focus fallback unavailable", {
    hasWmctrl: !!Bun.which("wmctrl"),
    hasXdotool: !!Bun.which("xdotool"),
  })
  return false
}

async function activateGnomeTerminal(activationToken?: string | null): Promise<void> {
  if (platform() !== "linux") return
  try {
    const platformData = activationToken
      ? `{"activation-token": <"${escapeGVariantString(activationToken)}">, "desktop-startup-id": <"${escapeGVariantString(activationToken)}">}`
      : "{}"
    const proc = Bun.spawn(
      [
        "gdbus",
        "call",
        "--session",
        "--dest",
        GNOME_TERMINAL_DBUS_DEST,
        "--object-path",
        GNOME_TERMINAL_DBUS_PATH,
        "--method",
        "org.freedesktop.Application.Activate",
        "--",
        platformData,
      ],
      { stdout: "ignore", stderr: "ignore", stdin: "ignore" },
    )
    await proc.exited
  } catch {
    // best effort
  }
}

function sendLinuxClickToFocusNotification(
  kind: NotifyEventKind,
  title: string,
  message: string,
  sound: string | undefined,
  log?: NotifyLogger,
): void {
  // `notify-send -A` implica wait; por eso lo dejamos corriendo en un proceso aparte y con timeout acotado.
  const sessionTitle = getSessionTitleFromNotificationTitle(title)
  let notificationID: string | null = null
  let activationToken: string | null = null
  const actionByNotificationID = new Map<string, string>()
  const activationTokenByNotificationID = new Map<string, string>()
  let pendingSignal: { type: "action" | "token"; id?: string } | null = null
  let pendingActivation = false
  let dbusMonitorClosed = false
  const dbusMonitor = spawnProcess("dbus-monitor", ["interface=org.freedesktop.Notifications"], {
    stdio: ["ignore", "pipe", "ignore"],
  })

  const proc = spawnProcess(
    "notify-send",
    [
      "-p",
      ...buildLinuxNotifyArgs(kind, title, message, sound, `${LINUX_CLICK_ACTION_NAME}=${LINUX_CLICK_ACTION_LABEL}`),
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  )

  void log?.("linux click-to-focus notification spawned", { kind, title })

  const stopDbusMonitor = () => {
    if (dbusMonitorClosed) return
    dbusMonitorClosed = true
    try {
      dbusMonitor.kill()
    } catch {
      // best effort
    }
  }

  const requestActivation = async (source: string) => {
    if (pendingActivation) return
    pendingActivation = true

    if (!activationToken && canUseLinuxX11FocusFallback()) {
      const focused = await focusGnomeTerminalX11(log)
      if (focused) {
        if (sessionTitle) {
          await focusGnomeTerminalTabBySessionTitle(sessionTitle, log)
        }
        void log?.("linux click-to-focus activation satisfied by x11 fallback", {
          source,
          notificationID,
        })
        stopDbusMonitor()
        return
      }
    }

    if (!activationToken) await delay(LINUX_ACTIVATION_TOKEN_WAIT_MS)
    void log?.("linux click-to-focus activating terminal", {
      source,
      notificationID,
      hasActivationToken: !!activationToken,
    })
    await activateGnomeTerminal(activationToken)
    if (!activationToken && canUseLinuxX11FocusFallback()) {
      await focusGnomeTerminalX11(log)
    }
    if (sessionTitle) {
      await focusGnomeTerminalTabBySessionTitle(sessionTitle, log)
    }
    stopDbusMonitor()
  }

  const timeout = setTimeout(() => {
    try {
      proc.kill()
    } catch {
      // best effort
    }
    stopDbusMonitor()
  }, LINUX_CLICK_TO_FOCUS_TIMEOUT_MS)

  dbusMonitor.once("close", () => {
    dbusMonitorClosed = true
  })
  proc.once("close", () => {
    clearTimeout(timeout)
    setTimeout(stopDbusMonitor, LINUX_ACTIVATION_TOKEN_WAIT_MS + 100)
  })

  if (dbusMonitor.stdout) {
    const monitorLines = createInterface({ input: dbusMonitor.stdout })
    monitorLines.on("line", (line) => {
      if (line.includes("member=ActionInvoked")) {
        pendingSignal = { type: "action" }
        return
      }

      if (line.includes("member=ActivationToken")) {
        pendingSignal = { type: "token" }
        return
      }

      if (!pendingSignal) return

      const idMatch = line.match(/^\s*uint32\s+(\d+)\s*$/)
      if (idMatch && !pendingSignal.id) {
        pendingSignal.id = idMatch[1]
        return
      }

      if (!pendingSignal.id) return
      const stringMatch = line.match(/^\s*string\s+"(.*)"\s*$/)
      if (!stringMatch) return

      const value = stringMatch[1]
      if (pendingSignal.type === "action") {
        actionByNotificationID.set(pendingSignal.id, value)
        if (pendingSignal.id === notificationID) {
          void log?.("linux click-to-focus D-Bus action received", {
            notificationID,
            action: value,
          })
          if (value === LINUX_CLICK_ACTION_NAME) void requestActivation("dbus-action")
        }
      }

      if (pendingSignal.type === "token") {
        activationTokenByNotificationID.set(pendingSignal.id, value)
        if (pendingSignal.id === notificationID) {
          activationToken = value
          void log?.("linux click-to-focus activation token received", {
            notificationID,
            tokenLength: value.length,
          })
        }
      }

      pendingSignal = null
    })
  }

  if (!proc.stdout) return
  const stdoutLines = createInterface({ input: proc.stdout })
  stdoutLines.on("line", (line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    if (!notificationID && /^\d+$/.test(trimmed)) {
      notificationID = trimmed
      activationToken = activationTokenByNotificationID.get(trimmed) ?? null
      void log?.("linux click-to-focus notification id received", {
        notificationID,
        hasBufferedActivationToken: !!activationToken,
      })
      const bufferedAction = actionByNotificationID.get(trimmed)
      if (bufferedAction === LINUX_CLICK_ACTION_NAME) void requestActivation("dbus-action-buffered")
      return
    }
    if (trimmed === LINUX_CLICK_ACTION_NAME) {
      void log?.("linux click-to-focus notify-send action received", {
        notificationID,
        action: trimmed,
      })
      void requestActivation("notify-send-stdout")
    }
  })
}

async function sendNotification(
  kind: NotifyEventKind,
  title: string,
  message: string,
  sound?: string,
  log?: NotifyLogger,
): Promise<void> {
  if (platform() === "darwin") {
    const escapedTitle = title.replace(/"/g, '\\"')
    const escapedMessage = message.replace(/"/g, '\\"')
    const soundPart = sound ? ` sound name \"${sound.replace(/"/g, '\\"')}\"` : ""
    await runOsascript(`display notification \"${escapedMessage}\" with title \"${escapedTitle}\"${soundPart}`)
    return
  }

  if (platform() === "linux") {
    try {
      if (await canUseLinuxClickToFocus()) {
        sendLinuxClickToFocusNotification(kind, title, message, sound, log)
        return
      }
      Bun.spawnSync(["notify-send", ...buildLinuxNotifyArgs(kind, title, message, sound)], {
        stdout: "ignore",
        stderr: "ignore",
      })
    } catch {
      // best effort
    }
    return
  }

  if (platform() === "win32") {
    try {
      const escapedTitle = title.replace(/'/g, "''")
      const escapedMessage = message.replace(/'/g, "''")
      const script = `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${escapedMessage}','${escapedTitle}') | Out-Null`
      Bun.spawn(["powershell", "-NoProfile", "-Command", script], { stdout: "ignore", stderr: "ignore" })
    } catch {
      // best effort
    }
  }
}

async function isParentSession(client: Parameters<Plugin>[0]["client"], sessionID: string): Promise<boolean> {
  try {
    const session = await client.session.get({ path: { id: sessionID } })
    return !session.data?.parentID
  } catch {
    return true
  }
}

function shouldSendDeduped(map: Map<string, number>, key: string): boolean {
  const now = Date.now()
  for (const [existingKey, timestamp] of map) {
    if (now - timestamp >= DEDUPE_WINDOW_MS) map.delete(existingKey)
  }
  const previous = map.get(key)
  if (previous && now - previous < DEDUPE_WINDOW_MS) return false
  map.set(key, now)
  return true
}

function getSessionID(properties: Record<string, unknown> | undefined): string | null {
  const direct = properties?.sessionID
  if (typeof direct === "string" && direct.trim()) return direct.trim()
  const info = properties?.info as Record<string, unknown> | undefined
  const nested = info?.sessionID
  if (typeof nested === "string" && nested.trim()) return nested.trim()
  return null
}

async function getRootSessionID(client: Parameters<Plugin>[0]["client"], sessionID: string): Promise<string> {
  let currentID = sessionID
  for (let depth = 0; depth < MAX_PARENT_CHAIN_DEPTH; depth += 1) {
    try {
      const session = await client.session.get({ path: { id: currentID } })
      const parentID = session.data?.parentID
      if (!parentID) return currentID
      currentID = parentID
    } catch {
      return currentID
    }
  }
  return currentID
}

async function getSessionTitle(client: Parameters<Plugin>[0]["client"], sessionID: string): Promise<string> {
  try {
    const session = await client.session.get({ path: { id: sessionID } })
    const title = session.data?.title?.trim()
    if (title) return title
  } catch {
    // ignore
  }
  return sessionID.slice(0, 8)
}

async function getLatestAssistantMessage(
  client: Parameters<Plugin>[0]["client"],
  sessionID: string,
): Promise<{ id: string; text: string } | null> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const messages = response.data ?? []
    const lastAssistant = [...messages].reverse().find((message) => message.info.role === "assistant")
    if (!lastAssistant?.parts) return null
    const text = lastAssistant.parts
      .filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof (part as { text?: string }).text === "string")
      .map((part) => part.text)
      .join("\n")
      .trim()
    if (!text) return null
    return { id: lastAssistant.info.id, text }
  } catch {
    return null
  }
}

function looksLikeQuestion(text: string): boolean {
  const normalized = text.trim()
  if (!normalized) return false
  return normalized.endsWith("?") || normalized.endsWith("¿")
}

const NotifyPlugin: Plugin = async ({ client }) => {
  const log = (message: string, data?: Record<string, unknown>) =>
    client.app.log({
      body: {
        service: "opencode-notify",
        level: "info",
        message: data ? `${message} ${JSON.stringify(data)}` : message,
      },
    }).catch(() => {})

  const readyNotifications = new Map<string, number>()
  const questionNotifications = new Map<string, number>()
  const permissionNotifications = new Map<string, number>()
  const sessionTitleCache = new Map<string, string>()
  const lastNotifiedAssistantMessageByRootSession = new Map<string, string>()

  async function maybeNotify(kind: NotifyEventKind, sessionID: string, title: string, message: string, dedupe: Map<string, number>, key: string) {
    const config = await loadConfig()
    if (isQuietHours(config)) {
      await log("skip quiet hours", { kind, sessionID })
      return
    }
    if (!(await isParentSession(client, sessionID))) {
      await log("skip child session", { kind, sessionID })
      return
    }
    if (!shouldSendDeduped(dedupe, key)) {
      await log("skip deduped", { kind, sessionID, key })
      return
    }
    if (await isTerminalFocused(kind)) {
      await log("skip focused terminal", { kind, sessionID })
      return
    }
    await log("sending notification", { kind, sessionID, title, message })
    await sendNotification(kind, title, message, config.sounds[kind], log)
  }

  async function maybeNotifyLatestAssistant(rootSessionID: string): Promise<void> {
    const latestAssistantMessage = await getLatestAssistantMessage(client, rootSessionID)
    if (!latestAssistantMessage) {
      await log("skip notify without latest assistant message", { rootSessionID })
      return
    }

    if (lastNotifiedAssistantMessageByRootSession.get(rootSessionID) === latestAssistantMessage.id) {
      await log("skip duplicate assistant notification", { rootSessionID, messageID: latestAssistantMessage.id })
      return
    }

    lastNotifiedAssistantMessageByRootSession.set(rootSessionID, latestAssistantMessage.id)
    const sessionTitle = sessionTitleCache.get(rootSessionID) ?? (await getSessionTitle(client, rootSessionID))
    sessionTitleCache.set(rootSessionID, sessionTitle)

    if (looksLikeQuestion(latestAssistantMessage.text)) {
      await maybeNotify(
        "question",
        rootSessionID,
        `OpenCode: ${sessionTitle}`,
        "El agente hizo una pregunta y está esperando tu respuesta.",
        questionNotifications,
        `question:${rootSessionID}:${latestAssistantMessage.id}`,
      )
      return
    }

    await maybeNotify(
      "idle",
      rootSessionID,
      `OpenCode: ${sessionTitle}`,
      "La tarea finalizó y ya podés enviar un nuevo prompt.",
      readyNotifications,
      `idle:${rootSessionID}:${latestAssistantMessage.id}`,
    )
  }

  return {
    event: async ({ event }: { event: Event }) => {
      const runtimeEvent = event as { type: string; properties?: Record<string, unknown> }
      const sessionID = getSessionID(runtimeEvent.properties)
      if (!sessionID) return
      const rootSessionID = await getRootSessionID(client, sessionID)

      switch (runtimeEvent.type) {
        case "message.updated": {
          const info = runtimeEvent.properties?.info as Record<string, unknown> | undefined
          await log("event message.updated", { sessionID, rootSessionID, role: info?.role as string | undefined })
          break
        }
        case "session.idle": {
          await log("event session.idle", { sessionID, rootSessionID })
          if (sessionID !== rootSessionID) break
          await maybeNotifyLatestAssistant(rootSessionID)
          break
        }
        case "permission.asked":
        case "permission.updated": {
          await log("event permission", { type: runtimeEvent.type, sessionID, rootSessionID })
          const sessionTitle = sessionTitleCache.get(rootSessionID) ?? (await getSessionTitle(client, rootSessionID))
          sessionTitleCache.set(rootSessionID, sessionTitle)
          await maybeNotify(
            "permission",
            rootSessionID,
            `OpenCode: ${sessionTitle}`,
            "El agente está esperando tu permiso para continuar.",
            permissionNotifications,
            `permission:${rootSessionID}:${runtimeEvent.type}`,
          )
          break
        }
        case "session.deleted": {
          await log("event session.deleted", { sessionID, rootSessionID })
          await maybeNotifyLatestAssistant(rootSessionID)
          sessionTitleCache.delete(rootSessionID)
          lastNotifiedAssistantMessageByRootSession.delete(rootSessionID)
          break
        }
        default: {
          await log("event other", { type: runtimeEvent.type, sessionID, rootSessionID })
          break
        }
      }
    },
  }
}

export default NotifyPlugin
