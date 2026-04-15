# Changelog

All notable changes to Agent Desk are documented in this file.

## [1.7.1] - 2026-04-15

### Fixed

- **Titlebar drag region** — the v1.7 unified input bar's `#unified-input-slot` had `flex: 1` + `-webkit-app-region: no-drag`, which consumed the entire middle of the frameless titlebar and left only the small "Agent Desk" label as a drag handle. Moved `no-drag` from the slot onto the inner `.unified-input-wrap` so the empty padding around the input stays draggable. (`packages/ui/src/renderer/unified-input.js`)
- **Flaky `discoverRepoTree` cache test** — `tests/unit/git-store-tree.test.ts` did two back-to-back real-I/O calls and asserted the second hit the cache, but on slow Windows filesystems the first call could exceed the 2s `TREE_TTL_MS` and expire the cache. Frozen `Date.now` for the duration of the test so it asserts caching behavior, not wall-clock luck.

## [1.7.0] - 2026-04-15

Five Warp-inspired primitives land together. Every feature is additive and opt-in: existing workflows are unaffected, and each capability has its own toggle / keybind. Full build green, 464/464 unit tests passing (+24 new).

### Added

- **Blocks** — terminal output is now partitioned into structured command blocks using OSC 133 shell-integration markers (A/B/C/D) with OSC 7 cwd capture. Each block records command text, elapsed time, exit code, and output. A Ctrl+B panel docks to the right with collapsible block cards, one-click rerun, and per-terminal clear. OSC sequences split across pty chunks are correctly reassembled via a per-terminal pending buffer.
  - New `@agent-desk/core` exports: `BlockStore`, `blockStore`, `wireBlocks`
  - New channels: `blocks:list` / `get` / `search` / `rerun` / `clear` + push `blocks:new` / `blocks:update`
  - New `packages/core/src/block-store.ts` with a hand-rolled OSC 133 / OSC 7 state machine
  - New `packages/core/src/wire-blocks.ts` bridging `TerminalManager` → parser → router
  - New `packages/ui/src/renderer/blocks.js` — card stack with exit-code chip and rerun action
  - 14 new block-store unit tests (chunk-boundary splitting, ST/BEL terminators, cwd capture, search)
- **Diff-first agent review** — pending file edits from Claude Code tool calls are captured, diffed against git HEAD, and surfaced in a Ctrl+Shift+R review panel with approve / reject (reverts the file) / comment. Capture is debounced per-file and pipes through the existing `agent:file-modified` event bus from `agent-parser.js`.
  - New `@agent-desk/core` exports: `PendingEditsStore`, `pendingEditsStore`, `wireEdits`, `fileRead`
  - New channels: `edits:list` / `get` / `approve` / `reject` / `comment` / `ingest` + push `edits:update`; `file:read`
  - New `packages/core/src/pending-edits-store.ts` + `wire-edits.ts`
  - New `packages/ui/src/renderer/edit-review.js` — list + diff + approve/reject/comment
  - 6 new pending-edits unit tests
- **Unified input bar** — titlebar input with intent auto-detect: `$ <cmd>` pipes to the focused terminal, `/<name>` forwards to the command palette, plain text routes to the focused Claude Code tab's stdin (or to the first configured provider if no agent is focused). Per-browser history (50 entries), Ctrl+L to focus, Up/Down to cycle, Esc clears.
  - New `@agent-desk/core` exports: `listProviders`, `getProvider`, `saveProvider`, `deleteProvider`, `providerComplete`, `PROVIDER_KINDS`
  - Real HTTP drivers for Anthropic (`/v1/messages`), OpenAI (`/v1/chat/completions`), Ollama (`/api/generate`), and a generic custom POST. 60-second `AbortController` timeout. API keys are resolved from env-var references (`env:VAR` or `$AGENT_DESK_PROVIDER_<ID>`) — literal keys never touch disk or the channel.
  - New channels: `providers:list` / `get` / `save` / `delete` / `complete`
  - New `packages/ui/src/renderer/unified-input.js` — intent router with inline response panel
- **Skills & Rules panel** — Ctrl+8 opens a new view that lists every `.claude/skills`, `.claude/hooks`, `.mcp.json`, and `CLAUDE.md` under the active workspace's rootPath. Edit in a built-in textarea with Ctrl+S save (path-contained — writes outside the workspace root are refused at the store boundary) or hand off to the detected external editor via the existing `editor.open` channel.
  - New `@agent-desk/core` exports: `listWorkspaceConfigFiles`, `readWorkspaceConfig`, `writeWorkspaceConfig`
  - New channels: `workspace:configFiles` / `configRead` / `configWrite`
  - New `packages/core/src/workspace-config-store.ts` with path-containment guards
  - New `packages/ui/src/renderer/workspace-config.js`
