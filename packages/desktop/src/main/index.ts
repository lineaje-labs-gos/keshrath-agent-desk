import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification } from 'electron';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { existsSync, statSync } from 'fs';
import {
  TerminalManager,
  type HistoryEntry,
  startMonitoring,
  stopMonitoring,
  onStatsUpdate,
  setAppVersion,
  setupCrashHandlers,
  hasRecentCrashLogs,
  watchConfig,
  HistoryStore,
  saveSession as coreSaveSession,
  loadSession,
  getSystemStats,
  AgentBridges,
  createRouter,
  wireBlocks,
  wireEdits,
  wireTabs,
  type PushChannel,
} from '@agent-desk/core';
import { mountIpcBridge } from './ipc-bridge.js';
import { buildDesktopRequestHandlers, buildDesktopCommandHandlers } from './desktop-handlers.js';
import { mountElectronHandlers } from './electron-handlers.js';
import { discoverPlugins, registerPluginProtocol, type LoadedPlugin } from './plugin-electron.js';
// Task #93b — wire the git push channel. Imported via subpath because core's
// index.ts is spec-frozen for Phase 2; this is the single approved exception.
import { setGitEmitter } from '@agent-desk/core/dist/handlers/git-handlers.js';

setAppVersion(app.getVersion());
setupCrashHandlers();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

// All four agent SDK contexts + their polling loops live in @agent-desk/core
// AgentBridges. The desktop bootstrap instantiates one and wires its push
// emissions through the router into mainWindow.webContents.send.
const bridges = new AgentBridges();

// Live reload in development — watches renderer files
try {
  require('electron-reload')(join(__dirname, '../../../../packages/ui/src/renderer'), {
    electron: join(__dirname, '../../../../node_modules/.bin/electron'),
  });
} catch {
  // electron-reload not available in production builds
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let saveInterval: ReturnType<typeof setInterval> | null = null;
let trayTooltipInterval: ReturnType<typeof setInterval> | null = null;
let isQuitting = false;
let updateCheckInterval: ReturnType<typeof setInterval> | null = null;
let loadedPlugins: LoadedPlugin[] = [];
const terminalManager = new TerminalManager();

// Config file (~/.agent-desk/config.json) is now provided by @agent-desk/core.
// We keep a local stop-fn so we can dispose the watcher on quit.
let stopConfigWatcher: (() => void) | null = null;
const historyStore = new HistoryStore();

// ---------------------------------------------------------------------------
// CLI Launch Args & Single Instance
// ---------------------------------------------------------------------------

interface LaunchArgs {
  cwd: string | null;
  command: string | null;
}

function parseLaunchArgs(argv: string[]): LaunchArgs {
  let cwd: string | null = null;
  let command: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--cwd' && argv[i + 1]) {
      cwd = argv[++i];
    } else if (argv[i] === '--command' && argv[i + 1]) {
      command = argv[++i];
    }
  }

  // Bare directory as last arg fallback
  if (!cwd) {
    const last = argv[argv.length - 1];
    if (last && !last.startsWith('-') && !last.includes('electron') && !last.endsWith('.js')) {
      try {
        if (existsSync(last) && statSync(last).isDirectory()) {
          cwd = last;
        }
      } catch {
        // not a valid path
      }
    }
  }

  return { cwd, command };
}

function openInRenderer(args: LaunchArgs): void {
  if (mainWindow) {
    mainWindow.webContents.send('action:open-cwd', args.cwd, args.command);
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const args = parseLaunchArgs(argv);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      if (args.cwd || args.command) {
        openInRenderer(args);
      }
    }
  });
}

// Session persistence is provided by @agent-desk/core. The desktop shell
// owns the renderer-saved layout (it lives in this process across saves).
let _savedLayout: unknown = null;
function saveSession(): void {
  coreSaveSession(terminalManager, {
    windowBounds: mainWindow?.getBounds(),
    layout: _savedLayout,
  });
}

