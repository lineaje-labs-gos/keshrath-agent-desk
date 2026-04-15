// API shape — the single declarative source of the `window.agentDesk` bridge.
//
// Both @agent-desk/desktop's preload script and @agent-desk/ui's web-entry
// shim build their `window.agentDesk` object from this same shape, eliminating
// the hand-rolled duplication that existed in v1.x.
//
// Each entry maps a JS bucket method (e.g. `terminal.create`) to one of:
//   - request: round-trip via the Router request/response transport
//   - command: fire-and-forget send
//   - subscribe: subscribe to a push channel; the renderer-side shim provides
//     the unsubscribe fn
//   - localOnly: implemented entirely renderer-side (e.g. window.open for
//     openExternal in the web target). Each transport adapter chooses how to
//     fulfill these.
//
// The transport adapter (preload or web-entry) iterates this shape and wires
// each entry to its underlying primitive (ipcRenderer.invoke / WebSocket.send /
// etc.).
//
// Adding a new method now means: tick the channels.ts contract, add the
// handler in handlers-default.ts, and add ONE entry here. The desktop preload
// and web shim pick it up automatically.

import type { RequestChannel, CommandChannel, PushChannel } from './channels.js';

export type ApiBindingKind = 'request' | 'command' | 'subscribe' | 'localOnly';

export interface RequestBinding {
  kind: 'request';
  channel: RequestChannel;
  /** If true, the first arg is wrapped in a default `{}`. */
  defaultEmptyOpts?: boolean;
}

export interface CommandBinding {
  kind: 'command';
  channel: CommandChannel;
}

export interface SubscribeBinding {
  kind: 'subscribe';
  channel: PushChannel;
}

export interface LocalOnlyBinding {
  kind: 'localOnly';
  /** Tag so transports can route to a built-in fallback. */
  tag:
    | 'window.minimize'
    | 'window.maximize'
    | 'window.close'
    | 'window.flashFrame'
    | 'app.setLoginItem'
    | 'shell.openPath'
    | 'shell.openExternal'
    | 'app.notify'
    | 'dialog.openDirectory'
    | 'dialog.saveFile'
    | 'app.checkForUpdates'
    | 'app.installUpdate'
    | 'terminal.popout'
    | 'app.onUpdateStatus'
    | 'app.onCrashDetected'
    | 'app.onAction'
    | 'app.onOpenCwd';
}

export type ApiBinding = RequestBinding | CommandBinding | SubscribeBinding | LocalOnlyBinding;

export type ApiBucket = Record<string, ApiBinding>;

export type ApiShape = Record<string, ApiBucket>;

/**
 * The single source of truth for the `window.agentDesk` API surface.
 * Mirrors the original Electron preload shape exactly so the renderer's
 * existing 33 vanilla-JS files keep working without changes.
 */
