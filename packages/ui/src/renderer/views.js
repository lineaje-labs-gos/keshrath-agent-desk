// =============================================================================
// Agent Desk — Sidebar, View Switching, Theme, Settings Application
// =============================================================================

'use strict';

import { state, dom, getTermTheme, getTermFontWeight, registry } from './state.js';
import { loadPlugins, getPlugin, mountPlugin, syncAllPlugins } from './plugin-loader.js';

const _pluginViewsInit = { comm: false, tasks: false, knowledge: false, discover: false };
let _pluginsLoaded = false;

async function _ensurePluginsLoaded() {
  if (_pluginsLoaded) return;
  _pluginsLoaded = true;
  try {
    await loadPlugins();
  } catch {
    /* plugins unavailable */
  }
}

async function _initPluginView(viewKey, pluginId, container) {
  if (_pluginViewsInit[viewKey]) return;

  await _ensurePluginsLoaded();
  const plugin = getPlugin(pluginId);

  if (plugin) {
    _pluginViewsInit[viewKey] = true;
    try {
      await mountPlugin(pluginId, container);
    } catch (err) {
      _pluginViewsInit[viewKey] = false;
      container.innerHTML = `<div style="padding:24px;color:var(--text-secondary,#8b949e)">Failed to load ${pluginId}: ${err.message || err}</div>`;
    }
  } else {
    container.innerHTML = `<div style="padding:24px;color:var(--text-secondary,#8b949e)">Plugin not found: ${pluginId}</div>`;
  }
}

export function switchView(viewName) {
  const validViews = ['terminals', 'comm', 'tasks', 'knowledge', 'discover', 'events', 'config', 'settings'];
  if (!validViews.includes(viewName)) return;

  state.activeView = viewName;

  const viewConfigEl = document.getElementById('view-config');
  dom.terminalViews?.classList.remove('active');
  dom.viewComm?.classList.remove('active');
  dom.viewTasks?.classList.remove('active');
  dom.viewKnowledge?.classList.remove('active');
  dom.viewDiscover?.classList.remove('active');
  dom.viewEvents?.classList.remove('active');
  viewConfigEl?.classList.remove('active');
  dom.settingsView?.classList.remove('active');
  dom.tabBar.style.display = 'none';

  switch (viewName) {
    case 'terminals':
      dom.terminalViews.classList.add('active');
      if (state.activeTerminalId) {
        const ts = state.terminals.get(state.activeTerminalId);
        if (ts) {
          requestAnimationFrame(() => {
            registry._layoutDockview();
            registry.fitAllTerminals();
            ts.term.focus();
          });
        }
      } else {
        registry._layoutDockview();
      }
      break;
    case 'comm':
      dom.viewComm.classList.add('active');
      _initPluginView('comm', 'agent-comm', dom.viewComm);
      break;
    case 'tasks':
      dom.viewTasks.classList.add('active');
      _initPluginView('tasks', 'agent-tasks', dom.viewTasks);
      break;
    case 'knowledge':
      if (dom.viewKnowledge) dom.viewKnowledge.classList.add('active');
      _initPluginView('knowledge', 'agent-knowledge', dom.viewKnowledge);
      break;
    case 'discover':
      if (dom.viewDiscover) dom.viewDiscover.classList.add('active');
      _initPluginView('discover', 'agent-discover', dom.viewDiscover);
      break;
    case 'events':
      dom.viewEvents.classList.add('active');
      break;
    case 'config':
      viewConfigEl?.classList.add('active');
      if (typeof registry.mountWorkspaceConfig === 'function') {
        registry.mountWorkspaceConfig(viewConfigEl);
      }
      break;
    case 'settings':
      dom.settingsView.classList.add('active');
      break;
  }

  updateSidebar();
  registry.updateStatusBar();
}

export function updateSidebar() {
  const buttons = document.querySelectorAll('.nav-btn');
  buttons.forEach((btn) => {
    const view = btn.dataset.view;
    btn.classList.toggle('active', view === state.activeView);
  });
}

