// =============================================================================
// Agent Desk — Entry Point
// =============================================================================

'use strict';

import { state, registry } from './state.js';
import './notifications.js';
import './context-menus.js';
import './agent-features.js';
import './search.js';
import './terminals.js';
import './layout.js';
import './views.js';
import './commands.js';
import './keybinds.js';
import './workspaces.js';
import './workspace-switcher.js';
import './drag-drop.js';
import './system-monitor.js';
import './batch-launcher.js';
import './templates.js';
import './git-sidebar.js';
import './onboarding.js';
import './feature-tips.js';
import './diff-viewer.js';
import './blocks.js';
import './edit-review.js';
import './unified-input.js';
import './workspace-config.js';
import './tab-modality.js';

// -----------------------------------------------------------------------------
// Global Listeners
// -----------------------------------------------------------------------------

function setupGlobalListeners() {
  document.addEventListener('click', (e) => {
    const menu = registry.getActiveContextMenu();
    if (menu && !menu.contains(e.target)) {
      registry.hideContextMenu();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      registry.hideContextMenu();
    }
  });

  window.addEventListener('beforeunload', cleanup);

  document.addEventListener('contextmenu', (e) => {
    if (e.target.tagName === 'WEBVIEW' || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      return;
    }
    e.preventDefault();
  });

  const resizeObserver = new ResizeObserver(() => {
    if (state.dockview && state.activeView === 'terminals') {
      registry._layoutDockview();
      registry.fitAllTerminals();
    }
  });
  const mainEl = document.getElementById('main');
  if (mainEl) resizeObserver.observe(mainEl);
}

// -----------------------------------------------------------------------------
// Cleanup
// -----------------------------------------------------------------------------

function cleanup() {
  if (_layoutAutoSaveInterval) {
    clearInterval(_layoutAutoSaveInterval);
    _layoutAutoSaveInterval = null;
  }
  if (state._cleanupOnData) {
    state._cleanupOnData();
    state._cleanupOnData = null;
  }
  if (state._cleanupOnExit) {
    state._cleanupOnExit();
    state._cleanupOnExit = null;
  }
  if (state._cleanupOnAction) {
    state._cleanupOnAction();
    state._cleanupOnAction = null;
  }
  if (registry._stopTaskBadgePolling) {
    registry._stopTaskBadgePolling();
  }
  for (const [, ts] of state.terminals) {
    if (ts.resizeObserver) {
      ts.resizeObserver.disconnect();
      ts.resizeObserver = null;
    }
    try {
      ts.term.dispose();
    } catch (_e) {
      /* noop */
    }
  }
  state.terminals.clear();
  registry.destroySystemMonitor();
  eventStream.destroy();
  if (state.dockview) {
    state.dockview.dispose();
    state.dockview = null;
  }
}

// -----------------------------------------------------------------------------
// Session Restore — non-blocking banner at top of app with auto-restore countdown
// -----------------------------------------------------------------------------

function showRestorePrompt(terminalCount) {
  return new Promise((resolve) => {
    const banner = document.createElement('div');
    banner.className = 'session-restore-banner';

    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined session-restore-icon';
    icon.textContent = 'restore';
    banner.appendChild(icon);

    const msg = document.createElement('div');
    msg.className = 'session-restore-message';
    msg.textContent = `Restore previous session? (${terminalCount} terminal${terminalCount !== 1 ? 's' : ''})`;
    banner.appendChild(msg);

    const countdown = document.createElement('div');
    countdown.className = 'session-restore-countdown';
    let remaining = 10;
    countdown.textContent = `Auto-restoring in ${remaining}s`;
    banner.appendChild(countdown);

    const btnRow = document.createElement('div');
    btnRow.className = 'session-restore-buttons';

    const noBtn = document.createElement('button');
    noBtn.className = 'session-restore-btn session-restore-btn-no';
    noBtn.textContent = 'Start Fresh';

    const yesBtn = document.createElement('button');
    yesBtn.className = 'session-restore-btn session-restore-btn-yes';
    yesBtn.textContent = 'Restore';

    btnRow.appendChild(noBtn);
    btnRow.appendChild(yesBtn);
    banner.appendChild(btnRow);

    // Mount the banner at the very top of #app so it pushes content down
    // instead of overlaying it. Falls back to body if #app is missing.
    const app = document.getElementById('app') || document.body;
    app.insertBefore(banner, app.firstChild);

    let timer = null;
    const cleanup = (result) => {
      if (timer) clearInterval(timer);
      banner.classList.remove('visible');
      setTimeout(() => banner.remove(), 200);
      resolve(result);
    };

    noBtn.addEventListener('click', () => cleanup(false));
    yesBtn.addEventListener('click', () => cleanup(true));

    requestAnimationFrame(() => banner.classList.add('visible'));

    timer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        cleanup(true);
      } else {
        countdown.textContent = `Auto-restoring in ${remaining}s`;
      }
    }, 1000);
  });
}

