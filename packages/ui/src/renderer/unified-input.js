// =============================================================================
// Agent Desk — Unified Input Bar (v1.7)
// =============================================================================
// Warp-style titlebar input with intent auto-detect:
//   $ <cmd>   → write <cmd>\n to the focused terminal's pty (shell)
//   /<name>   → forward to existing command palette (if present)
//   <text>    → if the focused terminal is a Claude Code agent, send the
//               prompt to its stdin. Otherwise call providers:complete on the
//               first configured provider and surface the reply inline.
//
// Ctrl+L focuses the input. Enter submits. Up/Down cycles history.
// Esc clears. History is per-browser, stored in localStorage.
// =============================================================================

'use strict';

import { state } from './state.js';

const HISTORY_KEY = 'agent-desk.unified-input.history';
const HISTORY_MAX = 50;

let rootEl = null;
let inputEl = null;
let hintEl = null;
let modeEl = null;
let responseEl = null;
let history = loadHistory();
let historyCursor = -1;
let draft = '';

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-HISTORY_MAX)));
  } catch {
    /* ignore */
  }
}

function pushHistory(entry) {
  if (!entry) return;
  if (history[history.length - 1] === entry) return;
  history.push(entry);
  if (history.length > HISTORY_MAX) history.shift();
  saveHistory();
  historyCursor = -1;
}

function injectStyles() {
  if (document.getElementById('unified-input-styles')) return;
  const s = document.createElement('style');
  s.id = 'unified-input-styles';
  s.textContent = `
#unified-input-slot {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  -webkit-app-region: no-drag;
  padding: 0 16px;
  min-width: 0;
}
.unified-input-wrap {
  display: flex; flex-direction: column; align-items: stretch;
  width: 100%; max-width: 640px;
  position: relative;
}
.unified-input-row {
  display: flex; align-items: center; gap: 8px;
  background: var(--md-sys-color-surface-container-high, #2a2e35);
  border: 1px solid var(--md-sys-color-outline-variant, #333);
  border-radius: 18px;
  padding: 4px 10px 4px 12px;
  height: 32px;
  transition: border-color 0.1s ease, background 0.1s ease;
}
.unified-input-row:focus-within {
  border-color: var(--md-sys-color-primary, #6aa7ff);
  background: var(--md-sys-color-surface-container-highest, #363b42);
}
.unified-input-mode {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 10px;
  background: var(--md-sys-color-surface-container-low, #191c21);
  color: var(--md-sys-color-on-surface-variant, #909399);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  user-select: none;
}
.unified-input-mode.shell { color: #6aa7ff; }
.unified-input-mode.palette { color: #e6b85c; }
.unified-input-mode.nl { color: #3ec97a; }
.unified-input-mode.provider { color: #b888ff; }
.unified-input-input {
  flex: 1;
  background: transparent;
  border: 0;
  outline: 0;
  color: inherit;
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  padding: 0;
  min-width: 0;
}
.unified-input-input::placeholder { color: var(--md-sys-color-on-surface-variant, #909399); }
.unified-input-hint {
  font-size: 10px;
  color: var(--md-sys-color-on-surface-variant, #909399);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: none;
}
.unified-input-response {
  position: absolute;
  left: 0; right: 0; top: 100%;
  margin-top: 4px;
  background: var(--md-sys-color-surface-container, #1f2329);
  border: 1px solid var(--md-sys-color-outline-variant, #333);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 12px;
  max-height: 320px;
  overflow-y: auto;
  box-shadow: 0 4px 16px rgba(0,0,0,0.3);
  white-space: pre-wrap;
  display: none;
  z-index: 950;
  font-family: 'JetBrains Mono', monospace;
  line-height: 1.5;
}
.unified-input-response.visible { display: block; }
.unified-input-response.error { color: #e05c5c; }
.unified-input-response .unified-response-head {
  display: flex; justify-content: space-between; align-items: center;
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  color: var(--md-sys-color-on-surface-variant, #909399);
  margin-bottom: 6px;
}
.unified-input-response .unified-response-close {
  background: transparent; border: 0; cursor: pointer; color: inherit;
  padding: 2px; border-radius: 4px;
}
.unified-input-response .unified-response-close:hover { background: var(--md-sys-color-surface-container-high, #2a2e35); }
  `;
  document.head.appendChild(s);
}

function detectMode(value) {
  if (value.startsWith('$ ') || value === '$') return 'shell';
  if (value.startsWith('/')) return 'palette';
  if (activeAgentTerminalId()) return 'nl';
  if (firstProviderId()) return 'provider';
  return 'nl';
}

function activeAgentTerminalId() {
  const tid = state.activeTerminalId;
  if (!tid) return null;
  const ap = typeof agentParser !== 'undefined' ? agentParser : null;
  if (!ap) return null;
  try {
    if (ap.isAgent(tid)) return tid;
  } catch {
    /* ignore */
  }
  return null;
}

let _providerIdCache = null;
let _providerIdCacheAt = 0;
async function firstProviderIdAsync() {
  if (Date.now() - _providerIdCacheAt < 5000) return _providerIdCache;
  try {
    const list = await window.agentDesk?.providers?.list?.();
    _providerIdCache = list && list.length ? list[0].id : null;
  } catch {
    _providerIdCache = null;
  }
  _providerIdCacheAt = Date.now();
  return _providerIdCache;
}
function firstProviderId() {
  return _providerIdCache;
}

function updateMode() {
  const mode = detectMode(inputEl.value);
  modeEl.textContent = mode;
  modeEl.className = `unified-input-mode ${mode}`;
  updateHint(mode);
}