// Settings Application

export function applySettings() {
  // Terminal options
  const fontSize = parseInt(getSetting('fontSize')) || 14;
  const fontFamily = registry._resolveTermFont();
  const cursorStyle = getSetting('cursorStyle') || 'bar';
  const cursorBlink = getSetting('cursorBlink') !== false;
  const lineHeight = parseFloat(getSetting('lineHeight')) || 1.3;
  const scrollback = parseInt(getSetting('scrollback')) || 10000;

  for (const [id, ts] of state.terminals) {
    ts.term.options.fontSize = fontSize;
    ts.term.options.fontFamily = fontFamily;
    ts.term.options.cursorStyle = cursorStyle;
    ts.term.options.cursorBlink = cursorBlink;
    ts.term.options.lineHeight = lineHeight;
    ts.term.options.scrollback = scrollback;
    registry.fitTerminal(id);
  }

  // Sidebar position
  const sidebarPos = getSetting('sidebarPosition') || 'left';
  const main = document.getElementById('main');
  if (main) {
    main.style.flexDirection = sidebarPos === 'right' ? 'row-reverse' : 'row';
  }

  // Show/hide status bar
  const showStatusBar = getSetting('showStatusBar') !== false;
  const statusBar = document.getElementById('status-bar');
  if (statusBar) {
    statusBar.style.display = showStatusBar ? '' : 'none';
  }

  // Start on login
  const startOnLogin = getSetting('startOnLogin') === true;
  if (agentDesk.setLoginItem) agentDesk.setLoginItem(startOnLogin);

  // Tab close button mode
  const tabCloseBtn = getSetting('tabCloseButton') || 'hover';
  const termViews = document.getElementById('terminal-views');
  if (termViews) termViews.dataset.tabClose = tabCloseBtn;

  // Theme
  applyTheme(getSetting('themeId') || null);
}

export function applyTheme(themeId) {
  if (typeof setSetting === 'function' && typeof getSetting === 'function') {
    const current = getSetting('themeId');
    if (current !== themeId) {
      setSetting('themeId', themeId || null);
    }
  }

  const themeObj = typeof getThemeById === 'function' ? getThemeById(themeId) : null;
  const baseType = themeObj ? themeObj.type || 'dark' : 'dark';

  if (themeObj && typeof applyThemeColors === 'function') {
    applyThemeColors(themeObj);
  } else {
    if (typeof clearThemeColors === 'function') clearThemeColors();
    document.documentElement.setAttribute('data-theme', baseType);
  }

  const termViews = dom.terminalViews;
  if (termViews) {
    termViews.classList.toggle('dockview-theme-dark', baseType === 'dark');
    termViews.classList.toggle('dockview-theme-light', baseType !== 'dark');
  }

  const newTermTheme = getTermTheme(themeId);
  const newFontWeight = getTermFontWeight(themeId);
  for (const [, ts] of state.terminals) {
    ts.term.options.theme = newTermTheme;
    ts.term.options.fontWeight = newFontWeight;
  }

  syncAllPlugins();

  // Preserve the active view — theme class changes on terminalViews can
  // disturb the layout; re-assert which view container is active.
  const currentView = state.activeView;
  if (currentView && currentView !== 'terminals') {
    dom.terminalViews?.classList.remove('active');
    const viewEls = {
      comm: dom.viewComm,
      tasks: dom.viewTasks,
      knowledge: dom.viewKnowledge,
      discover: dom.viewDiscover,
      events: dom.viewEvents,
      config: document.getElementById('view-config'),
      settings: dom.settingsView,
    };
    const el = viewEls[currentView];
    if (el) el.classList.add('active');
  }
}

// Sidebar setup