- **Tab modality states** — each terminal tab now carries one of `idle` / `running` / `awaiting-input` / `edits-pending` / `errored`, shown as a colored dot before the tab label. States are authored server-side from terminal lifecycle + pending-edits signals; `awaiting-input` is overlaid client-side from agent-parser. Clicking the dot while `edits-pending` opens the review panel; clicking while `awaiting-input` focuses the terminal.
  - New `@agent-desk/core` exports: `TabStateStore`, `tabStateStore`, `wireTabs`
  - New channels: `tabs:state` / `allStates` + push `tabs:update`
  - New `packages/core/src/tab-state-store.ts` + `wire-tabs.ts`
  - New `packages/ui/src/renderer/tab-modality.js`
  - 4 new tab-state unit tests

### Changed

- `TerminalManager` gained public `onData(listener)` and `onExit(listener)` subscription APIs so core stores can observe raw pty output without touching the hot path.
- `API_SHAPE` expanded with `blocks`, `edits`, `providers`, `workspaceConfig`, `tabs` buckets and `file.read`. The `window.agentDesk.*` surface picks these up automatically via the existing `buildAgentDeskApi` shim.
- `views.js` accepts a new `config` view and delegates to `registry.mountWorkspaceConfig`.

### Deferred to v1.7.1

- Block permalinks / share-a-block URL scheme; cross-terminal search UI integration (backend `blocks:search` is live).
- Per-hunk approve/reject and Shiki syntax highlighting inside the edit-review panel (plain-text diff for now).
- Provider settings UI; streaming responses for `providers:complete`.
- Syntax highlighting in the skills/rules editor; push/pull to git or agent-knowledge sync.

## [1.6.1] - 2026-04-11

### Fixed

- **`docs/guide/quick-start.md`**: removed a broken `/screenshots/agent-comm.png` reference introduced in v1.6.0 that caused the vitepress docs build to fail with `Rollup failed to resolve import`. The rewritten "Check Agent Status" section now uses plain text to describe the three surfaces where detected agents appear (tab indicators, Agent Comm dashboard, status bar).

## [1.6.0] - 2026-04-11

Four new features landed in parallel, unified under the "project-centric" framing. Feature work carried out by four isolated subagents coordinating via the pipeline and agent-comm file-coord hook; integration + final E2E gate done on the shared working tree with zero merge conflicts.

### Added

- **Project-centric workspaces** — workspaces are now record-keyed by UUID and carry `rootPath`, per-workspace `env` vars, a `color` picked from a 24-hue palette, a list of default `agents` to spawn on open, and a `pinned` flag. Opening a workspace spawns one terminal per configured agent rooted at `rootPath` with the merged environment. One-shot migration transparently lifts pre-1.6 layout-only records on first read — no user action required.
  - New `@agent-desk/core` exports: `Workspace`, `SavedTerminal`, `migrateWorkspace`, `migrateWorkspaces`
  - New channels: `workspace:list` / `get` / `save` / `delete` / `open` / `recent`
  - New `packages/core/src/workspace-store.ts` pure helpers
  - Rewritten save dialog in `packages/ui/src/renderer/workspaces.js` — name, folder picker, env kv editor, color picker, agent multi-select, pin toggle
  - New `packages/ui/src/renderer/workspace-switcher.js` — titlebar dropdown with pinned workspaces at top, recent below
  - 13 new migration tests + 21 new store tests + 2 Playwright E2E specs
- **Read-only git sidebar** — inline view of branch, ahead/behind counts, and per-file status (modified / added / deleted / untracked / renamed / conflicted) powered by `simple-git`. Live-updates via `fs.watch` on `.git/HEAD` + `.git/index` with a polling fallback on platforms where watch is unreliable. A 1 s TTL cache absorbs bursty polls. Clicking a file dispatches a `diff:open` CustomEvent that the diff viewer subscribes to — zero hard imports between features.
  - New channels: `git:status` / `git:diff` / `git:file` + `git:update` push channel
  - New `packages/core/src/git-store.ts` — simple-git wrapper, 1 s TTL cache, debounced fs.watch
  - New `packages/ui/src/renderer/git-sidebar.js` — branch line, ahead/behind badges, collapsible file list, per-row context menu
  - Binary files flagged (no diff attempt); diffs > 1 MB truncated with a "view in external editor" fallback
  - 17 new git-store unit tests + 2 Playwright E2E specs
  - Read-only v1 — no staging / commit / push. Read-write is a deliberate follow-up decision.
