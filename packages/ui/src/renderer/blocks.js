// =============================================================================
// Agent Desk — Blocks (v1.7)
// =============================================================================
// Warp-inspired structured terminal output. Each shell-integration boundary
// (OSC 133) produces a block card showing the command, elapsed time, exit
// code, and collapsible output. Ctrl+B toggles the blocks panel; it filters
// to the active terminal.
// =============================================================================

'use strict';

import { state } from './state.js';

const MAX_CARDS = 200;

let panelEl = null;
let listEl = null;
let emptyEl = null;
let headerTitleEl = null;
let filterTerminalId = null;

const blocksByTerminal = new Map();
const cardElsByBlock = new Map();
let renderQueued = false;

function ensurePanel() {
  if (panelEl) return panelEl;
  panelEl = document.createElement('div');
  panelEl.id = 'blocks-panel';
  panelEl.className = 'blocks-panel hidden';
  panelEl.innerHTML = `
    <header class="blocks-panel-header">
      <span class="material-symbols-outlined blocks-panel-icon">view_agenda</span>
      <span class="blocks-panel-title">Blocks</span>
      <button class="blocks-panel-clear" title="Clear blocks for this terminal">
        <span class="material-symbols-outlined">delete_sweep</span>
      </button>
      <button class="blocks-panel-close" title="Close (Ctrl+B)">
        <span class="material-symbols-outlined">close</span>
      </button>
    </header>
    <div class="blocks-panel-empty">No blocks yet. Run a command with shell integration enabled.</div>
    <div class="blocks-panel-list" role="list"></div>
  `;
  document.body.appendChild(panelEl);
  headerTitleEl = panelEl.querySelector('.blocks-panel-title');
  emptyEl = panelEl.querySelector('.blocks-panel-empty');
  listEl = panelEl.querySelector('.blocks-panel-list');
  panelEl.querySelector('.blocks-panel-close').addEventListener('click', () => togglePanel(false));
  panelEl.querySelector('.blocks-panel-clear').addEventListener('click', clearActive);
  injectStyles();
  return panelEl;
}

function injectStyles() {
  if (document.getElementById('blocks-panel-styles')) return;
  const s = document.createElement('style');
  s.id = 'blocks-panel-styles';
  s.textContent = `
.blocks-panel {
  position: fixed;
  top: 48px;
  right: 0;
  width: 420px;
  bottom: 28px;
  background: var(--md-sys-color-surface-container, #1f2329);
  border-left: 1px solid var(--md-sys-color-outline-variant, #333);
  display: flex;
  flex-direction: column;
  z-index: 900;
  box-shadow: -4px 0 12px rgba(0,0,0,0.25);
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  color: var(--md-sys-color-on-surface, #d0d4da);
}
.blocks-panel.hidden { display: none; }
.blocks-panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant, #333);
  font-weight: 500;
}
.blocks-panel-icon { font-size: 18px; opacity: 0.8; }
.blocks-panel-title { flex: 1; }
.blocks-panel-clear,
.blocks-panel-close {
  background: transparent;
  border: 0;
  cursor: pointer;
  color: inherit;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
}
.blocks-panel-clear:hover,
.blocks-panel-close:hover { background: var(--md-sys-color-surface-container-high, #2a2e35); }
.blocks-panel-empty {
  padding: 24px 16px;
  color: var(--md-sys-color-on-surface-variant, #909399);
  font-style: italic;
  text-align: center;
}
.blocks-panel-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.block-card {
  background: var(--md-sys-color-surface-container-low, #191c21);
  border: 1px solid var(--md-sys-color-outline-variant, #2a2e35);
  border-radius: 6px;
  overflow: hidden;
}
.block-card.exit-ok { border-left: 3px solid #3ec97a; }
.block-card.exit-err { border-left: 3px solid #e05c5c; }
.block-card.exit-pending { border-left: 3px solid #6aa7ff; }
.block-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  cursor: pointer;
  user-select: none;
}
.block-head:hover { background: var(--md-sys-color-surface-container-high, #24272d); }
.block-cmd {
  flex: 1;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.block-cmd.empty { color: var(--md-sys-color-on-surface-variant, #909399); font-style: italic; }
.block-chip {
  font-size: 11px;
  font-family: 'JetBrains Mono', monospace;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--md-sys-color-surface-container-highest, #2a2e35);
}
.block-chip.exit-ok { color: #3ec97a; }
.block-chip.exit-err { color: #e05c5c; }
.block-chip.exit-pending { color: #6aa7ff; }
.block-rerun {
  background: transparent;
  border: 0;
  cursor: pointer;
  color: var(--md-sys-color-on-surface-variant, #909399);
  padding: 2px;
  border-radius: 4px;
  display: flex;
  align-items: center;
}
.block-rerun:hover { background: var(--md-sys-color-surface-container-high, #2a2e35); color: var(--md-sys-color-on-surface, #d0d4da); }
.block-body {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.15s ease;
}
.block-card.open .block-body { max-height: 320px; overflow-y: auto; }
.block-body pre {
  margin: 0;
  padding: 8px 10px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  white-space: pre-wrap;
  color: var(--md-sys-color-on-surface-variant, #b0b4ba);
  background: var(--md-sys-color-surface, #15181c);
}
  `;
  document.head.appendChild(s);
}