export function setupSidebar() {
  const buttons = document.querySelectorAll('.nav-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (view) switchView(view);
    });
  });

  const terminalsBtn = document.querySelector('.nav-btn[data-view="terminals"]');
  if (terminalsBtn) {
    terminalsBtn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      registry.showContextMenu(e.clientX, e.clientY, [
        { label: 'Close Idle Terminals', icon: 'delete_sweep', action: () => registry.closeIdleTerminals() },
        { label: 'Auto-Arrange', icon: 'grid_view', action: () => registry.reorderTerminals() },
        { type: 'separator' },
        { label: 'Save Workspace', icon: 'save', action: () => registry.showWorkspaceSaveDialog() },
      ]);
    });
  }
}

export function setupAgentButton() {
  document.getElementById('btn-start-agent')?.addEventListener('click', () => {
    if (state.activeView !== 'terminals') switchView('terminals');
    const agentProfile = _getDefaultAgentProfile();
    registry.createTerminalFromProfile(agentProfile);
  });
}

export function setupThemeToggle() {
  // No-op: webview theme sync removed (native views only)
}

// ---------------------------------------------------------------------------
// Theme Toggle Button (sidebar) + OS auto-detect
// ---------------------------------------------------------------------------

function _updateThemeToggleIcon() {
  const btn = document.getElementById('btn-theme-toggle');
  if (!btn) return;
  const currentTheme = typeof getThemeById === 'function' ? getThemeById(getSetting('themeId')) : null;
  const isDark = !currentTheme || currentTheme.type === 'dark';
  const icon = btn.querySelector('.material-symbols-outlined');
  if (icon) icon.textContent = isDark ? 'light_mode' : 'dark_mode';
}

export function setupThemeToggleButton() {
  const btn = document.getElementById('btn-theme-toggle');
  if (!btn) return;

  _updateThemeToggleIcon();

  btn.addEventListener('click', () => {
    const currentTheme = typeof getThemeById === 'function' ? getThemeById(getSetting('themeId')) : null;
    const isDark = !currentTheme || currentTheme.type === 'dark';

    const targetId = isDark
      ? getSetting('preferredLightTheme') || 'default-light'
      : getSetting('preferredDarkTheme') || 'default-dark';

    setSetting('themeId', targetId);
    const targetTheme = typeof getThemeById === 'function' ? getThemeById(targetId) : null;
    setSetting('theme', targetTheme ? targetTheme.type : 'dark');
    applyTheme(targetId);
    _updateThemeToggleIcon();
  });

  // Listen for theme changes from other sources (settings, webview sync)
  window.addEventListener('settings-changed', () => _updateThemeToggleIcon());
}

// OS theme auto-detect
export function setupSystemThemeListener() {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');

  function onSystemThemeChange(e) {
    if (getSetting('followSystemTheme') !== true) return;
    const targetId = e.matches
      ? getSetting('preferredDarkTheme') || 'default-dark'
      : getSetting('preferredLightTheme') || 'default-light';

    setSetting('themeId', targetId);
    const targetTheme = typeof getThemeById === 'function' ? getThemeById(targetId) : null;
    setSetting('theme', targetTheme ? targetTheme.type : 'dark');
    applyTheme(targetId);
    _updateThemeToggleIcon();
  }

  mq.addEventListener('change', onSystemThemeChange);

  // Apply on startup if followSystemTheme is enabled
  if (getSetting('followSystemTheme') === true) {
    onSystemThemeChange(mq);
  }

  // Re-enable listener when the setting changes
  window.addEventListener('follow-system-theme-changed', (e) => {
    if (e.detail === true) {
      onSystemThemeChange(mq);
    }
  });
}

export function setupWebviewStates() {
  // No-op: webview states removed (native views only)
}

// Status bar

