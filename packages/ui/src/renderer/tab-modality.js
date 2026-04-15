// =============================================================================
// Agent Desk — Tab Modality Indicators (v1.7)
// =============================================================================
// Paints a per-tab state dot driven by:
//   - `tabs:update` push events from core (idle/running/edits-pending/errored)
//   - agent-parser events for `awaiting-input` (client-side overlay)
//
// Click actions:
//   - edits-pending → open the edit-review panel
//   - errored       → no-op (dot stays until next data)
//   - awaiting-input → focus the terminal
// =============================================================================

'use strict';

import { state } from './state.js';
import { togglePanel as toggleEditReview } from './edit-review.js';

const STATE_COLOR = {
  idle: '#909399',
  running: '#6aa7ff',
  'awaiting-input': '#e6b85c',
  'edits-pending': '#b888ff',
  errored: '#e05c5c',
};

const STATE_LABEL = {
  idle: 'Idle',
  running: 'Running',
  'awaiting-input': 'Waiting on user',
  'edits-pending': 'Edits pending review',
  errored: 'Errored',
};

const serverState = new Map();
const clientOverlay = new Map();

function injectStyles() {
  if (document.getElementById('tab-modality-styles')) return;
  const s = document.createElement('style');
  s.id = 'tab-modality-styles';
  s.textContent = `
.tab-modality-dot {
  display: inline-block;
  width: 8px; height: 8px;
  border-radius: 50%;
  margin-right: 6px;
  flex-shrink: 0;
  transition: background-color 0.15s ease;
  vertical-align: middle;
  cursor: pointer;
}
.tab-modality-dot[data-state="running"] {
  animation: tab-modality-pulse 1.6s ease-in-out infinite;
}
.tab-modality-dot[data-state="awaiting-input"] {
  animation: tab-modality-pulse 0.9s ease-in-out infinite;
}
.tab-modality-dot[data-state="edits-pending"] {
  box-shadow: 0 0 0 2px rgba(184,136,255,0.25);
}
@keyframes tab-modality-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
  `;
  document.head.appendChild(s);
}

function tabElementFor(terminalId) {
  const ts = state.terminals?.get?.(terminalId);
  return ts?._tabEl ?? null;
}

function resolveState(terminalId) {
  const overlay = clientOverlay.get(terminalId);
  const srv = serverState.get(terminalId);
  if (overlay === 'awaiting-input' && srv !== 'edits-pending') return 'awaiting-input';
  return srv ?? 'running';
}

function repaint(terminalId) {
  const tabEl = tabElementFor(terminalId);
  if (!tabEl) return;
  let dot = tabEl.querySelector('.tab-modality-dot');
  if (!dot) {
    dot = document.createElement('span');
    dot.className = 'tab-modality-dot';
    dot.addEventListener('click', (e) => onDotClick(e, terminalId));
    const label = tabEl.querySelector('.dv-tab-label');
    if (label) tabEl.insertBefore(dot, label);
    else tabEl.insertBefore(dot, tabEl.firstChild);
  }
  const st = resolveState(terminalId);
  dot.dataset.state = st;
  dot.style.backgroundColor = STATE_COLOR[st] ?? '#909399';
  dot.title = STATE_LABEL[st] ?? st;
}

function onDotClick(e, terminalId) {
  e.stopPropagation();
  const st = resolveState(terminalId);
  if (st === 'edits-pending') {
    toggleEditReview(true);
    return;
  }
  if (st === 'awaiting-input') {
    const ts = state.terminals?.get?.(terminalId);
    ts?.term?.focus?.();
  }
}

function repaintAll() {
  if (!state.terminals) return;
  for (const id of state.terminals.keys()) repaint(id);
}

async function hydrate() {
  if (!window.agentDesk?.tabs) return;
  try {
    const all = await window.agentDesk.tabs.allStates();
    if (all && typeof all === 'object') {
      for (const [id, s] of Object.entries(all)) serverState.set(id, s);
    }
  } catch {
    /* ignore */
  }
  repaintAll();
}

function onServerUpdate(terminalId, tabState) {
  serverState.set(terminalId, tabState);
  repaint(terminalId);
}

function onAgentStatus(ev) {
  const data = ev?.data ?? ev;
  if (!data || !data.terminalId) return;
  if (data.status === 'waiting' || data.status === 'awaiting-input') {
    clientOverlay.set(data.terminalId, 'awaiting-input');
    repaint(data.terminalId);
  } else {
    if (clientOverlay.get(data.terminalId) === 'awaiting-input') {
      clientOverlay.delete(data.terminalId);
      repaint(data.terminalId);
    }
  }
}

function setup() {
  if (!window.agentDesk?.tabs) {
    console.warn('[tabs] agentDesk.tabs unavailable — skipping');
    return;
  }
  injectStyles();
  window.agentDesk.tabs.onUpdate(onServerUpdate);
  hydrate();

  const bus = typeof eventBus !== 'undefined' ? eventBus : null;
  if (bus) {
    bus.on('agent:status', onAgentStatus);
    bus.on('agent:awaiting-input', (ev) => {
      const data = ev?.data ?? ev;
      if (data?.terminalId) {
        clientOverlay.set(data.terminalId, 'awaiting-input');
        repaint(data.terminalId);
      }
    });
  }

  // Repaint when tabs mount (delayed — tabs are built by terminals.js after dockview)
  const observer = new MutationObserver(() => repaintAll());
  const host = document.getElementById('terminal-views');
  if (host) observer.observe(host, { childList: true, subtree: true });

  setInterval(repaintAll, 5000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setup);
} else {
  setup();
}
