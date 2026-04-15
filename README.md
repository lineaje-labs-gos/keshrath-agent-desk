# Agent Desk

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org/)
[![Electron](https://img.shields.io/badge/electron-35-purple)](https://www.electronjs.org/)
[![Tests](https://img.shields.io/badge/tests-unit%20%2B%20e2e-brightgreen)]()

**Unified control center for AI coding agents.** Terminals, dashboards, and orchestration in one Electron app. Manage multiple Claude Code sessions, monitor agent status, and coordinate multi-agent workflows from a single window.

For a complete guide, see the **[User Manual](docs/USER-MANUAL.md)**.

![Agent Desk](docs/public/screenshots/overview.png)

## Why

Running multiple AI agents means juggling terminals, losing track of which agent is doing what, and manually switching between dashboards. Agent Desk puts everything in one place:

|                     | Without Agent Desk                    | With Agent Desk                          |
| ------------------- | ------------------------------------- | ---------------------------------------- |
| **Terminals**       | Separate windows, no organization     | Tabbed grid layout with splits           |
| **Agent status**    | No visibility                         | Live monitor with status, cost, tasks    |
| **Coordination**    | Manual, error-prone                   | Batch launcher, templates, comm graph    |
| **Dashboards**      | Open 3 browser tabs                   | Embedded with health monitoring          |
| **Search**          | Per-terminal only                     | Cross-terminal search across all buffers |
| **Session restore** | Lost on close                         | Auto-save + restore with buffer replay   |

## Features

### Terminal Management

- **Multi-terminal** with tabs, split views (horizontal/vertical), drag-and-drop reordering
- **Dockview grid layout** -- resize, maximize, and rearrange terminal panes freely
- **Pop-out windows** -- detach any terminal into its own native window
- **Shell profiles** -- Default Shell and Claude Code built-in; create custom profiles with command, args, env, cwd, and icon
- **Shell integration** -- OSC sequence parsing for current directory tracking and command boundary detection
- **Inline rename** -- double-click tab labels to rename terminals

### Agent Intelligence

- **Agent Detection** -- auto-detects Claude Code sessions by parsing tool calls, file modifications, test results, and errors from terminal output
- **Live tab indicators** -- tab titles show agent name, current activity, and attention state (waiting on user, running, idle, errored)
- **Lifecycle Controls** -- interrupt (SIGINT), stop (SIGTERM), kill (SIGKILL), and restart agents from the context menu or tab buttons
- **Cost Tracking** -- per-agent token/cost estimation in the status bar with $2/$5 warning thresholds
- **Terminal Chains** -- trigger commands in one terminal when another exits or changes status

### Multi-Agent Orchestration

- **Batch Launcher** (Ctrl+Shift+B) -- launch N agents at once with profile selection, naming patterns (`agent-{n}`), stagger delays, working directory, and initial commands
- **Templates / Recipes** -- save and load reusable multi-agent configurations; 2 built-in defaults (Quick Review: 3 agents, Parallel Tasks: 5 agents)
- **Communication Graph** -- canvas visualization of agent interactions fetched from the agent-comm API, with animated nodes and edge thickness by message count

### Search

- **Terminal Search** (Ctrl+F) -- search within the active terminal buffer using xterm.js search addon
- **Cross-Terminal Search** (Ctrl+Shift+F) -- async chunked search across all terminal buffers with case-sensitive and regex options, keyboard navigation, and jump-to-line

### Dashboard Integration

- **Agent Comm** (Ctrl+2) -- embedded agent-comm dashboard, mounted as a first-party plugin into a shadow DOM
- **Agent Tasks** (Ctrl+3) -- embedded agent-tasks pipeline kanban
- **Agent Knowledge** (Ctrl+4) -- embedded agent-knowledge dashboard with search and graph
- **Agent Discover** (Ctrl+5) -- embedded agent-discover MCP registry / marketplace
- **Event Stream** (Ctrl+6), **Settings** (Ctrl+7) -- native views
- **Plugin system** -- each `agent-*` package ships an `agent-desk-plugin.json` manifest. Agent Desk discovers them at startup and mounts them via a `plugin://` protocol with theme + CSS variable sync into a per-view shadow root
- **Dashboard Health** -- 30-second health checks with auto-reconnect; sidebar status dots show service availability

### Event System

- **Event Stream** (Ctrl+E) -- filterable timeline panel showing up to 200 events with expandable details, severity color coding, and JSON export
- **Event Bus** -- internal pub/sub system emitting terminal lifecycle, agent tool calls, file modifications, test results, errors, and chain triggers

### Project-Centric Workspaces

- **Workspaces** (Ctrl+Shift+W / Ctrl+Alt+W) -- bundle a root folder, per-workspace env vars, color, agent selection, and pin state; opening spawns terminals for every configured agent
- **Workspace switcher** -- titlebar dropdown with pinned + recent workspaces; one-click open
- **24-color palette** -- visual identity for tabs, sidebar accents, and switcher rows
- **Session Persistence** -- auto-save every 60 seconds; restore prompt on startup with 10-second countdown; buffer replay for terminal history
- **Layout auto-save** -- dockview grid state persisted automatically
- **Migration** -- pre-1.6 layout-only workspaces lift automatically to the new v2 shape on first read

### Git Integration

- **Read-only git sidebar** -- branch, ahead/behind, per-file status (M/A/D/?/R/U), last commit; powered by simple-git with fs.watch on `.git/HEAD` + `.git/index`
- **Diff viewer** -- Shiki-highlighted dockview overlay with unified and side-by-side modes, j/k hunk navigation, Esc to close, o to open in external editor
- **External editor handoff** -- detects VS Code, Cursor, Windsurf, VSCodium on PATH; opens files via `vscode://file/<path>:<line>:<col>` URL scheme with `--goto` CLI fallback; context menu items on terminal tabs, agent cards, git file rows, and inside the diff viewer

### Warp-inspired primitives (v1.7)

- **Blocks** (Ctrl+B) -- terminal output partitioned by OSC 133 into structured command blocks; collapsible cards with exit-code chip, elapsed time, and one-click rerun
- **Diff-first edit review** (Ctrl+Shift+R) -- Claude Code tool-call edits captured against git HEAD and presented in a review panel with approve / reject (reverts to HEAD) / comment
- **Unified input bar** (Ctrl+L) -- titlebar input with intent auto-detect: `$ <cmd>` pipes to focused terminal, `/<name>` opens command palette, plain text routes to focused Claude Code agent or configured provider (anthropic / openai / ollama / custom)
- **Skills &amp; Rules panel** (Ctrl+8) -- browse and edit `.claude/skills`, `.claude/hooks`, `.mcp.json`, `CLAUDE.md` for the active workspace with path-contained saves
- **Tab modality states** -- colored dot per tab tracking `idle` / `running` / `awaiting-input` / `edits-pending` / `errored`; click to act (open review, focus terminal)

### Appearance

- **4 built-in themes** -- Default Dark, Default Light, Dracula, Nord; custom themes via the theme manager
- **Custom themes** -- full color customization including terminal ANSI colors, stored in localStorage
- **MD3 design language** -- consistent with agent-comm and agent-tasks dashboards
- **System tray** -- minimize to tray with context menu for quick terminal launch

### Configuration

- **40+ settings** -- terminal font/size/cursor/scrollback, dashboard URLs, sidebar position, close-to-tray, start-on-login, bell behavior, notifications
- **Config file** -- `~/.agent-desk/config.json` persists settings, profiles, workspaces, and templates
- **Keybinding customization** -- `~/.agent-desk/keybindings.json` for user overrides
- **Config hot-reload** -- file watcher triggers live updates on external config changes

## Quick Start

### Install from npm

```bash
npm install -g agent-desk
agent-desk
```

### Or build from source

```bash
git clone https://github.com/keshrath/agent-desk.git
cd agent-desk
npm install
npm run build
npm run dev
```

### Or download a binary

Pre-built binaries for Windows, macOS, and Linux are available on the [GitHub Releases](https://github.com/keshrath/agent-desk/releases) page:

| Platform | Format             |
| -------- | ------------------ |
| Windows  | NSIS installer, Portable |
| macOS    | DMG                |
| Linux    | AppImage, deb      |

## Keyboard Shortcuts

### Terminals

| Shortcut        | Action                |
| --------------- | --------------------- |
| Ctrl+Shift+T    | New terminal          |
| Ctrl+Shift+C    | New Claude session    |
| Ctrl+W          | Close terminal        |
| Ctrl+Tab        | Next terminal         |
| Ctrl+Shift+Tab  | Previous terminal     |
| Ctrl+Shift+D    | Split right           |
| Ctrl+\\         | Split right (alt)     |
| Ctrl+Shift+E    | Split down            |
| Ctrl+Shift+M    | Toggle maximize       |
| Ctrl+Shift+S    | Save output to file   |
| Ctrl+F          | Search in terminal    |
| Ctrl+Shift+F    | Search all terminals  |

### Navigation

| Shortcut   | Action                |
| ---------- | --------------------- |
| Alt+Arrow  | Focus adjacent pane   |
| Ctrl+1     | Terminals view        |
| Ctrl+2     | Agent Comm view       |
| Ctrl+3     | Agent Tasks view      |
| Ctrl+4     | Agent Knowledge view  |
| Ctrl+5     | Agent Discover view   |
| Ctrl+6     | Event Stream view     |
| Ctrl+7     | Settings view         |
| Ctrl+8     | Skills &amp; Rules view   |
| Ctrl+B     | Blocks panel          |
| Ctrl+Shift+R | Pending edits review |
| Ctrl+L     | Focus unified input   |

### General

| Shortcut        | Action                  |
| --------------- | ----------------------- |
| Ctrl+Shift+P    | Command palette         |
| Ctrl+P          | Quick switcher          |
| F1              | Show keyboard shortcuts |
| Ctrl+E          | Toggle event stream     |
| Ctrl+Shift+B    | Batch agent launcher    |
| Ctrl+Shift+W    | Save workspace          |
| Ctrl+Alt+W      | Load workspace          |
| Escape          | Close overlays / search |

All shortcuts are customizable via Settings or `~/.agent-desk/keybindings.json`.

## Configuration

Config is stored at `~/.agent-desk/config.json` and organized into sections:

| Section      | Key Settings                                                         |
| ------------ | -------------------------------------------------------------------- |
| Terminal     | `fontSize`, `fontFamily`, `cursorStyle`, `cursorBlink`, `scrollback` |
| Shell        | `defaultShell`, `defaultTerminalCwd`, `defaultNewTerminalCommand`    |
| Dashboard    | `agentCommUrl`, `agentTasksUrl`, `agentKnowledgeUrl`                 |
| Appearance   | `sidebarPosition`, `showStatusBar`, `tabCloseButton`, `theme`        |
| Behavior     | `closeToTray`, `startOnLogin`, `newTerminalOnStartup`                |
| Notifications| `bellSound`, `bellVisual`, `desktopNotifications`                    |

## Documentation

- [Setup Guide](docs/SETUP.md) -- installation, configuration, shell integration
- [Architecture](docs/ARCHITECTURE.md) -- process model, IPC, file structure
- [Features](docs/FEATURES.md) -- detailed feature documentation
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)

## License

MIT -- see [LICENSE](LICENSE)