function stripAnsiLocal(s) {
  if (!s) return '';
  return s
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

function fmtElapsed(block) {
  const end = block.endedAt ?? Date.now();
  const ms = Math.max(0, end - block.startedAt);
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m${Math.floor(s % 60)}s`;
}

function exitClass(block) {
  if (block.exitCode === null || block.exitCode === undefined) return 'exit-pending';
  return block.exitCode === 0 ? 'exit-ok' : 'exit-err';
}

function upsertBlock(block) {
  let list = blocksByTerminal.get(block.terminalId);
  if (!list) {
    list = [];
    blocksByTerminal.set(block.terminalId, list);
  }
  const idx = list.findIndex((b) => b.id === block.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...block };
  else {
    list.push(block);
    if (list.length > MAX_CARDS) list.shift();
  }
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    if (!panelEl || panelEl.classList.contains('hidden')) return;
    render();
  });
}

function render() {
  if (!listEl) return;
  const tid = filterTerminalId;
  headerTitleEl.textContent = tid ? `Blocks · ${shortId(tid)}` : 'Blocks';
  const all = tid ? (blocksByTerminal.get(tid) ?? []) : collectAll();
  if (all.length === 0) {
    emptyEl.style.display = '';
    listEl.innerHTML = '';
    cardElsByBlock.clear();
    return;
  }
  emptyEl.style.display = 'none';

  const seen = new Set();
  const frag = document.createDocumentFragment();
  for (const b of all) {
    seen.add(b.id);
    let card = cardElsByBlock.get(b.id);
    if (!card) {
      card = createCard(b);
      cardElsByBlock.set(b.id, card);
    } else {
      updateCard(card, b);
    }
    frag.appendChild(card);
  }
  listEl.replaceChildren(frag);
  for (const id of [...cardElsByBlock.keys()]) {
    if (!seen.has(id)) cardElsByBlock.delete(id);
  }
}

function collectAll() {
  const out = [];
  for (const list of blocksByTerminal.values()) out.push(...list);
  out.sort((a, b) => a.startedAt - b.startedAt);
  return out.slice(-MAX_CARDS);
}

function shortId(id) {
  return id.slice(0, 6);
}

function createCard(block) {
  const card = document.createElement('div');
  card.className = `block-card ${exitClass(block)}`;
  card.dataset.blockId = block.id;
  card.innerHTML = `
    <div class="block-head">
      <span class="block-cmd"></span>
      <span class="block-chip"></span>
      <button class="block-rerun" title="Rerun block">
        <span class="material-symbols-outlined" style="font-size:16px;">replay</span>
      </button>
    </div>
    <div class="block-body"><pre></pre></div>
  `;
  const head = card.querySelector('.block-head');
  head.addEventListener('click', (e) => {
    if (e.target.closest('.block-rerun')) return;
    card.classList.toggle('open');
  });
  card.querySelector('.block-rerun').addEventListener('click', (e) => {
    e.stopPropagation();
    rerunBlock(block.id);
  });
  updateCard(card, block);
  return card;
}

function updateCard(card, block) {
  card.className = `block-card ${exitClass(block)}${card.classList.contains('open') ? ' open' : ''}`;
  const cmdEl = card.querySelector('.block-cmd');
  const chipEl = card.querySelector('.block-chip');
  const preEl = card.querySelector('.block-body pre');
  const cmdText = block.command && block.command.trim() ? block.command.trim() : '(stream)';
  cmdEl.textContent = cmdText;
  cmdEl.classList.toggle('empty', !block.command || !block.command.trim());
  const exitLabel =
    block.exitCode === null || block.exitCode === undefined
      ? '…'
      : block.exitCode === 0
        ? `✓ ${fmtElapsed(block)}`
        : `✗${block.exitCode} ${fmtElapsed(block)}`;
  chipEl.textContent = exitLabel;
  chipEl.className = `block-chip ${exitClass(block)}`;
  preEl.textContent = stripAnsiLocal(block.output || '').slice(-4000);
}

async function rerunBlock(blockId) {
  try {
    const res = await window.agentDesk?.blocks?.rerun(blockId);
    if (!res?.ok) {
      console.warn('[blocks] rerun failed:', res?.error);
    }
  } catch (err) {
    console.warn('[blocks] rerun error:', err);
  }
}

async function clearActive() {
  const tid = filterTerminalId;
  if (!tid) return;
  try {
    await window.agentDesk?.blocks?.clear(tid);
  } catch {
    /* ignore */
  }
  blocksByTerminal.delete(tid);
  queueRender();
}

export function togglePanel(force) {
  ensurePanel();
  const show = typeof force === 'boolean' ? force : panelEl.classList.contains('hidden');
  panelEl.classList.toggle('hidden', !show);
  if (show) {
    filterTerminalId = state.activeTerminalId ?? null;
    hydrateActive();
    render();
  }
}

async function hydrateActive() {
  if (!window.agentDesk?.blocks) return;
  const tid = filterTerminalId;
  try {
    const existing = await window.agentDesk.blocks.list(tid, 500);
    if (tid) {
      blocksByTerminal.set(tid, existing);
    } else {
      blocksByTerminal.clear();
      for (const b of existing) upsertBlock(b);
    }
  } catch {
    /* ignore */
  }
  render();
}

function onBlockNew(block) {
  upsertBlock(block);
  queueRender();
}

function onBlockUpdate(blockId, patch) {
  for (const list of blocksByTerminal.values()) {
    const i = list.findIndex((b) => b.id === blockId);
    if (i >= 0) {
      list[i] = { ...list[i], ...patch };
      queueRender();
      return;
    }
  }
}

function setup() {
  if (!window.agentDesk?.blocks) {
    console.warn('[blocks] agentDesk.blocks unavailable — skipping');
    return;
  }
  ensurePanel();
  window.agentDesk.blocks.onNew(onBlockNew);
  window.agentDesk.blocks.onUpdate(onBlockUpdate);

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 'b' || e.key === 'B')) {
      const target = e.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      togglePanel();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setup);
} else {
  setup();
}