export const API_SHAPE: ApiShape = {
  terminal: {
    create: { kind: 'request', channel: 'terminal:create', defaultEmptyOpts: true },
    write: { kind: 'request', channel: 'terminal:write' },
    resize: { kind: 'request', channel: 'terminal:resize' },
    kill: { kind: 'request', channel: 'terminal:kill' },
    signal: { kind: 'request', channel: 'terminal:signal' },
    restart: { kind: 'request', channel: 'terminal:restart' },
    list: { kind: 'request', channel: 'terminal:list' },
    popout: { kind: 'localOnly', tag: 'terminal.popout' },
    subscribe: { kind: 'command', channel: 'terminal:subscribe' },
    unsubscribe: { kind: 'command', channel: 'terminal:unsubscribe' },
    onData: { kind: 'subscribe', channel: 'terminal:data' },
    onExit: { kind: 'subscribe', channel: 'terminal:exit' },
  },

  session: {
    save: { kind: 'request', channel: 'session:save' },
    load: { kind: 'request', channel: 'session:load' },
    getBuffer: { kind: 'request', channel: 'session:getBuffer' },
    autoSave: { kind: 'request', channel: 'session:autoSave' },
    replayBuffer: { kind: 'request', channel: 'session:replayBuffer' },
    setAgentInfo: { kind: 'request', channel: 'session:setAgentInfo' },
    saveLayout: { kind: 'request', channel: 'session:saveLayout' },
  },

  window: {
    minimize: { kind: 'localOnly', tag: 'window.minimize' },
    maximize: { kind: 'localOnly', tag: 'window.maximize' },
    close: { kind: 'localOnly', tag: 'window.close' },
    flashFrame: { kind: 'localOnly', tag: 'window.flashFrame' },
  },

  dialog: {
    saveFile: { kind: 'localOnly', tag: 'dialog.saveFile' },
    openDirectory: { kind: 'localOnly', tag: 'dialog.openDirectory' },
  },

  file: {
    write: { kind: 'request', channel: 'file:write' },
    stat: { kind: 'request', channel: 'file:stat' },
    dirname: { kind: 'request', channel: 'file:dirname' },
    read: { kind: 'request', channel: 'file:read' },
  },

  config: {
    read: { kind: 'request', channel: 'config:read' },
    write: { kind: 'request', channel: 'config:write' },
    getPath: { kind: 'request', channel: 'config:getPath' },
    onChange: { kind: 'subscribe', channel: 'config:changed' },
  },

  keybindings: {
    read: { kind: 'request', channel: 'keybindings:read' },
    write: { kind: 'request', channel: 'keybindings:write' },
  },

  history: {
    get: { kind: 'request', channel: 'history:get' },
    clear: { kind: 'request', channel: 'history:clear' },
    onNew: { kind: 'subscribe', channel: 'history:new' },
  },

  system: {
    getStats: { kind: 'request', channel: 'system:stats' },
    startMonitoring: { kind: 'request', channel: 'system:start-monitoring' },
    stopMonitoring: { kind: 'request', channel: 'system:stop-monitoring' },
    onStatsUpdate: { kind: 'subscribe', channel: 'system:stats-update' },
  },

  app: {
    checkForUpdates: { kind: 'localOnly', tag: 'app.checkForUpdates' },
    installUpdate: { kind: 'localOnly', tag: 'app.installUpdate' },
    onUpdateStatus: { kind: 'localOnly', tag: 'app.onUpdateStatus' },
    onCrashDetected: { kind: 'localOnly', tag: 'app.onCrashDetected' },
    reportError: { kind: 'request', channel: 'app:reportError' },
    getCrashLogDir: { kind: 'request', channel: 'app:getCrashLogDir' },
  },

  comm: {
    getState: { kind: 'request', channel: 'comm:state' },
    agents: { kind: 'request', channel: 'comm:agents' },
    messages: { kind: 'request', channel: 'comm:messages' },
    channels: { kind: 'request', channel: 'comm:channels' },
    stateEntries: { kind: 'request', channel: 'comm:state-entries' },
    feed: { kind: 'request', channel: 'comm:feed' },
    onUpdate: { kind: 'subscribe', channel: 'comm:update' },
  },

  tasks: {
    getState: { kind: 'request', channel: 'tasks:state' },
    list: { kind: 'request', channel: 'tasks:list' },
    get: { kind: 'request', channel: 'tasks:get' },
    search: { kind: 'request', channel: 'tasks:search' },
    onUpdate: { kind: 'subscribe', channel: 'tasks:update' },
  },

  knowledge: {
    entries: { kind: 'request', channel: 'knowledge:entries' },
    read: { kind: 'request', channel: 'knowledge:read' },
    search: { kind: 'request', channel: 'knowledge:search' },
    sessions: { kind: 'request', channel: 'knowledge:sessions' },
    session: { kind: 'request', channel: 'knowledge:session' },
    onUpdate: { kind: 'subscribe', channel: 'knowledge:update' },
  },

  discover: {
    getState: { kind: 'request', channel: 'discover:state' },
    servers: { kind: 'request', channel: 'discover:servers' },
    server: { kind: 'request', channel: 'discover:server' },
    browse: { kind: 'request', channel: 'discover:browse' },
    activate: { kind: 'request', channel: 'discover:activate' },
    deactivate: { kind: 'request', channel: 'discover:deactivate' },
    delete: { kind: 'request', channel: 'discover:delete' },
    secrets: { kind: 'request', channel: 'discover:secrets' },
    metrics: { kind: 'request', channel: 'discover:metrics' },
    health: { kind: 'request', channel: 'discover:health' },
    onUpdate: { kind: 'subscribe', channel: 'discover:update' },
  },

  mcp: {
    detectTools: { kind: 'request', channel: 'mcp:detect-tools' },
    autoConfigure: { kind: 'request', channel: 'mcp:auto-configure' },
  },

  plugins: {
    list: { kind: 'request', channel: 'plugins:list' },
    getConfig: { kind: 'request', channel: 'plugins:getConfig' },
  },

  workspace: {
    list: { kind: 'request', channel: 'workspace:list' },
    get: { kind: 'request', channel: 'workspace:get' },
    save: { kind: 'request', channel: 'workspace:save' },
    delete: { kind: 'request', channel: 'workspace:delete' },
    open: { kind: 'request', channel: 'workspace:open' },
    recent: { kind: 'request', channel: 'workspace:recent' },
  },

  git: {
    status: { kind: 'request', channel: 'git:status' },
    diff: { kind: 'request', channel: 'git:diff' },
    file: { kind: 'request', channel: 'git:file' },
    discover: { kind: 'request', channel: 'git:discover' },
    onUpdate: { kind: 'subscribe', channel: 'git:update' },
  },

  diff: {
    render: { kind: 'request', channel: 'diff:render' },
  },

  editor: {
    detect: { kind: 'request', channel: 'editor:detect' },
    open: { kind: 'request', channel: 'editor:open' },
  },

  blocks: {
    list: { kind: 'request', channel: 'blocks:list' },
    get: { kind: 'request', channel: 'blocks:get' },
    search: { kind: 'request', channel: 'blocks:search' },
    rerun: { kind: 'request', channel: 'blocks:rerun' },
    clear: { kind: 'request', channel: 'blocks:clear' },
    onNew: { kind: 'subscribe', channel: 'blocks:new' },
    onUpdate: { kind: 'subscribe', channel: 'blocks:update' },
  },

  edits: {
    list: { kind: 'request', channel: 'edits:list' },
    get: { kind: 'request', channel: 'edits:get' },
    approve: { kind: 'request', channel: 'edits:approve' },
    reject: { kind: 'request', channel: 'edits:reject' },
    comment: { kind: 'request', channel: 'edits:comment' },
    ingest: { kind: 'request', channel: 'edits:ingest' },
    onUpdate: { kind: 'subscribe', channel: 'edits:update' },
  },

  providers: {
    list: { kind: 'request', channel: 'providers:list' },
    get: { kind: 'request', channel: 'providers:get' },
    save: { kind: 'request', channel: 'providers:save' },
    delete: { kind: 'request', channel: 'providers:delete' },
    complete: { kind: 'request', channel: 'providers:complete' },
  },

  workspaceConfig: {
    files: { kind: 'request', channel: 'workspace:configFiles' },
    read: { kind: 'request', channel: 'workspace:configRead' },
    write: { kind: 'request', channel: 'workspace:configWrite' },
  },

  tabs: {
    state: { kind: 'request', channel: 'tabs:state' },
    allStates: { kind: 'request', channel: 'tabs:allStates' },
    onUpdate: { kind: 'subscribe', channel: 'tabs:update' },
  },
};