- **Shiki-highlighted diff viewer** — open any file's diff as a dockview overlay with pre-highlighted hunks produced in core (never in ui, to keep `@agent-desk/ui` framework-free). Toggle unified / side-by-side with `s`, navigate hunks with `j` / `k`, close with `Esc`, hand off to external editor with `o`. Binary files and files > 500 KB render as plain text with a truncation notice.
  - New channel: `diff:render` (core → ui)
  - New `packages/core/src/diff-renderer.ts` — Shiki singleton with github-dark / github-light themes + common language grammars (js, ts, python, go, rust, java, c, cpp, cs, sh, bash, json, yaml, toml, md, html, css, sql)
  - New `packages/ui/src/renderer/diff-viewer.js` — overlay modal, unified + side-by-side modes, keyboard-driven
  - Added deps: `shiki@^2.5.0`, `diff@^8.0.4` (core only)
  - 14 new diff-renderer unit tests + 2 Playwright E2E specs (golden path + binary edge case)
- **External editor handoff** — detect installed `code` / `cursor` / `windsurf` / `codium` on `PATH` and open files, optionally at a specific line:col, via the `vscode://file/...` URL scheme with a `--goto` spawn fallback. Wired into four context-menu surfaces without any hard coupling between features:
  1. Terminal tab right-click (uses live shell-integration cwd)
  2. Agent monitor cards (uses the card's terminal cwd)
  3. Git sidebar file rows (document-level delegated listener on `.git-file-row[data-path]`)
  4. Diff viewer (`diff:open-in-editor` CustomEvent bridge)
  - New channels: `editor:detect` / `editor:open`
  - New `packages/core/src/external-editor.ts` — detection, URL builder, openFile with spawn fallback
  - Server target stubs `editor:open` as `{ ok: false, reason: 'desktop-only' }` (no point opening an editor on the server host from a remote client)
  - 21 new detector unit tests + 4 Playwright E2E specs (mock `code` shim on PATH)
- **Channel contract bump** — 15 new request channels + 1 push channel, all typed from day one. Feature handlers live in dedicated modules under `packages/core/src/handlers/` so future parallel features never have to edit `handlers-default.ts`.

### Changed

- `config-store.ts` version `1 → 2`. Migration is lossless and idempotent — legacy records are auto-wrapped with sensible defaults on first read. Existing `~/.agent-desk/config.json` files continue to work without intervention.
- Diff viewer keyboard handler now scopes its "ignore keys in inputs / textareas" rule to targets *inside* the viewer overlay. Fixes a regression where xterm.js's hidden textarea swallowed the viewer's shortcuts while the viewer was open and the underlying terminal still held focus.
- **Sidebar labels unified**: "Tasks" → "Agent Tasks", "Discover" → "Agent Discover" (consistency with "Agent Comm" and "Agent Knowledge").
- **Keybind renumber** after Agent Monitor removal: Ctrl+5 = Agent Discover, Ctrl+6 = Event Stream (was Ctrl+7), Ctrl+7 = Settings (was Ctrl+8). Custom overrides in `~/.agent-desk/keybindings.json` are preserved.
- **Git sidebar auto-collapses** when no workspace is selected instead of taking permanent screen real estate. Expands automatically when a workspace with a valid root path is opened.
- **Session-restore prompt is now a non-blocking banner** at the top of the app instead of a blocking modal overlay. The auto-restore countdown and Restore / Start Fresh buttons remain; the rest of the UI is interactive while the banner is up.

### Removed

- **Agent Monitor view** and all its scaffolding: `packages/ui/src/renderer/agent-monitor.js`, the sidebar nav entry, the `Ctrl+6` default binding, the `.agent-monitor-*` CSS block (~206 LOC), the `view-monitor` DOM slot, the command-palette entry, the context-menu integration in `#93d`, the `feature-tips` "agent-detected" tip that pointed at the monitor, the `tests/e2e/agent-monitor.spec.ts` E2E spec, and `docs/guide/agent-monitor.md`. Agent detection (`agent-parser.js` + `agent-features.js`) is preserved — it still feeds tab title indicators, cost tracking, session persistence (`session:setAgentInfo`), batch launcher naming, and the agent-comm dashboard. The monitor view itself was duplicated noise on top of those surfaces.

### Fixed

- **Agent Discover view rendering blank** — the embedded `agent-discover` plugin was crashing mid-init because `initTheme()` in its `src/ui/app.js` called `toggle.addEventListener` without null-guarding when the `#theme-toggle` element isn't present in the host shadow DOM. The null-guard is now in place; cross-cuts with the `ReferenceError: addEventListener is null` pageerror that previously fired on every view switch. Fix shipped via agent-discover v1.2.4 (separate submodule release, local patch applied to the bundled `node_modules` copy as an immediate unblock).

### Totals

- **417 unit tests passing** across 23 files (was 343, +74 new)
- **10 E2E tests passing** across 4 new feature specs
- Zero regressions; full `tsc` build clean across core, desktop, ui, server; full `prettier --check` clean; scoped `eslint` clean on every team-touched file.

## [1.4.10] - 2026-04-08

### Added

- **`TESTING.md`** describing the 3-layer test architecture (unit in `packages/*/src/**/*.test.ts`, integration in `tests/integration/`, E2E in `tests/e2e/`), how to run each layer, and what belongs where.
- **`packages/core/src/platform/paths.test.ts`** — 5 unit tests covering the platform path resolver (home expansion, per-platform config dir, session/buffer/crash subpaths).
- **`packages/core/src/crash-reporter.test.ts`** — 8 unit tests covering crash log write, rotation cap, recency detection, and latest-crash lookup.

## [1.4.9] - 2026-04-08

### Added

- **`packages/core/src/transport/router.test.ts`** — 13 unit tests covering the `createRouter()` dispatch backbone: request routing, command routing, missing-handler errors, push-bus fan-out, and `dispatchRequest` runtime-string escape hatch.
- **`packages/core/src/transport/api-shape.test.ts`** — 9 unit tests asserting `API_SHAPE` stays in sync with `RequestChannelMap` / `CommandChannelMap` / `PushChannelMap` and that `buildAgentDeskApi()` produces the expected bucket shape for each binding kind.

These lock down the architectural backbone that both transports (Electron IPC + WebSocket) rely on.

## [1.4.8] - 2026-04-08

### Added

- **`packages/core/src/session-store.test.ts`** — 7 unit tests covering session save, load, window-bounds persistence, and buffer retrieval.
- **`packages/core/src/plugin-system.test.ts`** — 8 unit tests covering plugin discovery, manifest parsing, asset resolution, per-plugin config, and teardown.

## [1.4.7] - 2026-04-08

### Added

Unit test coverage for 4 core stores:

- **`config-store.test.ts`** — 5 tests (read/write round-trip, defaults, hot-reload watcher, malformed JSON fallback, atomic write).
- **`keybindings-store.test.ts`** — 4 tests (read/write, default merge, unknown-key passthrough, empty file handling).
- **`history-store.test.ts`** — 6 tests (append, cap, de-dup, read, per-terminal filter, clear).
- **`file-ops.test.ts`** — 5 tests (`fileStat`, `fileDirname`, `fileWrite`, missing-path error, directory-write error).

## [1.4.6] - 2026-04-08

### Removed

- Dead `renderField()` helper in `packages/ui/src/renderer/settings.js`. No callers remained after the settings-panel rewrite.

### Changed

- ESLint now reports **zero warnings** across the repo.

## [1.4.5] - 2026-04-08

### Added

- **`SECURITY.md`** documenting the threat model, supported versions, and the private disclosure process.
- **`tests/integration/server-rate-limit.test.ts`** — 2 integration tests exercising the per-connection token bucket added in v1.4.3: bursts above `AGENT_DESK_RATE_LIMIT_BURST` are rejected with a 0-id error frame, and the bucket refills at `AGENT_DESK_RATE_LIMIT_RPS`.
- **`npm run check`** umbrella script wiring `build → eslint → prettier --check → vitest → playwright web` into a single command so contributors can run the full CI gate locally.

## [1.4.4] - 2026-04-08

### Changed — R4

- **Bridge channel result types tightened** by importing the real `.d.ts` types from the external `agent-comm`, `agent-tasks`, `agent-knowledge`, and `agent-discover` SDKs. Channels like `comm:inbox`, `tasks:list`, `knowledge:search`, `discover:list` now return the concrete SDK response types instead of `unknown` in `RequestChannelMap`. The renderer gets full autocomplete and the router gets real type checking on the hot path.

## [1.4.3] - 2026-04-08

### Added — R11 + R12

- **Per-connection rate limiting** on `@agent-desk/server`. Token bucket: `AGENT_DESK_RATE_LIMIT_RPS` (default 50) refills `AGENT_DESK_RATE_LIMIT_BURST` (default 100). Failures return a 0-id error frame.
- **Hard pty cap per server**: `AGENT_DESK_TERMINAL_CAP` (default 64). `terminal:create` above the cap returns `terminal cap reached` and never spawns the pty.
- **`docs/deployment.md`** expanded: full env-var table, native module ABI section, threat model section.

## [1.4.2] - 2026-04-08

### Added — R6

- **Server-rendered `index.html`**: `@agent-desk/server` injects a `<script type="module" src="/ui/web-entry.js">` tag inside `<head>` when serving the renderer's HTML, so the desktop and web target load the same `packages/ui/src/renderer/index.html`. The desktop continues to use Electron's preload bridge for the same role.
- New playwright web e2e test verifying the script injection (8/8 tests pass).

## [1.4.1] - 2026-04-08

### Changed — R2

- **`packages/ui/src/web-entry.js` is now strict-type-checked** under `tsc --noEmit` with `checkJs` + `allowJs` + JSDoc parameter types. The file is still served as raw JS to the browser, but type errors are caught at build time.
- New `packages/ui/tsconfig.json`, new `packages/ui` `typecheck` script, root build runs `npm run typecheck -w @agent-desk/ui`.

## [1.4.0] - 2026-04-08

### Changed — R1: single-source the `window.agentDesk` shape

- **`packages/core/src/transport/api-shape.ts`** is the new declarative source of the `window.agentDesk` API surface. `API_SHAPE` maps each bucket method to one of four binding kinds: `request`, `command`, `subscribe`, `localOnly`.
- **`buildAgentDeskApi(transport)`** iterates the shape and builds the bucket objects from a transport adapter's primitives.
- **`packages/desktop/src/preload/index.ts`** dropped from 223 → 90 lines. Pure transport adapter using `ipcRenderer.invoke/.send/.on` plus a switch for the localOnly tags.
- **`packages/ui/src/web-entry.js`** dropped from 269 → 192 lines. Same shape, WS transport.
- Adding a new channel now touches THREE files (channels.ts + handlers-default.ts + api-shape.ts) instead of FOUR — the preload and web shim pick it up automatically.

## [1.3.3] - 2026-04-08

### Changed — R5

- **`setupIPC()` split** into focused functions: `buildContractRouter()`, `wireCorePushBus()`, `mountElectronHandlers()` (new file `packages/desktop/src/main/electron-handlers.ts`).
- All electron-only `ipcMain` handlers (popout, dialog, window, shell, autoUpdater, app:notify) extracted to the dedicated module.

## [1.3.2] - 2026-04-08

### Added — R13

- **`@agent-desk/server` `--readonly` flag** (also `AGENT_DESK_SERVER_READONLY=1`). Wraps `buildRequestHandlers` and rejects 17 mutating channels with `code: AGENT_DESK_READONLY`.
- New `tests/integration/server-readonly.test.ts` (5 tests, all pass).

### Changed — R3

- **`AgentBridges` fields are now ECMAScript private** (`#commCtx` etc.) with public readonly getters. Prevents accidental nulling from handler code.

### Changed — R7

- **Prettier formatting** applied across 10 drifted files. CI gate is now clean.

## [1.3.0] - 2026-04-08

### Changed — Architectural cleanup pass

- **`src/main/` → `packages/desktop/src/main/`** (git mv preserved history). The orphan top-level `src/` is gone. Root `tsconfig.json` deleted.
- **`packages/desktop/src/main/desktop-handlers.ts`** extracted desktop overrides (session save with window bounds, file:write with path-approval, terminal:create with error wrapping, terminal:subscribe wiring).
- **`Router.dispatchRequest(channel: string, args: unknown[])`** typed runtime-string escape hatch — no more `as unknown as` casts in transport adapters.
- **Channel result types tightened**: ~20 `unknown`/`unknown[]` results in `RequestChannelMap` replaced with concrete types from core stores.
- **`engines` pin**: all 6 `package.json` files declare `node: >=22.0.0 <23.0.0`. New `.nvmrc`. CONTRIBUTING.md updated.
- **`.github/workflows/ci.yml`** runs build → eslint → prettier check → vitest → playwright web on every push/PR. Tag pushes also trigger `build-linux`.

## [1.2.1] - 2026-04-08

### Added

- **`@agent-desk/ui` is now a real workspace package** with subpath exports: `@agent-desk/ui` and `@agent-desk/ui/web` resolve to `packages/ui/src/web-entry.js`, the new WS-transport shim that installs `window.agentDesk` for browser/PWA targets. The shim mirrors the Electron preload bridge shape exactly so the renderer's 33 vanilla-JS files don't know which transport they're running on.
- **PWA placeholder icons** generated programmatically by `packages/pwa/public/icons/generate.js` (192px + 512px PNGs, accent-colored monogram, no design tooling required). Real branded icons should replace these for production but the manifest now points at valid files.
- **`/ui/*` static route** in `@agent-desk/server` exposing the shared UI package so the renderer can `<script src="/ui/web-entry.js">`.
- **Two new playwright web e2e tests**: `/ui/web-entry.js` serves the shim, path traversal blocked. Total: 7/7 web e2e tests pass.

## [1.2.0] - 2026-04-08

### Changed — Phase C: desktop createRouter migration

- **Single handler implementation** for both transports: `packages/core/src/handlers-default.ts` exports `buildDefaultRequestHandlers()` + `buildDefaultCommandHandlers()`, used by BOTH `@agent-desk/server` and the Electron desktop. Closes pipeline #574.
- **`src/main/ipc-bridge.ts`**: `mountIpcBridge({ router, pushChannels, getWindow })` registers `ipcMain.handle` for every router request channel and `ipcMain.on` for every command, plus subscribes to push channels and forwards them to the given window's `webContents.send`.
- **`src/main/index.ts` shrunk by ~308 lines net** (-621 / +244): all in-contract `ipcMain.handle` bodies replaced by `createRouter()` + `mountIpcBridge()` + 5 desktop overrides (session save with window bounds, file:write with path-approval, terminal:create error wrapping, terminal:subscribe with mainWindow.webContents.send wiring, session:saveLayout with local storage).
- **Electron-only IPC channels** (popout, dialog, window controls, tray, autoUpdater, app:notify, shell) stay as direct `ipcMain` handlers — they touch electron primitives that don't exist on web and are NOT in the channels contract.
- **`AgentBridges`** replaces the inline `initNativeContexts` / `closeNativeContexts` / `startNativeDataPolling` functions; the comm/tasks/knowledge/discover SDKs are now wrapped by core.

## [1.1.2] - 2026-04-08

### Added

- **Playwright web e2e suite** (`tests/e2e/web/server-ui.spec.ts`): boots `@agent-desk/server`, navigates a real chromium browser to the token-gated UI, validates 5 channels: healthz, protected route 401, UI shell 200, browser navigation + render, WS upgrade rejected without token.
- New `playwright.config.ts` `web` project + `webServer` block.
- New npm script: `test:e2e:web`.

## [1.1.1] - 2026-04-08

### Changed

- **`src/preload`** relocated to `packages/desktop/src/preload` (git mv, history preserved).
- **`@agent-desk/desktop`** now has its own `tsconfig.json` + build script; preload compiles to `packages/desktop/dist/preload/index.js`.
- `BrowserWindow.webPreferences.preload` path updated.
- electron-builder `files` glob includes `packages/desktop/dist/**`.

### Added

- **Vitest integration suite** (`tests/integration/server-ws.test.ts`): spawns `@agent-desk/server`, connects WS, validates 6 channels round-trip — `system:stats`, `config:read`, `plugins:list`, `/healthz`, 401 without token, 200 with token. The dual-target architecture is now proven in CI, not just by hand.
- 118/118 vitest tests pass (was 93).

## [1.1.0] - 2026-04-08

### Changed — Dual-target refactor

Splits the Electron app into a transport-agnostic core plus two transports (Electron IPC + WebSocket) so the same renderer can run as a desktop app or a server-hosted web/PWA experience.

#### New packages (npm workspaces)

- **`@agent-desk/core`** — transport-agnostic Node, zero electron imports. Contains `terminal-manager`, `system-monitor`, `crash-reporter`, `mcp-autoconfig`, `plugin-system`, `config-store`, `keybindings-store`, `history-store`, `session-store`, `file-ops`, `agent-bridges`, `transport/{channels,router}`, `platform/paths`.
- **`@agent-desk/server`** — Express + ws, single-user URL token auth, drives core via `createRouter()`. Proves the dual-target architecture end-to-end.
- **`@agent-desk/ui`** — vanilla-JS renderer moved here (33 files via `git mv`, history preserved).
- **`@agent-desk/desktop`** — stub package; popout/tray/autoUpdater move here next.
- **`@agent-desk/pwa`** — vite + service worker + manifest, read-only v1 flag, mobile.css for touch sizing.

#### Channel contract

`packages/core/src/transport/channels.ts` is the typed source of truth — ~55 request channels, 2 commands, 11 push events. Both transports dispatch through `createRouter()`.

#### Native modules

better-sqlite3 needs ABI rebuild per target. New scripts:

- `npm run rebuild:desktop` → `electron-rebuild`
- `npm run rebuild:server` → `npm rebuild`

## [1.0.25] - 2026-04-08

### Added

- **Playwright E2E plugin views test suite** at `tests/e2e/plugins.spec.ts`. Launches the Electron app via existing helpers and verifies that all four agent-\* plugin views (`comm`, `tasks`, `knowledge`, `discover`) load and respond inside the host: clicks each sidebar nav button, waits for the plugin global (`window.AC` / `window.TaskBoard` / `window.Knowledge` / `window.AD`), asserts the wrapper inside the shadow DOM has visible content, screenshots into `~/.claude/tmp/e2e-agent-desk-<view>.png`, and asserts no new console errors per view. Runnable via `npm run test:e2e:plugins`.

### Changed

- Tidied `.gitignore` with section headers (dependencies, local data, test artifacts, docs cache, scratch, OS cruft).

## [1.0.24] - 2026-04-07

### Changed

- Replaced hub-session lookups with direct agent-comm DB queries.

## [1.0.23] - 2026-04-06

### Fixed

- macOS dock Quit not actually quitting the app.
- False crash detection on startup.

## [1.0.22] - 2026-04-03

### Added

- **Keyboard shortcuts for all views** — `Ctrl+5` Discover, `Ctrl+6` Monitor, `Ctrl+7` Events, `Ctrl+8` Settings.

### Fixed

- Event badge filter count was off.
- Plugin version now read from `package.json` instead of being hardcoded.

## [1.0.21] - 2026-04-03

### Changed

- Adopted morphdom for DOM rendering across `agent-monitor`, `event-stream`, `commands`, `settings`. Replaces innerHTML rewrites with diffed updates.

## [1.0.20] - 2026-04-03

### Fixed

- Synced all missing CSS variables to plugins (`accent-solid`, `bg-inset`, `text-secondary`, `shadow-hover`, `shadow-panel`).

## [1.0.19] - 2026-04-03

### Fixed

- `accent-dim` was being set to a solid colour instead of a transparent rgba.

## [1.0.18] - 2026-04-03

### Fixed

- Empty state overlay glitch.
- Theme toggle resetting the active view.
- Task poll backoff under load.
- Plugin theme sync on first mount.
- Settings panel scroll position.
- Status bar overflow on narrow widths.
- Cost popover positioning.
- Monitor empty-state copy.

## [1.0.17] - 2026-04-03

### Changed

- **Standard CSS variable contract** for plugins — agent-desk defines the variables in `styles.css` and `syncThemeToPlugin` copies them 1:1 into each plugin's shadow DOM. Simpler than the previous derived-theme path.

## [1.0.16] - 2026-04-03

### Fixed

- Empty state not clearing on session restore.

## [1.0.15] - 2026-04-02

### Changed

- **Shadow-DOM plugin views replace native views.** All four agent-\* dashboards now load via the plugin protocol into a shadow root, with derived theme sync.

## [1.0.13] - 2026-04-02

### Changed

- Reverted to native views temporarily — plugin mount needed shadow DOM iteration. Re-fixed in v1.0.15.

## [1.0.12] - 2026-04-02

### Changed

- Restored native views, kept plugin infra for future use.

## [1.0.11] - 2026-04-02

### Fixed

- Plugin discovery — `__dirname` was undefined in ESM context.

## [1.0.10] - 2026-04-02

### Removed

- Native views deleted; plugins are now the only path for embedded agent-\* dashboards.

## [1.0.9] - 2026-04-02

### Added

- **Plugin system** for loading agent-\* UIs as first-party plugins. Each plugin ships an `agent-desk-plugin.json` manifest, and the renderer mounts it via a `plugin://` protocol into a per-view container.

## [1.0.8] - 2026-04-01

### Added

- Full feature parity for the four embedded views (comm/tasks/knowledge/discover).
- Hooks autoconfig.
- E2E test framework (`tests/e2e/`) with reusable launch/teardown helpers.

### Fixed

- Assorted bugfixes from QA.

## [1.0.7] - 2026-04-01

### Removed

- Webview infrastructure. Embedded dashboards no longer use `<webview>`.

### Added

- MCP config step in the onboarding wizard.

## [1.0.6] - 2026-04-01

### Added

- **Auto-configure MCP servers** for Claude Code, Cursor, Windsurf, Gemini CLI, and OpenCode on first launch.

## [1.0.5] - 2026-03-31

### Added

- Native views for comm, tasks, knowledge, discover via direct npm dep imports (later replaced by the plugin system in 1.0.9).

## [1.0.4] - 2026-03-30

### Added

- Discover tab — embeds the agent-discover dashboard on port 3424.

## [1.0.3] - 2026-03-30

### Added

- Full dashboard theme sync across the embedded views.
- Bundled MCP servers in the install package.

### Fixed

- Assorted bugs.

## [1.0.2] - 2026-03-29

### Added

- VitePress documentation site, MIT license headers.
- Mac x64 build added to CI.

### Changed

- Comprehensive docs / screenshots refresh.

## [1.0.1] - 2026-03-28

### Changed

- **Generified codebase** -- removed all personal/organization-specific references; fully open-source ready
- **Comprehensive documentation** -- README rewrite, CONTRIBUTING.md, LICENSE, docs/ARCHITECTURE.md, docs/SETUP.md, docs/FEATURES.md
- **Dashboard URLs configurable** -- all three dashboard URLs now editable in Settings instead of hardcoded
- **Shell profiles** -- profiles use generic defaults; no hardcoded paths or tool-specific assumptions

### Fixed

- **Config hot-reload** -- file watcher correctly detects external config changes on all platforms
- **Theme persistence** -- custom themes survive app restarts without flicker

## [1.0.0] - 2026-03-27

### Added

- **Agent Monitor view** (Ctrl+5) -- live card-based dashboard with agent status, task badges, tool call counts, uptime, and click-to-focus navigation
- **Batch Agent Launcher** (Ctrl+Shift+B) -- launch N agents at once with profile selection, naming patterns (`agent-{n}`), stagger delays, working directory, and optional initial commands
- **Agent Templates / Recipes** -- save, edit, and load reusable multi-agent configurations with CRUD in Settings; 2 built-in defaults (Quick Review: 3 review agents, Parallel Tasks: 5 generic agents)
- **Lifecycle Controls** -- interrupt (SIGINT), stop (SIGTERM), kill (SIGKILL), and restart agents from context menu and tab action buttons
- **Cost / Token Tracking** -- per-agent cost estimation in the status bar with configurable $2/$5 warning thresholds
- **Agent Communication Graph** -- canvas-rendered visualization of agent interactions with animated pulse, edge thickness by message count, hover tooltips, and click-to-focus
- **Cross-Terminal Search** (Ctrl+Shift+F) -- async chunked search across all terminal buffers with case-sensitive/regex modes, keyboard navigation (arrow keys + Enter), and jump-to-line with highlight
- **Session Persistence** -- 60-second auto-save, restore prompt on startup with 10-second countdown, terminal buffer replay, agent name/profile preservation, and layout persistence
- **Dashboard Health Monitoring** -- 30-second HTTP health checks for agent-comm/tasks/knowledge with sidebar status dots and auto-reconnect
- **Shell Profiles UI** -- create, edit, and delete shell profiles with command, args, env, cwd, and icon selection; Default Shell and Claude Code pre-configured
- **Task-Terminal Linking** -- `[T42]` badges on terminal tabs showing the assigned pipeline task; click badge to jump to tasks view
- **Offline Support** -- bundled xterm.js and dockview-core from node_modules via `scripts/copy-vendor.js` (no CDN dependency)
- **Shell Integration** -- OSC sequence parsing (OSC 7, OSC 133, OSC 1337) for current directory tracking, command boundary detection, and scroll marks
- **Event Stream** (Ctrl+E) -- filterable timeline panel with up to 200 events, expandable details, severity color coding, terminal filter, text search, and JSON export
- **Command Palette** (Ctrl+Shift+P) -- fuzzy-filtered command list with keyboard navigation
- **Quick Switcher** (Ctrl+P) -- fast terminal switching overlay
- **Keyboard Shortcuts overlay** (F1) -- categorized reference of all shortcuts
- **Workspaces** (Ctrl+Shift+W / Ctrl+Alt+W) -- save and load named terminal layouts
- **Pop-out windows** -- detach any terminal into its own native window
- **Terminal Chains** -- trigger commands in a target terminal when a source terminal exits or changes status
- **Customizable Keybindings** -- `~/.agent-desk/keybindings.json` with capture UI in Settings
- **Config file** -- `~/.agent-desk/config.json` persists settings, profiles, workspaces, and templates with hot-reload via file watcher
- **Theme system** -- 4 built-in themes (Default Dark, Default Light, Dracula, Nord) plus custom theme creation with full ANSI color control
- **Agent Parser** -- detects Claude Code tool calls (Read, Write, Edit, Bash, Grep, Glob, etc.), file modifications, test results, and errors from terminal output
- **Crash Reporter** -- structured crash logs in `~/.agent-desk/crash-logs/` with memory snapshots and automatic rotation
- **Auto-Update** -- checks for updates with download and install prompts
- **System Monitor** -- CPU, RAM, and disk usage in the status bar
- **Webview Bridge** -- bidirectional state sync between dashboard webviews and terminal state
- **Dashboard Injectors** -- per-dashboard toolbar injection for agent-comm, agent-tasks, and agent-knowledge

### Removed

- **Recording / Replay** -- buffer replay and command history cover this use case
- **Terminal Linking (stdout piping)** -- agents use agent-comm for coordination, not stdout piping
- **Per-Terminal Settings** -- global settings are sufficient; profiles handle per-terminal customization
- **Snippets** -- not useful when AI agents run commands
- **Inline Images addon** -- removed unused CDN dependency
- **Notification Rules** -- agents report via agent-comm, not regex-based terminal matching

### Simplified

- **Event Stream** -- removed HTTP polling; kept local event bus with filters, search, and export
- **System Monitor** -- kept status bar widget with CPU/RAM/disk; removed detailed panel view
- **Theme System** -- kept 4 built-in themes + custom creation; removed theme importers/exporters
- **Keybindings** -- kept key combos with capture UI; removed chord support and conflict detection
