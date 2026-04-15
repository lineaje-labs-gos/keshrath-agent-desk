// =============================================================================
// Agent Desk — Skills & Rules Panel (v1.7)
// =============================================================================
// Ctrl+8 view. Lists .claude/skills, .claude/hooks, .mcp.json, and CLAUDE.md
// for the active workspace's rootPath. Files open in a split editor; save
// writes through the path-contained `workspace:configWrite` channel. "Open
// externally" hands off to the detected external editor via editor.open.
// =============================================================================

'use strict';

import { state, registry } from './state.js';

const KIND_LABELS = {
  skill: 'Skill',
  hook: 'Hook',
  mcp: 'MCP',
  'claude-md': 'CLAUDE.md',
};

const KIND_ICONS = {
  skill: 'auto_awesome',
  hook: 'webhook',
  mcp: 'hub',
  'claude-md': 'description',
};

let mounted = null;
let rootEl = null;
let sidebarEl = null;
let editorEl = null;
let titleEl = null;
let saveBtn = null;
let externalBtn = null;
let emptyEl = null;
let currentFiles = [];
let selected = null;
let draftContent = null;

function currentWorkspaceId() {
  return state.currentWorkspaceId ?? state.activeWorkspaceId ?? null;
}

async function resolveWorkspaceId() {
  let id = currentWorkspaceId();
  if (id) return id;
  try {
    const list = await window.agentDesk?.workspace?.recent?.(1);
    if (list && list.length) return list[0].id;
  } catch {
    /* ignore */
  }
  try {
    const list = await window.agentDesk?.workspace?.list?.();
    if (list && list.length) return list[0].id;
  } catch {
    /* ignore */
  }
  return null;
}

function injectStyles() {
  if (document.getElementById('workspace-config-styles')) return;
  const s = document.createElement('style');
  s.id = 'workspace-config-styles';
  s.textContent = `
.ws-config-root {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 0;
  height: 100%;
  background: var(--md-sys-color-surface, #15181c);
  color: var(--md-sys-color-on-surface, #d0d4da);
}
.ws-config-sidebar {
  border-right: 1px solid var(--md-sys-color-outline-variant, #333);
  overflow-y: auto;
  padding: 8px;
  display: flex; flex-direction: column; gap: 10px;
}
.ws-config-sidebar h3 {
  font-size: 11px;
  margin: 8px 8px 4px;
  text-transform: uppercase;
  color: var(--md-sys-color-on-surface-variant, #909399);
  letter-spacing: 0.5px;
  font-weight: 600;
}
.ws-config-empty {
  padding: 24px 16px;
  color: var(--md-sys-color-on-surface-variant, #909399);
  font-style: italic;
  text-align: center;
}
.ws-config-file {
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
  display: flex; align-items: center; gap: 8px;
  font-size: 12px;
}
.ws-config-file:hover { background: var(--md-sys-color-surface-container-high, #24272d); }
.ws-config-file.selected { background: var(--md-sys-color-surface-container-highest, #2a2e35); }
.ws-config-file .material-symbols-outlined { font-size: 16px; opacity: 0.8; }
.ws-config-file-path {
  flex: 1;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ws-config-editor {
  display: flex; flex-direction: column; min-width: 0; min-height: 0;
}
.ws-config-editor-head {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant, #333);
}
.ws-config-title {
  flex: 1;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ws-config-btn {
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 500;
  border: 1px solid var(--md-sys-color-outline-variant, #333);
  background: var(--md-sys-color-surface-container-high, #2a2e35);
  color: inherit;
}
.ws-config-btn:hover { background: var(--md-sys-color-surface-container-highest, #363b42); }
.ws-config-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.ws-config-btn.primary { background: var(--md-sys-color-primary, #6aa7ff); color: #0a1020; border-color: transparent; }
.ws-config-btn.primary:hover { background: var(--md-sys-color-primary, #8ac0ff); }
.ws-config-editor-area {
  flex: 1; min-height: 0;
  display: flex;
}
.ws-config-textarea {
  flex: 1;
  background: var(--md-sys-color-surface, #15181c);
  color: inherit;
  border: 0;
  outline: 0;
  resize: none;
  padding: 12px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  line-height: 1.5;
}
.ws-config-textarea::placeholder { color: var(--md-sys-color-on-surface-variant, #909399); }
.ws-config-placeholder {
  flex: 1;
  display: flex; align-items: center; justify-content: center;
  color: var(--md-sys-color-on-surface-variant, #909399);
  font-style: italic;
}
  `;
  document.head.appendChild(s);
}

function renderSidebar() {
  sidebarEl.innerHTML = '';
  if (!currentFiles.length) {
    const e = document.createElement('div');
    e.className = 'ws-config-empty';
    e.textContent = 'No skills, hooks, or CLAUDE.md found under this workspace.';
    sidebarEl.appendChild(e);
    return;
  }

  const byKind = new Map();
  for (const f of currentFiles) {
    if (!byKind.has(f.kind)) byKind.set(f.kind, []);
    byKind.get(f.kind).push(f);
  }
  const order = ['claude-md', 'mcp', 'skill', 'hook'];
  for (const kind of order) {
    const list = byKind.get(kind);
    if (!list) continue;
    const h = document.createElement('h3');
    h.textContent = KIND_LABELS[kind];
    sidebarEl.appendChild(h);
    for (const f of list) {
      const row = document.createElement('div');
      row.className = 'ws-config-file';
      if (selected && selected.relativePath === f.relativePath) row.classList.add('selected');
      row.innerHTML = `
        <span class="material-symbols-outlined">${KIND_ICONS[kind] ?? 'description'}</span>
        <span class="ws-config-file-path" title="${escapeAttr(f.relativePath)}">${escapeHtml(fileLabel(f))}</span>
      `;
      row.addEventListener('click', () => openFile(f));
      sidebarEl.appendChild(row);
    }
  }
}