async function replayBufferToTerminal(newTerminalId, savedTerminalId) {
  try {
    const buffer = await agentDesk.session.replayBuffer(savedTerminalId);
    if (buffer) {
      const ts = state.terminals.get(newTerminalId);
      if (ts && ts.term) {
        ts.term.write(buffer);
      }
    }
  } catch {
    /* buffer replay is best-effort */
  }
}

function saveLayoutToMain() {
  if (state.dockview) {
    try {
      const layout = state.dockview.toJSON();
      agentDesk.session.saveLayout(layout);
    } catch {
      /* dockview may not support toJSON */
    }
  }
}

async function createDefaultTerminal() {
  const profiles = typeof getProfiles === 'function' ? getProfiles() : [];
  const defaultId = getSetting('defaultProfile') || 'default-shell';
  const profile = profiles.find((p) => p.id === defaultId) || profiles[0];
  if (profile) {
    await registry.createTerminalFromProfile(profile);
  } else {
    const defaultCmd = getSetting('defaultNewTerminalCommand') || '';
    await registry.createTerminal({ command: defaultCmd || undefined });
  }
}

registry.createDefaultTerminal = createDefaultTerminal;

async function _reregisterAgents(agentNames) {
  if (!agentNames || agentNames.length === 0) return 0;

  let commAvailable = false;
  try {
    const resp = await fetch('http://localhost:3421/api/agents', {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    commAvailable = resp.ok;
  } catch {
    /* agent-comm not running */
  }

  let registered = 0;
  if (commAvailable) {
    for (const name of agentNames) {
      try {
        const resp = await fetch('http://localhost:3421/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
          signal: AbortSignal.timeout(2000),
        });
        if (resp.ok) registered++;
      } catch {
        /* registration failed for this agent */
      }
    }
  }

  try {
    const resp = await fetch('http://localhost:3422/api/tasks', {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    if (resp.ok) {
      console.info(
        '[agent-desk] agent-tasks is available. Task claims need manual re-assignment — auto-claiming skipped to avoid conflicts.',
      );
    }
  } catch {
    /* agent-tasks not running */
  }

  return registered;
}

async function restoreSession() {
  const allTerminals = await agentDesk.terminal.list();
  const liveTerminals = allTerminals ? allTerminals.filter((t) => t.status === 'running') : [];

  if (liveTerminals && liveTerminals.length > 0) {
    let firstId = null;
    for (const live of liveTerminals) {
      const id = await registry.reconnectTerminal(live);
      if (id && !firstId) firstId = id;
    }

    registry.applyTheme(getSetting('themeId') || null);

    if (state.dockview && firstId) {
      setTimeout(() => {
        registry._activateTerminalById(firstId);
        registry.fitAllTerminals();
      }, 200);
    }
    startLayoutAutoSave();
    return;
  }

  let session = null;
  try {
    session = await agentDesk.session.load();
  } catch (err) {
    console.error('Failed to load session:', err);
  }

  if (!session || !session.terminals || session.terminals.length === 0) {
    if (getSetting('newTerminalOnStartup') === true) {
      await createDefaultTerminal();
    }
    startLayoutAutoSave();
    return;
  }

  const shouldRestore = await showRestorePrompt(session.terminals.length);

  if (!shouldRestore) {
    if (getSetting('newTerminalOnStartup') === true) {
      await createDefaultTerminal();
    }
    startLayoutAutoSave();
    return;
  }

  let firstId = null;
  const restoredAgentNames = [];
  for (const saved of session.terminals) {
    const id = await registry.createTerminal({
      command: saved.command,
      args: saved.args,
      cwd: saved.cwd,
      noActivate: true,
    });
    if (id) {
      if (!firstId) firstId = id;
      registry.renameTerminal(id, saved.title);
      if (saved.agentName || saved.profileName) {
        agentDesk.session.setAgentInfo(id, saved.agentName || null, saved.profileName || null);
      }
      if (saved.agentName) {
        restoredAgentNames.push(saved.agentName);
      }
      replayBufferToTerminal(id, saved.id);
    }
  }

  // Re-register agents with agent-comm if available
  const registeredCount = await _reregisterAgents(restoredAgentNames);
  const termCount = session.terminals.length;
  let toastMsg = `Restored ${termCount} terminal${termCount !== 1 ? 's' : ''}`;
  if (registeredCount > 0) {
    toastMsg += `. Agent registration restored for ${registeredCount} agent${registeredCount !== 1 ? 's' : ''}`;
  }
  registry.showToast(toastMsg);

  registry.applyTheme(getSetting('themeId') || null);

  if (state.dockview) {
    const panels = state.dockview.panels;
    if (panels.length > 0) {
      let i = 0;
      const cycleNext = () => {
        if (i < panels.length) {
          panels[i].api.setActive();
          requestAnimationFrame(() => {
            const tid = panels[i].params?.terminalId;
            if (tid) registry.fitTerminal(tid);
            i++;
            setTimeout(cycleNext, 50);
          });
        } else if (firstId) {
          registry._activateTerminalById(firstId);
        }
      };
      setTimeout(cycleNext, 100);
    }
  }

  startLayoutAutoSave();
}

let _layoutAutoSaveInterval = null;

function startLayoutAutoSave() {
  if (_layoutAutoSaveInterval) return;
  _layoutAutoSaveInterval = setInterval(() => {
    saveLayoutToMain();
  }, 60000);
}

// -----------------------------------------------------------------------------
// Auto-Update UI
// -----------------------------------------------------------------------------

function setupUpdateListener() {
  agentDesk.app.onUpdateStatus((status) => {
    if (status.type === 'update-available') {
      registry.showToast(status.message);
    } else if (status.type === 'update-downloaded') {
      showUpdateBanner(status.message);
    }
  });
}

function showUpdateBanner(message) {
  let banner = document.querySelector('.update-banner');
  if (banner) banner.remove();

  banner = document.createElement('div');
  banner.className = 'update-banner';

  const text = document.createElement('span');
  text.className = 'update-banner-text';
  text.textContent = message;
  banner.appendChild(text);

  const btn = document.createElement('button');
  btn.className = 'update-banner-btn';
  btn.textContent = 'Restart Now';
  btn.addEventListener('click', () => {
    agentDesk.app.installUpdate();
  });
  banner.appendChild(btn);

  const dismiss = document.createElement('button');
  dismiss.className = 'update-banner-dismiss';
  dismiss.innerHTML = '<span class="material-symbols-outlined">close</span>';
  dismiss.addEventListener('click', () => {
    banner.remove();
  });
  banner.appendChild(dismiss);

  document.body.appendChild(banner);
  requestAnimationFrame(() => banner.classList.add('visible'));
}

// -----------------------------------------------------------------------------
// Crash Detection
// -----------------------------------------------------------------------------

function setupCrashDetection() {
  agentDesk.app.onCrashDetected((dir) => {
    registry.showToast(`Agent Desk crashed last time. Crash log saved to ${dir}`);
  });
}

// -----------------------------------------------------------------------------
// Renderer Error Handlers
// -----------------------------------------------------------------------------

function setupRendererErrorHandlers() {
  window.onerror = (message, source, lineno, colno, error) => {
    agentDesk.app.reportError({
      message: `${message} (${source}:${lineno}:${colno})`,
      stack: error?.stack || '',
      source: 'renderer',
    });
  };

  window.onunhandledrejection = (event) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack || '' : '';
    agentDesk.app.reportError({
      message: `Unhandled rejection: ${message}`,
      stack,
      source: 'renderer',
    });
  };
}

// -----------------------------------------------------------------------------
// Initialization
// -----------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async function () {
  setupGlobalListeners();
  registry.setupKeyboardShortcuts();
  registry.setupDataHandlers();
  registry.setupSidebar();
  registry.setupWindowControls();
  registry.setupNewTabButton();
  registry.setupNewTerminalButton();
  registry.setupAgentButton();
  registry.setupThemeToggle();
  registry.setupThemeToggleButton();
  registry.setupSystemThemeListener();
  registry.setupHelpButton();
  registry.setupTrayActions();
  registry.setupWebviewStates();
  registry.setupDashboardHealth();
  registry.setupEventStream();
  registry.setupDragDrop();

  if (registry.initWorkspaceSwitcher) registry.initWorkspaceSwitcher();

  registry.initDockview();

  if (typeof initSettings === 'function') {
    await initSettings(document.getElementById('settings-panel'));
  }

  registry.applySettings();
  window.addEventListener('settings-changed', () => {
    registry.applySettings();
  });

  registry.updateStatusBar();
  registry.initSystemMonitor();
  if (registry.initGitSidebar) registry.initGitSidebar();

  registry.switchView('terminals');
  if (registry._updateEmptyState) registry._updateEmptyState();

  setupUpdateListener();
  setupCrashDetection();
  setupRendererErrorHandlers();

  registry.initOnboarding();
  registry.initFeatureTips();

  restoreSession();
});