function createWindow(): BrowserWindow {
  const savedSession = loadSession();
  const bounds = savedSession?.windowBounds;

  const win = new BrowserWindow({
    width: bounds?.width || 1400,
    height: bounds?.height || 900,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 800,
    minHeight: 600,
    title: 'Agent Desk',
    icon: join(__dirname, '../../../../resources/icon.png'),
    backgroundColor: '#1a1d23',
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadFile(join(__dirname, '../../../../packages/ui/src/renderer/index.html'));

  let trayNotified = false;
  win.on('close', (e) => {
    saveSession();
    if (tray && !isQuitting) {
      e.preventDefault();
      win.hide();
      if (!trayNotified && Notification.isSupported()) {
        new Notification({
          title: 'Agent Desk',
          body: 'Minimized to system tray. Right-click the tray icon to quit.',
        }).show();
        trayNotified = true;
      }
    }
  });

  // Auto-save session every 60 seconds (protects against crashes)
  saveInterval = setInterval(saveSession, 60000);

  return win;
}

function createTray(): void {
  const iconPath = join(__dirname, '../../../../resources/icon.png');
  let trayIcon: Electron.NativeImage;
  try {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } catch {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Agent Desk');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Agent Desk', click: () => mainWindow?.show() },
    { type: 'separator' },
    {
      label: 'New Terminal',
      click: () => {
        mainWindow?.show();
        mainWindow?.webContents.send('action:new-terminal');
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        tray?.destroy();
        tray = null;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => mainWindow?.show());
}

// Track approved file:write paths (set by dialog:saveFile, consumed by file:write)
const approvedWritePaths = new Set<string>();

let unmountIpcBridge: (() => void) | null = null;

// ---------------------------------------------------------------------------
// IPC setup — split into focused functions:
//   buildContractRouter()  — assembles handlers for in-contract channels
//   wireCorePushBus()      — feeds core stores into the router's emit bus
//   mountElectronHandlers — direct ipcMain for electron-only channels
//                          (defined in ./electron-handlers.ts)
// ---------------------------------------------------------------------------

let unmountElectronHandlers: (() => void) | null = null;

function buildContractRouter() {
  const handlerDeps = {
    terminals: terminalManager,
    history: historyStore,
    bridges,
    plugins: loadedPlugins,
    getMainWindow: () => mainWindow,
    getSavedLayout: () => _savedLayout,
    setSavedLayout: (layout: unknown) => {
      _savedLayout = layout;
    },
    approvedWritePaths,
  };

  return createRouter({
    requestHandlers: buildDesktopRequestHandlers(handlerDeps),
    commandHandlers: buildDesktopCommandHandlers(handlerDeps),
  });
}

const PUSH_CHANNELS: PushChannel[] = [
  'comm:update',
  'tasks:update',
  'knowledge:update',
  'discover:update',
  'config:changed',
  'history:new',
  'system:stats-update',
  'git:update',
  'blocks:new',
  'blocks:update',
  'edits:update',
  'tabs:update',
];

function wireCorePushBus(router: ReturnType<typeof createRouter>): void {
  bridges.startPolling((channel, payload) => {
    router.emit(channel as PushChannel, payload as never);
  });
  watchConfig((data) => router.emit('config:changed', data));
  terminalManager.onHistoryEntry((entry: HistoryEntry) => {
    historyStore.add(entry);
    router.emit('history:new', entry);
  });
  startMonitoring();
  onStatsUpdate((stats) => router.emit('system:stats-update', stats));
  // Task #93b — git file watcher fires this whenever .git/HEAD or .git/index
  // change. The UI subscribes to 'git:update' and refreshes its sidebar.
  setGitEmitter((root: string) => router.emit('git:update', root));
  wireBlocks({
    terminals: terminalManager,
    emit: (channel, ...args) => router.emit(channel, ...args),
  });
  wireEdits({ emit: (channel, ...args) => router.emit(channel, ...args) });
  wireTabs({
    terminals: terminalManager,
    emit: (channel, ...args) => router.emit(channel, ...args),
  });
}

function setupIPC(): void {
  const router = buildContractRouter();
  unmountIpcBridge = mountIpcBridge({
    router,
    pushChannels: PUSH_CHANNELS,
    getWindow: () => mainWindow,
  });
  wireCorePushBus(router);

  unmountElectronHandlers = mountElectronHandlers({
    getMainWindow: () => mainWindow,
    approvedWritePaths,
    terminals: terminalManager,
    resourcesDir: join(__dirname, '../../../../resources'),
    rendererDir: join(__dirname, '../../../../packages/ui/src/renderer'),
    preloadPath: join(__dirname, '../preload/index.js'),
  });
}

// History persistence is now provided by @agent-desk/core HistoryStore
// (instantiated as `historyStore` near the top of this file).

// ---------------------------------------------------------------------------
// Auto-Updater (electron-updater)
// ---------------------------------------------------------------------------

function setupAutoUpdater(): void {
  try {
    import('electron-updater').then((mod) => {
      const autoUpdater = mod?.autoUpdater;
      if (!autoUpdater?.setFeedURL) return;
      autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'keshrath',
        repo: 'agent-desk',
      } as Parameters<typeof autoUpdater.setFeedURL>[0]);

      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;

      autoUpdater.on('update-available', (info) => {
        const version = info?.version || 'unknown';
        sendUpdateStatus('update-available', `Update available (v${version}). Downloading...`);
      });

      autoUpdater.on('update-downloaded', (info) => {
        const version = info?.version || 'unknown';
        sendUpdateStatus('update-downloaded', `Update v${version} ready. Restart to apply.`);
      });

      autoUpdater.on('error', (err) => {
        process.stderr.write(`[agent-desk] auto-updater error: ${err?.message || err}\n`);
      });

      setTimeout(() => {
        autoUpdater.checkForUpdates().catch(() => {});
      }, 10000);

      updateCheckInterval = setInterval(
        () => {
          autoUpdater.checkForUpdates().catch(() => {});
        },
        4 * 60 * 60 * 1000,
      );

      ipcMain.handle('app:checkForUpdates', () => {
        return autoUpdater.checkForUpdates().catch(() => null);
      });

      ipcMain.handle('app:installUpdate', () => {
        autoUpdater.quitAndInstall(false, true);
      });
    });
  } catch (err) {
    process.stderr.write(`[agent-desk] auto-updater init failed: ${err}\n`);
  }
}

function sendUpdateStatus(type: string, message: string): void {
  if (mainWindow) {
    try {
      mainWindow.webContents.send('app:updateStatus', { type, message });
    } catch {
      /* window may be closed */
    }
  }
}

app.whenReady().then(async () => {
  historyStore.load();
  bridges.init();

  loadedPlugins = discoverPlugins(join(__dirname, '..', '..', '..', '..', 'node_modules'));
  // plugins:list / plugins:getConfig are now registered via createRouter() →
  // mountIpcBridge → buildDefaultRequestHandlers. Don't double-register them.
  if (loadedPlugins.length > 0) {
    registerPluginProtocol(loadedPlugins);
  }

  setupIPC();
  mainWindow = createWindow();
  createTray();
  // Note: config watcher and history/system stats listeners are wired
  // inside setupIPC() — they emit through the router so the renderer
  // receives them via the same push channels the WS server uses.
  stopConfigWatcher = () => {}; // disposed implicitly when bridges.close() runs

  setupAutoUpdater();

  // MCP auto-configuration removed from startup — now handled by onboarding wizard

  const crashInfo = hasRecentCrashLogs();
  if (crashInfo.hasCrash && mainWindow) {
    mainWindow.webContents.on('did-finish-load', () => {
      setTimeout(() => {
        mainWindow?.webContents.send('app:crashDetected', crashInfo.dir);
      }, 2000);
    });
  }

  function updateTrayTooltip(): void {
    if (!tray) return;
    const stats = getSystemStats();
    const ramGB = (stats.ram.used / (1024 * 1024 * 1024)).toFixed(1);
    const ramTotalGB = (stats.ram.total / (1024 * 1024 * 1024)).toFixed(0);
    const termCount = terminalManager.list().filter((t) => t.status === 'running').length;
    tray.setToolTip(
      `Agent Desk\nCPU: ${stats.cpu}% \u00B7 RAM: ${ramGB}/${ramTotalGB} GB\n${termCount} terminal${termCount !== 1 ? 's' : ''} running`,
    );
  }
  trayTooltipInterval = setInterval(updateTrayTooltip, 10000);
  setTimeout(updateTrayTooltip, 3000);

  // Handle startup CLI args
  const startupArgs = parseLaunchArgs(process.argv);
  if (startupArgs.cwd || startupArgs.command) {
    mainWindow.webContents.on('did-finish-load', () => {
      setTimeout(() => openInRenderer(startupArgs), 500);
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    } else {
      mainWindow?.show();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // On Windows/Linux, keep running in tray
    if (!tray) app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  saveSession();
  bridges.close();
  unmountIpcBridge?.();
  unmountIpcBridge = null;
  unmountElectronHandlers?.();
  unmountElectronHandlers = null;
  stopMonitoring();
  if (saveInterval) {
    clearInterval(saveInterval);
    saveInterval = null;
  }
  if (trayTooltipInterval) {
    clearInterval(trayTooltipInterval);
    trayTooltipInterval = null;
  }
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
    updateCheckInterval = null;
  }
  if (stopConfigWatcher) {
    stopConfigWatcher();
    stopConfigWatcher = null;
  }
  terminalManager.cleanup();
});