/** Top-level (non-bucketed) bindings. */
export const API_TOPLEVEL: Record<string, ApiBinding> = {
  notify: { kind: 'localOnly', tag: 'app.notify' },
  setLoginItem: { kind: 'localOnly', tag: 'app.setLoginItem' },
  openExternal: { kind: 'localOnly', tag: 'shell.openExternal' },
  openPath: { kind: 'localOnly', tag: 'shell.openPath' },
  onAction: { kind: 'localOnly', tag: 'app.onAction' },
  onOpenCwd: { kind: 'localOnly', tag: 'app.onOpenCwd' },
};

/**
 * Build a `window.agentDesk`-shaped object from the API_SHAPE using the
 * provided transport. Each transport adapter (preload, web-entry) supplies
 * the four primitive callbacks; this helper does the iteration.
 */
export interface ApiTransport {
  request(channel: string, args: unknown[], binding: RequestBinding): unknown;
  command(channel: string, args: unknown[], binding: CommandBinding): void;
  subscribe(channel: string, callback: (...args: unknown[]) => void): () => void;
  localOnly(tag: LocalOnlyBinding['tag'], args: unknown[]): unknown;
}

// Generic shape we hand back to the renderer. Stays loose on purpose: the
// channel contract is enforced by the handler implementations, not by the
// shim's TypeScript types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AgentDeskApi = Record<string, any>;

export function buildAgentDeskApi(transport: ApiTransport): AgentDeskApi {
  const api: AgentDeskApi = {};

  function makeMethod(binding: ApiBinding): (...args: unknown[]) => unknown {
    switch (binding.kind) {
      case 'request': {
        return (...args: unknown[]) => {
          const finalArgs = binding.defaultEmptyOpts && args.length === 0 ? [{}] : args;
          return transport.request(binding.channel, finalArgs, binding);
        };
      }
      case 'command': {
        return (...args: unknown[]) => {
          transport.command(binding.channel, args, binding);
          return undefined;
        };
      }
      case 'subscribe': {
        return (callback: unknown) => transport.subscribe(binding.channel, callback as (...a: unknown[]) => void);
      }
      case 'localOnly': {
        return (...args: unknown[]) => transport.localOnly(binding.tag, args);
      }
    }
  }

  for (const [bucketName, bucket] of Object.entries(API_SHAPE)) {
    const out: Record<string, unknown> = {};
    for (const [methodName, binding] of Object.entries(bucket)) {
      out[methodName] = makeMethod(binding);
    }
    api[bucketName] = out;
  }
  for (const [methodName, binding] of Object.entries(API_TOPLEVEL)) {
    api[methodName] = makeMethod(binding);
  }
  return api;
}