export function updateStatusBar() {
  const left = dom.statusLeft;
  if (left) {
    if (state.activeView === 'terminals') {
      const total = state.terminals.size;
      if (total === 0) {
        left.textContent = '0 terminals';
      } else {
        const counts = { running: 0, waiting: 0, idle: 0, exited: 0 };
        for (const ts of state.terminals.values()) {
          counts[ts.status] = (counts[ts.status] || 0) + 1;
        }
        const parts = [];
        if (counts.running > 0) parts.push(`${counts.running} running`);
        if (counts.waiting > 0) parts.push(`${counts.waiting} waiting`);
        if (counts.idle > 0) parts.push(`${counts.idle} idle`);
        if (counts.exited > 0) parts.push(`${counts.exited} exited`);
        left.textContent = `${total} terminal${total !== 1 ? 's' : ''}: ${parts.join(', ')}`;
      }
    } else {
      const viewNames = {
        comm: 'Agent Comm',
        tasks: 'Agent Tasks',
        knowledge: 'Agent Knowledge',
        discover: 'Agent Discover',
        events: 'Event Stream',
        settings: 'Settings',
      };
      left.textContent = viewNames[state.activeView] || state.activeView;
    }
  }

  const center = document.querySelector('#status-bar .status-center');
  if (center) {
    if (state.activeView === 'terminals' && state.activeTerminalId && typeof ShellIntegration !== 'undefined') {
      const cwd = ShellIntegration.getCwd(state.activeTerminalId);
      center.textContent = cwd ? '\uD83D\uDCC1 ' + cwd : '';
    } else {
      center.textContent = '';
    }
  }

  const right = dom.statusRight;
  if (right) {
    // Use a dedicated span for terminal info to avoid clobbering widget children
    let infoSpan = right.querySelector('.status-right-info');
    if (!infoSpan) {
      infoSpan = document.createElement('span');
      infoSpan.className = 'status-right-info';
      right.appendChild(infoSpan);
    }
    if (state.activeView === 'terminals' && state.activeTerminalId) {
      const ts = state.terminals.get(state.activeTerminalId);
      if (ts) {
        let rightText = ts.title + ' \u2014 ' + ts.status;
        if (typeof ShellIntegration !== 'undefined') {
          const exitCode = ShellIntegration.getLastExitCode(state.activeTerminalId);
          if (exitCode !== null) {
            rightText += exitCode === 0 ? ' \u2714' : ' \u2718 ' + exitCode;
          }
        }
        infoSpan.textContent = rightText;
      } else {
        infoSpan.textContent = '';
      }
    } else {
      infoSpan.textContent = '';
    }
  }
}

// Window Controls

export function setupWindowControls() {
  document.getElementById('btn-minimize')?.addEventListener('click', () => agentDesk.window.minimize());
  document.getElementById('btn-maximize')?.addEventListener('click', () => agentDesk.window.maximize());
  document.getElementById('btn-close')?.addEventListener('click', () => agentDesk.window.close());
}

// Help button

export function setupHelpButton() {
  const btn = document.getElementById('btn-help');
  if (btn) btn.addEventListener('click', () => registry.showShortcutsOverlay());
}

// Event Stream Setup

export function setupEventStream() {
  eventStream.init();
  const panel = eventStream.getPanel();
  const container = document.getElementById('view-events');
  if (container && panel) {
    container.appendChild(panel);
  }
}

// Tray Actions

export function setupTrayActions() {
  state._cleanupOnAction = agentDesk.onAction((action) => {
    switch (action) {
      case 'new-terminal':
        registry.createTerminal();
        break;
      default:
        console.log('Unknown tray action:', action);
    }
  });

  if (agentDesk.onOpenCwd) {
    agentDesk.onOpenCwd((cwd, command) => {
      if (state.activeView !== 'terminals') switchView('terminals');
      const opts = {};
      if (cwd) opts.cwd = cwd;
      if (command === 'default') {
        opts.command = getSetting('defaultNewTerminalCommand') || undefined;
      } else if (command) {
        opts.command = command;
      }
      registry.createTerminal(opts);
    });
  }
}

// New Tab / Terminal buttons

export function _buildProfileMenuItems() {
  const profiles = typeof getProfiles === 'function' ? getProfiles() : [];
  const items = profiles.map((p) => ({
    label: p.name,
    icon: p.icon || 'terminal',
    action: () => registry.createTerminalFromProfile(p),
  }));
  if (items.length > 0) items.push({ type: 'separator' });
  return items;
}