function fileLabel(f) {
  if (f.kind === 'claude-md') return 'CLAUDE.md';
  if (f.kind === 'mcp') return '.mcp.json';
  const parts = f.relativePath.split(/[\\/]/);
  return parts[parts.length - 1];
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return String(s ?? '').replace(/"/g, '&quot;');
}

async function openFile(f) {
  selected = f;
  draftContent = null;
  renderSidebar();
  titleEl.textContent = f.relativePath;
  editorEl.innerHTML = '<div class="ws-config-placeholder">Loading…</div>';
  saveBtn.disabled = true;
  externalBtn.disabled = true;
  try {
    const id = await resolveWorkspaceId();
    if (!id) {
      editorEl.innerHTML = '<div class="ws-config-placeholder">No workspace open.</div>';
      return;
    }
    const content = await window.agentDesk?.workspaceConfig?.read(id, f.relativePath);
    renderEditor(content ?? '');
  } catch (err) {
    editorEl.innerHTML = `<div class="ws-config-placeholder">Load failed: ${escapeHtml(String(err))}</div>`;
  }
}

function renderEditor(content) {
  editorEl.innerHTML = '';
  const ta = document.createElement('textarea');
  ta.className = 'ws-config-textarea';
  ta.spellcheck = false;
  ta.value = content;
  draftContent = content;
  ta.addEventListener('input', () => {
    draftContent = ta.value;
    saveBtn.disabled = ta.value === content;
  });
  ta.addEventListener('keydown', (e) => {
    if (e.ctrlKey && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      saveSelected();
    }
  });
  editorEl.appendChild(ta);
  saveBtn.disabled = true;
  externalBtn.disabled = false;
}

async function saveSelected() {
  if (!selected || draftContent === null) return;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';
  try {
    const id = await resolveWorkspaceId();
    if (!id) throw new Error('no workspace');
    const res = await window.agentDesk?.workspaceConfig?.write(id, selected.relativePath, draftContent);
    if (!res?.ok) throw new Error(res?.error ?? 'write failed');
    saveBtn.textContent = 'Saved ✓';
    setTimeout(() => {
      saveBtn.textContent = 'Save';
    }, 1200);
  } catch (err) {
    saveBtn.textContent = 'Save';
    saveBtn.disabled = false;
    console.warn('[ws-config] save failed:', err);
  }
}

async function openExternally() {
  if (!selected) return;
  try {
    const editors = await window.agentDesk?.editor?.detect();
    if (!editors || editors.length === 0) return;
    await window.agentDesk?.editor?.open(editors[0].id, selected.absolutePath);
  } catch (err) {
    console.warn('[ws-config] open externally failed:', err);
  }
}

async function refresh() {
  const id = await resolveWorkspaceId();
  if (!id) {
    currentFiles = [];
    renderSidebar();
    if (selected) {
      selected = null;
      titleEl.textContent = '';
      editorEl.innerHTML = '<div class="ws-config-placeholder">No workspace open.</div>';
      saveBtn.disabled = true;
      externalBtn.disabled = true;
    }
    return;
  }
  try {
    const files = await window.agentDesk?.workspaceConfig?.files(id);
    currentFiles = files ?? [];
  } catch (err) {
    currentFiles = [];
    console.warn('[ws-config] list failed:', err);
  }
  if (selected) {
    const stillThere = currentFiles.find((f) => f.relativePath === selected.relativePath);
    if (!stillThere) {
      selected = null;
      titleEl.textContent = '';
      editorEl.innerHTML = '<div class="ws-config-placeholder">Select a file.</div>';
      saveBtn.disabled = true;
      externalBtn.disabled = true;
    }
  }
  renderSidebar();
}

function build(container) {
  injectStyles();
  container.innerHTML = '';
  rootEl = document.createElement('div');
  rootEl.className = 'ws-config-root';
  rootEl.innerHTML = `
    <aside class="ws-config-sidebar"></aside>
    <div class="ws-config-editor">
      <div class="ws-config-editor-head">
        <span class="ws-config-title"></span>
        <button class="ws-config-btn" data-act="external" disabled>
          <span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;">open_in_new</span>
          Open externally
        </button>
        <button class="ws-config-btn primary" data-act="save" disabled>Save</button>
      </div>
      <div class="ws-config-editor-area">
        <div class="ws-config-placeholder">Select a file.</div>
      </div>
    </div>
  `;
  sidebarEl = rootEl.querySelector('.ws-config-sidebar');
  editorEl = rootEl.querySelector('.ws-config-editor-area');
  titleEl = rootEl.querySelector('.ws-config-title');
  saveBtn = rootEl.querySelector('[data-act="save"]');
  externalBtn = rootEl.querySelector('[data-act="external"]');
  emptyEl = rootEl.querySelector('.ws-config-empty');
  void emptyEl;

  saveBtn.addEventListener('click', saveSelected);
  externalBtn.addEventListener('click', openExternally);
  container.appendChild(rootEl);
}

export async function mountWorkspaceConfig(container) {
  if (!container) return;
  if (!mounted || mounted !== container) {
    build(container);
    mounted = container;
  }
  await refresh();
}

registry.mountWorkspaceConfig = mountWorkspaceConfig;

// Ctrl+8 toggles the view.
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === '8') {
    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    if (typeof registry.switchView === 'function') {
      registry.switchView('config');
    }
  }
});
