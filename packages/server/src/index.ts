// @agent-desk/server entry — boots Express + ws, wires core stores into the
// shared router, and prints the loaded URL with token to stdout.
//
//   AGENT_DESK_PORT     port (default 3420)
//   AGENT_DESK_BIND     bind addr (default 127.0.0.1)
//   AGENT_DESK_TOKEN    auth token (default: random 24-byte hex)

import { createServer } from 'http';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import express from 'express';
import {
  TerminalManager,
  HistoryStore,
  AgentBridges,
  setupCrashHandlers,
  setAppVersion,
  startMonitoring,
  onStatsUpdate,
  watchConfig,
  discoverPlugins,
  wireBlocks,
  wireEdits,
  wireTabs,
  type LoadedPlugin,
} from '@agent-desk/core';
import { TOKEN, checkExpressToken } from './auth.js';
import { buildRequestHandlers, buildCommandHandlers } from './handlers.js';
import { attachWsTransport } from './ws-transport.js';
import { makePluginAssetHandler } from './plugin-routes.js';
// Task #93b — wire git:update via the git-handlers module singleton. Imported
// via subpath because core's index.ts is spec-frozen for Phase 2.
import { setGitEmitter } from '@agent-desk/core/dist/handlers/git-handlers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(process.env.AGENT_DESK_PORT || '3420', 10);
const BIND = process.env.AGENT_DESK_BIND || '127.0.0.1';
const READ_ONLY = process.env.AGENT_DESK_SERVER_READONLY === '1' || process.argv.includes('--readonly');

setAppVersion(process.env.AGENT_DESK_VERSION || '0.0.0-server');
setupCrashHandlers();

// ---------------------------------------------------------------------------
// Core wiring
// ---------------------------------------------------------------------------

const terminals = new TerminalManager();
const history = new HistoryStore();
history.load();
terminals.onHistoryEntry((entry) => history.add(entry));

const bridges = new AgentBridges();
bridges.init();
if (bridges.failed === 3) {
  process.stderr.write(
    "WARNING: all agent SDK contexts failed to initialize. Run 'npm run rebuild:server' to rebuild better-sqlite3 against the current Node ABI.\n",
  );
}

// Plugin discovery: server's node_modules sits at packages/server/node_modules
// or the workspace root depending on hoisting. Walk up.
const candidates = [
  join(__dirname, '..', '..', '..', '..', 'node_modules'), // dist/src/index.js → repo root
  join(__dirname, '..', '..', '..', 'node_modules'),
  join(__dirname, '..', '..', 'node_modules'),
];
let plugins: LoadedPlugin[] = [];
for (const dir of candidates) {
  plugins = discoverPlugins(dir);
  if (plugins.length > 0) break;
}

// ---------------------------------------------------------------------------
// HTTP server (static UI + plugin assets + token gate)
// ---------------------------------------------------------------------------

const app = express();

// Token middleware — protects all routes except /healthz
app.use((req, res, next) => {
  if (req.path === '/healthz') return next();
  if (!checkExpressToken(req.query as Record<string, unknown>)) {
    res.status(401).send('Unauthorized');
    return;
  }
  next();
});

app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    version: process.env.AGENT_DESK_VERSION || '0.0.0-server',
    bridges: bridges.status(),
  });
});

// Static UI from packages/ui/src/renderer + the WS-transport web shim
// at /ui/web-entry.js so the renderer's <script> tags can pull it in.
const uiRoot = join(__dirname, '..', '..', 'ui', 'src', 'renderer');
const uiSharedRoot = join(__dirname, '..', '..', 'ui', 'src');

// Render index.html with the web-entry shim injected as the FIRST script tag
// inside <head>. The desktop loads index.html directly via Electron's preload
// (which exposes window.agentDesk), while the web target needs the script
// injected because there's no preload bridge.
const INDEX_HTML_PATH = join(uiRoot, 'index.html');
let cachedIndexHtml: string | null = null;
function renderIndexHtml(): string {
  if (cachedIndexHtml) return cachedIndexHtml;
  const raw = readFileSync(INDEX_HTML_PATH, 'utf-8');
  const injection = '<script type="module" src="/ui/web-entry.js"></script>';
  cachedIndexHtml = raw.replace('</head>', `  ${injection}\n  </head>`);
  return cachedIndexHtml;
}

app.get(['/', '/index.html'], (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderIndexHtml());
});
app.use(express.static(uiRoot));
app.use('/ui', express.static(uiSharedRoot));

// Plugin assets — replaces protocol.handle('plugin', …)
app.get('/plugins/:id/*', makePluginAssetHandler(plugins));

const httpServer = createServer(app);

// ---------------------------------------------------------------------------
// WebSocket transport
// ---------------------------------------------------------------------------

const ws = attachWsTransport({
  http: httpServer,
  terminals,
  buildHandlers: () => ({
    request: buildRequestHandlers({ terminals, history, bridges, plugins }, { readOnly: READ_ONLY }),
    command: buildCommandHandlers({ terminals, history, bridges, plugins }, { readOnly: READ_ONLY }),
  }),
});

// Wire core push events into the WS broadcast. The bridges polling loop
// emits with a stringly-typed channel + single payload; we trust it.
const emitAny = ws.emitToAll as unknown as (ch: string, ...args: unknown[]) => void;

bridges.startPolling((channel, payload) => emitAny(channel, payload));
watchConfig((data) => emitAny('config:changed', data));
terminals.onHistoryEntry((entry) => emitAny('history:new', entry));

startMonitoring();
onStatsUpdate((stats) => emitAny('system:stats-update', stats));

// Git file-watcher pushes — see packages/core/src/handlers/git-handlers.ts.
setGitEmitter((root: string) => emitAny('git:update', root));

// v1.7 blocks — partition pty output into structured blocks and broadcast
// blocks:new / blocks:update over the same WS push bus.
wireBlocks({
  terminals,
  emit: (channel, ...args) => emitAny(channel, ...args),
});
wireEdits({ emit: (channel, ...args) => emitAny(channel, ...args) });
wireTabs({
  terminals,
  emit: (channel, ...args) => emitAny(channel, ...args),
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

httpServer.listen(PORT, BIND, () => {
  const url = `http://${BIND === '0.0.0.0' ? 'localhost' : BIND}:${PORT}/?t=${TOKEN}`;
  const mode = READ_ONLY ? ' (READ-ONLY)' : '';
  process.stdout.write(`\n  agent-desk server${mode}\n  ${url}\n\n`);
  if (BIND === '0.0.0.0') {
    process.stdout.write('  WARNING: bound to 0.0.0.0 — terminals exposed to network. Token required.\n\n');
  }
  if (READ_ONLY) {
    process.stdout.write('  READ-ONLY mode: mutating channels blocked at the router.\n\n');
  }
});

function shutdown(): void {
  process.stdout.write('shutting down...\n');
  ws.close();
  bridges.close();
  terminals.cleanup();
  httpServer.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