function updateHint(mode) {
  const tid = state.activeTerminalId;
  switch (mode) {
    case 'shell':
      hintEl.textContent = tid ? 'Enter → write to focused terminal' : 'no active terminal';
      break;
    case 'palette':
      hintEl.textContent = 'Enter → open command';
      break;
    case 'nl': {
      const agentId = activeAgentTerminalId();
      if (agentId) hintEl.textContent = 'Enter → send to focused agent';
      else hintEl.textContent = firstProviderId() ? 'Enter → provider' : 'configure a provider';
      break;
    }
    case 'provider':
      hintEl.textContent = 'Enter → provider';
      break;
    default:
      hintEl.textContent = '';
  }
}

function showResponse(text, opts = {}) {
  responseEl.classList.toggle('error', !!opts.error);
  responseEl.innerHTML = `
    <div class="unified-response-head">
      <span>${opts.head ?? 'Response'}</span>
      <button class="unified-response-close" aria-label="Close">
        <span class="material-symbols-outlined" style="font-size:14px;">close</span>
      </button>
    </div>
    <div class="unified-response-body"></div>
  `;
  responseEl.querySelector('.unified-response-body').textContent = text;
  responseEl.classList.add('visible');
  responseEl.querySelector('.unified-response-close').addEventListener('click', hideResponse);
}
function hideResponse() {
  responseEl.classList.remove('visible');
  responseEl.innerHTML = '';
}

async function submit() {
  const raw = inputEl.value;
  if (!raw.trim()) return;
  const mode = detectMode(raw);

  if (mode === 'shell') {
    const cmd = raw.startsWith('$ ') ? raw.slice(2) : raw.slice(1);
    const tid = state.activeTerminalId;
    if (!tid) {
      showResponse('No active terminal.', { error: true, head: 'shell' });
      return;
    }
    try {
      await window.agentDesk?.terminal?.write(tid, cmd + '\r');
      pushHistory(raw);
      inputEl.value = '';
      updateMode();
      hideResponse();
    } catch (err) {
      showResponse(String(err), { error: true, head: 'shell' });
    }
    return;
  }

  if (mode === 'palette') {
    const name = raw.slice(1).trim();
    pushHistory(raw);
    inputEl.value = '';
    updateMode();
    if (typeof window.__openCommandPalette === 'function') {
      window.__openCommandPalette(name);
    } else {
      showResponse(`Command palette integration pending: "${name}"`, { head: 'palette' });
    }
    return;
  }

  // NL / provider mode
  const prompt = raw.trim();
  const agentId = activeAgentTerminalId();
  if (agentId) {
    try {
      await window.agentDesk?.terminal?.write(agentId, prompt + '\r');
      pushHistory(raw);
      inputEl.value = '';
      updateMode();
      hideResponse();
    } catch (err) {
      showResponse(String(err), { error: true, head: 'agent' });
    }
    return;
  }

  // Route to provider
  const pid = await firstProviderIdAsync();
  if (!pid) {
    showResponse(
      'No provider configured. Add one via providers:save (anthropic/openai/ollama) or configure an AGENT_DESK_PROVIDER_<ID> env var.',
      { error: true, head: 'provider' },
    );
    return;
  }
  pushHistory(raw);
  showResponse('…', { head: `provider · ${pid}` });
  try {
    const res = await window.agentDesk?.providers?.complete(pid, prompt, {});
    if (res?.error) showResponse(res.error, { error: true, head: `provider · ${pid}` });
    else showResponse(res?.text ?? '(empty)', { head: `provider · ${pid}` });
    inputEl.value = '';
    updateMode();
  } catch (err) {
    showResponse(String(err), { error: true, head: `provider · ${pid}` });
  }
}

function onKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    submit();
    return;
  }
  if (e.key === 'Escape') {
    if (responseEl.classList.contains('visible')) {
      hideResponse();
      return;
    }
    inputEl.value = '';
    updateMode();
    inputEl.blur();
    return;
  }
  if (e.key === 'ArrowUp') {
    if (history.length === 0) return;
    if (historyCursor === -1) draft = inputEl.value;
    historyCursor = Math.max(0, historyCursor === -1 ? history.length - 1 : historyCursor - 1);
    inputEl.value = history[historyCursor];
    updateMode();
    e.preventDefault();
    return;
  }
  if (e.key === 'ArrowDown') {
    if (historyCursor === -1) return;
    historyCursor += 1;
    if (historyCursor >= history.length) {
      historyCursor = -1;
      inputEl.value = draft;
    } else {
      inputEl.value = history[historyCursor];
    }
    updateMode();
    e.preventDefault();
    return;
  }
}

function mount() {
  const slot = document.getElementById('unified-input-slot');
  if (!slot) return;
  injectStyles();
  rootEl = document.createElement('div');
  rootEl.className = 'unified-input-wrap';
  rootEl.innerHTML = `
    <div class="unified-input-row">
      <span class="unified-input-mode nl">nl</span>
      <input class="unified-input-input" type="text" placeholder="Ask, run, or find — Ctrl+L" spellcheck="false" autocomplete="off" />
      <span class="unified-input-hint"></span>
    </div>
    <div class="unified-input-response"></div>
  `;
  slot.appendChild(rootEl);
  modeEl = rootEl.querySelector('.unified-input-mode');
  inputEl = rootEl.querySelector('.unified-input-input');
  hintEl = rootEl.querySelector('.unified-input-hint');
  responseEl = rootEl.querySelector('.unified-input-response');

  inputEl.addEventListener('input', updateMode);
  inputEl.addEventListener('keydown', onKeydown);
  inputEl.addEventListener('focus', () => {
    firstProviderIdAsync().then(updateMode);
  });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 'l' || e.key === 'L')) {
      const target = e.target;
      if (target === inputEl) return;
      e.preventDefault();
      inputEl.focus();
      inputEl.select();
    }
  });

  firstProviderIdAsync().then(updateMode);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