function _getDefaultProfile() {
  const profiles = typeof getProfiles === 'function' ? getProfiles() : [];
  const defaultId = typeof getSetting === 'function' ? getSetting('defaultProfile') : 'default-shell';
  return profiles.find((p) => p.id === defaultId) || profiles[0] || null;
}

function _getDefaultAgentProfile() {
  const profiles = typeof getProfiles === 'function' ? getProfiles() : [];
  const defaultId = typeof getSetting === 'function' ? getSetting('defaultProfile') : '';
  if (defaultId) {
    const match = profiles.find((p) => p.id === defaultId);
    if (match && match.id !== 'default-shell') return match;
  }
  const shellIds = new Set(['default-shell']);
  return (
    profiles.find((p) => !shellIds.has(p.id) && p.command && p.command !== '') ||
    profiles[0] || { command: '', icon: 'terminal', name: 'Terminal' }
  );
}

function _launchDefaultProfile() {
  const profile = _getDefaultProfile();
  if (profile) {
    registry.createTerminalFromProfile(profile);
  } else {
    registry.createTerminal();
  }
}

export function setupNewTerminalButton() {
  const btn = document.getElementById('btn-new-terminal');
  if (!btn) return;

  btn.addEventListener('click', () => {
    if (state.activeView !== 'terminals') switchView('terminals');
    _launchDefaultProfile();
  });

  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const items = _buildProfileMenuItems();
    registry.showContextMenu(e.clientX, e.clientY, items);
  });
}

export function setupNewTabButton() {
  const btn = dom.btnNewTab;
  if (!btn) return;

  btn.addEventListener('click', () => _launchDefaultProfile());

  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const items = _buildProfileMenuItems();
    items.push(
      {
        label: 'Split Right',
        icon: 'vertical_split',
        shortcut: 'Ctrl+Shift+D',
        action: () => registry.splitTerminalRight(),
      },
      {
        label: 'Split Down',
        icon: 'horizontal_split',
        shortcut: 'Ctrl+Shift+E',
        action: () => registry.splitTerminalDown(),
      },
      { type: 'separator' },
      {
        label: 'Toggle Maximize',
        icon: 'open_in_full',
        shortcut: 'Ctrl+Shift+M',
        action: () => registry.toggleMaximize(),
      },
      { type: 'separator' },
      { label: 'Close Idle Terminals', icon: 'delete_sweep', action: () => registry.closeIdleTerminals() },
      { label: 'Auto-Arrange', icon: 'grid_view', action: () => registry.reorderTerminals() },
      { type: 'separator' },
      { label: 'Save Workspace', icon: 'save', action: () => registry.showWorkspaceSaveDialog() },
    );
    registry.showContextMenu(e.clientX, e.clientY, items);
  });
}

export function setupDashboardHealth() {
  // No-op: dashboard health dots removed (native views are always available)
}

registry.setupDashboardHealth = setupDashboardHealth;

registry.switchView = switchView;
registry.updateSidebar = updateSidebar;
registry.applySettings = applySettings;
registry.applyTheme = applyTheme;
registry.updateStatusBar = updateStatusBar;
registry.setupWebviewStates = setupWebviewStates;
registry.setupSidebar = setupSidebar;
registry.setupAgentButton = setupAgentButton;
registry.setupThemeToggle = setupThemeToggle;
registry.setupThemeToggleButton = setupThemeToggleButton;
registry.setupSystemThemeListener = setupSystemThemeListener;
registry.setupWindowControls = setupWindowControls;
registry.setupHelpButton = setupHelpButton;
registry.setupEventStream = setupEventStream;
registry.setupTrayActions = setupTrayActions;
registry.setupNewTerminalButton = setupNewTerminalButton;
registry.setupNewTabButton = setupNewTabButton;
