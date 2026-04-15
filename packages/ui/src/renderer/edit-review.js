// =============================================================================
// Agent Desk — Diff-first Edit Review (v1.7)
// =============================================================================
// Listens for agent:file-modified events emitted by agent-parser. For each
// modification captures (old=git HEAD, new=working tree) content and ingests
// it as a PendingEdit. A review panel (Ctrl+Shift+R) lists pending edits;
// each opens into a Shiki diff preview with Approve / Reject / Comment.
//
// Approve = no-op (file stays as written). Reject = restore old content via
// file:write. Comments are free-form notes attached to the edit record.
// =============================================================================

'use strict';

import { state } from './state.js';

const DEBOUNCE_MS = 600;

const editsById = new Map();
const recentCapturesByPath = new Map();
let panelEl = null;
let listEl = null;
let detailEl = null;
let emptyEl = null;
let renderQueued = false;
let selectedEditId = null;

function ensurePanel() {
  if (panelEl) return panelEl;
  panelEl = document.createElement('div');
  panelEl.id = 'edit-review-panel';
  panelEl.className = 'edit-review-panel hidden';
  panelEl.innerHTML = `
    <header class="edit-review-header">
      <span class="material-symbols-outlined">rate_review</span>
      <span class="edit-review-title">Pending edits</span>
      <span class="edit-review-count"></span>
      <button class="edit-review-close" title="Close (Ctrl+Shift+R)">
        <span class="material-symbols-outlined">close</span>
      </button>
    </header>
    <div class="edit-review-body">
      <div class="edit-review-list" role="list"></div>
      <div class="edit-review-detail"></div>
      <div class="edit-review-empty">No pending edits. Agent file changes will appear here.</div>
    </div>
  `;
  document.body.appendChild(panelEl);
  listEl = panelEl.querySelector('.edit-review-list');
  detailEl = panelEl.querySelector('.edit-review-detail');
  emptyEl = panelEl.querySelector('.edit-review-empty');
  panelEl.querySelector('.edit-review-close').addEventListener('click', () => togglePanel(false));
  injectStyles();
  return panelEl;
}

function injectStyles() {
  if (document.getElementById('edit-review-styles')) return;
  const s = document.createElement('style');
  s.id = 'edit-review-styles';
  s.textContent = `
.edit-review-panel {
  position: fixed;
  top: 48px; right: 0; bottom: 28px;
  width: 720px;
  background: var(--md-sys-color-surface-container, #1f2329);
  border-left: 1px solid var(--md-sys-color-outline-variant, #333);
  display: flex; flex-direction: column;
  z-index: 900;
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  color: var(--md-sys-color-on-surface, #d0d4da);
  box-shadow: -4px 0 12px rgba(0,0,0,0.25);
}
.edit-review-panel.hidden { display: none; }
.edit-review-header {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--md-sys-color-outline-variant, #333);
  font-weight: 500;
}
.edit-review-title { flex: 1; }
.edit-review-count {
  font-size: 11px; padding: 2px 6px; border-radius: 8px;
  background: var(--md-sys-color-surface-container-highest, #2a2e35);
}
.edit-review-close {
  background: transparent; border: 0; cursor: pointer; color: inherit;
  padding: 4px; border-radius: 4px; display: flex; align-items: center;
}
.edit-review-close:hover { background: var(--md-sys-color-surface-container-high, #2a2e35); }
.edit-review-body { flex: 1; display: grid; grid-template-columns: 240px 1fr; overflow: hidden; position: relative; }
.edit-review-list {
  overflow-y: auto;
  border-right: 1px solid var(--md-sys-color-outline-variant, #333);
  padding: 6px;
  display: flex; flex-direction: column; gap: 4px;
}
.edit-item {
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid transparent;
}
.edit-item:hover { background: var(--md-sys-color-surface-container-high, #24272d); }
.edit-item.selected { background: var(--md-sys-color-surface-container-high, #24272d); border-color: var(--md-sys-color-primary, #6aa7ff); }
.edit-item.status-approved { opacity: 0.55; }
.edit-item.status-rejected { opacity: 0.55; text-decoration: line-through; }
.edit-item-head { display: flex; align-items: center; gap: 6px; }
.edit-item-kind {
  font-family: 'JetBrains Mono', monospace; font-size: 10px;
  padding: 1px 5px; border-radius: 3px;
  background: var(--md-sys-color-surface-container-highest, #2a2e35);
  text-transform: uppercase;
}
.edit-item-file {
  font-family: 'JetBrains Mono', monospace; font-size: 12px;
  flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.edit-item-meta { font-size: 10px; color: var(--md-sys-color-on-surface-variant, #909399); margin-top: 2px; }
.edit-review-detail {
  overflow: auto;
  padding: 12px;
  display: flex; flex-direction: column;
}
.edit-review-detail.empty { display: none; }
.edit-review-empty {
  position: absolute; inset: 0 0 0 240px;
  display: flex; align-items: center; justify-content: center;
  color: var(--md-sys-color-on-surface-variant, #909399); font-style: italic;
}
.edit-review-empty.hidden { display: none; }
.edit-actions { display: flex; gap: 8px; margin-bottom: 10px; }
.edit-actions button {
  padding: 6px 12px; border-radius: 4px; cursor: pointer;
  font-family: 'Inter', sans-serif; font-size: 12px; font-weight: 500;
  border: 1px solid var(--md-sys-color-outline-variant, #333);
  background: var(--md-sys-color-surface-container-high, #2a2e35);
  color: var(--md-sys-color-on-surface, #d0d4da);
}
.edit-actions button:hover { background: var(--md-sys-color-surface-container-highest, #363b42); }
.edit-actions button.approve:hover { background: #2a6f46; border-color: #3ec97a; }
.edit-actions button.reject:hover { background: #6f2a2a; border-color: #e05c5c; }
.edit-actions button:disabled { opacity: 0.5; cursor: not-allowed; }
.edit-diff {
  font-family: 'JetBrains Mono', monospace; font-size: 11px;
  white-space: pre; overflow-x: auto;
  background: var(--md-sys-color-surface, #15181c);
  padding: 8px; border-radius: 4px;
  flex: 1; min-height: 0;
}
.edit-diff .diff-add { background: rgba(62,201,122,0.12); }
.edit-diff .diff-del { background: rgba(224,92,92,0.12); }
.edit-comments { margin-top: 12px; }
.edit-comments h4 { margin: 0 0 6px 0; font-size: 12px; font-weight: 500; }
.edit-comment { font-size: 12px; padding: 6px 8px; background: var(--md-sys-color-surface-container-low, #191c21); border-radius: 4px; margin-bottom: 4px; }
.edit-comment-time { font-size: 10px; color: var(--md-sys-color-on-surface-variant, #909399); }
.edit-comment-form { display: flex; gap: 6px; margin-top: 6px; }
.edit-comment-form input { flex: 1; padding: 6px 8px; border-radius: 4px; border: 1px solid var(--md-sys-color-outline-variant, #333); background: var(--md-sys-color-surface, #15181c); color: inherit; font-family: inherit; }
.edit-comment-form button { padding: 6px 10px; }
.edit-status-banner {
  padding: 6px 10px; border-radius: 4px; margin-bottom: 10px; font-size: 12px;
}
.edit-status-banner.approved { background: rgba(62,201,122,0.12); color: #3ec97a; }
.edit-status-banner.rejected { background: rgba(224,92,92,0.12); color: #e05c5c; }
  `;
  document.head.appendChild(s);
}

function fmtAgoSeconds(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function renderDiffText(oldText, newText) {
  const oldLines = (oldText ?? '').split('\n');
  const newLines = (newText ?? '').split('\n');
  const out = [];
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const a = oldLines[i];
    const b = newLines[i];
    if (a === b) out.push({ kind: 'ctx', text: a ?? '' });
    else {
      if (a !== undefined) out.push({ kind: 'del', text: a });
      if (b !== undefined) out.push({ kind: 'add', text: b });
    }
  }
  return out;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
  const all = [...editsById.values()].sort((a, b) => b.createdAt - a.createdAt);
  const pending = all.filter((e) => e.status === 'pending');
  const countEl = panelEl.querySelector('.edit-review-count');
  countEl.textContent = pending.length ? `${pending.length} pending` : '';

  if (all.length === 0) {
    emptyEl.classList.remove('hidden');
    detailEl.classList.add('empty');
    listEl.innerHTML = '';
    return;
  }
  emptyEl.classList.add('hidden');

  listEl.replaceChildren(...all.map((e) => createItem(e)));
  if (selectedEditId && !editsById.has(selectedEditId)) selectedEditId = null;
  if (!selectedEditId && pending.length) selectedEditId = pending[0].id;
  if (selectedEditId) renderDetail(editsById.get(selectedEditId));
}

function createItem(edit) {
  const d = document.createElement('div');
  d.className = `edit-item status-${edit.status}` + (edit.id === selectedEditId ? ' selected' : '');
  d.setAttribute('role', 'listitem');
  const fileBase = edit.filePath.split(/[\\/]/).pop() || edit.filePath;
  d.innerHTML = `
    <div class="edit-item-head">
      <span class="edit-item-kind">${escapeHtml(edit.kind)}</span>
      <span class="edit-item-file" title="${escapeHtml(edit.filePath)}">${escapeHtml(fileBase)}</span>
    </div>
    <div class="edit-item-meta">${escapeHtml(edit.agentName ?? 'agent')} · ${fmtAgoSeconds(edit.createdAt)}</div>
  `;
  d.addEventListener('click', () => {
    selectedEditId = edit.id;
    render();
  });
  return d;
}

function renderDetail(edit) {
  if (!edit) {
    detailEl.classList.add('empty');
    return;
  }
  detailEl.classList.remove('empty');
  const hunks = renderDiffText(edit.oldContent, edit.newContent);
  const diffHtml = hunks
    .map((h) => {
      const cls = h.kind === 'add' ? 'diff-add' : h.kind === 'del' ? 'diff-del' : '';
      const prefix = h.kind === 'add' ? '+ ' : h.kind === 'del' ? '- ' : '  ';
      return `<div class="${cls}">${escapeHtml(prefix + h.text)}</div>`;
    })
    .join('');
  const statusBanner =
    edit.status === 'approved'
      ? `<div class="edit-status-banner approved">Approved</div>`
      : edit.status === 'rejected'
        ? `<div class="edit-status-banner rejected">Rejected${edit.rejectReason ? `: ${escapeHtml(edit.rejectReason)}` : ''}</div>`
        : '';
  const actionsDisabled = edit.status !== 'pending' ? 'disabled' : '';
  const commentsHtml = edit.comments.length
    ? edit.comments
        .map(
          (c) =>
            `<div class="edit-comment"><div>${escapeHtml(c.body)}</div><div class="edit-comment-time">${fmtAgoSeconds(c.createdAt)}</div></div>`,
        )
        .join('')
    : '<div class="edit-comment-time">No comments yet.</div>';
  detailEl.innerHTML = `
    <div>
      <div style="margin-bottom:6px;font-family:'JetBrains Mono',monospace;font-size:12px;">${escapeHtml(edit.filePath)}</div>
      ${statusBanner}
      <div class="edit-actions">
        <button class="approve" ${actionsDisabled} data-action="approve">
          <span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;">check</span> Approve
        </button>
        <button class="reject" ${actionsDisabled} data-action="reject">
          <span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;">close</span> Reject (revert)
        </button>
      </div>
      <div class="edit-diff">${diffHtml}</div>
      <div class="edit-comments">
        <h4>Comments</h4>
        ${commentsHtml}
        <div class="edit-comment-form">
          <input type="text" placeholder="Add a comment…" />
          <button>Post</button>
        </div>
      </div>
    </div>
  `;
  detailEl.querySelector('[data-action="approve"]')?.addEventListener('click', () => approveEdit(edit.id));
  detailEl.querySelector('[data-action="reject"]')?.addEventListener('click', () => rejectEdit(edit));
  const commentInput = detailEl.querySelector('.edit-comment-form input');
  const commentBtn = detailEl.querySelector('.edit-comment-form button');
  const submitComment = () => {
    const body = commentInput.value.trim();
    if (!body) return;
    postComment(edit.id, body);
    commentInput.value = '';
  };
  commentBtn.addEventListener('click', submitComment);
  commentInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitComment();
    }
  });
}

async function approveEdit(editId) {
  try {
    await window.agentDesk?.edits?.approve(editId);
  } catch (err) {
    console.warn('[edits] approve failed:', err);
  }
}

async function rejectEdit(edit) {
  try {
    if (edit.oldContent !== null && edit.oldContent !== undefined) {
      await window.agentDesk?.file?.write(edit.filePath, edit.oldContent);
    }
    await window.agentDesk?.edits?.reject(edit.id, 'user reverted');
  } catch (err) {
    console.warn('[edits] reject failed:', err);
  }
}

async function postComment(editId, body) {
  try {
    await window.agentDesk?.edits?.comment(editId, body);
  } catch (err) {
    console.warn('[edits] comment failed:', err);
  }
}

export function togglePanel(force) {
  ensurePanel();
  const show = typeof force === 'boolean' ? force : panelEl.classList.contains('hidden');
  panelEl.classList.toggle('hidden', !show);
  if (show) {
    hydrate();
    render();
  }
}

async function hydrate() {
  if (!window.agentDesk?.edits) return;
  try {
    const all = await window.agentDesk.edits.list({});
    for (const e of all) editsById.set(e.id, e);
  } catch {
    /* ignore */
  }
}

function onEditUpdate(edit) {
  editsById.set(edit.id, edit);
  queueRender();
}

// -----------------------------------------------------------------------------
// Capture: observe agent-parser file-modified events, ingest as PendingEdit
// -----------------------------------------------------------------------------

function kindFromTool(tool) {
  if (tool === 'Write') return 'write';
  if (tool === 'Edit') return 'edit';
  if (tool === 'MultiEdit') return 'multi';
  return 'edit';
}

async function resolveTerminalCwd(terminalId) {
  try {
    const list = await window.agentDesk?.terminal?.list();
    return list?.find((t) => t.id === terminalId)?.cwd ?? null;
  } catch {
    return null;
  }
}

async function readHead(cwd, absPath) {
  if (!cwd || !absPath) return null;
  try {
    const rel = absPath.startsWith(cwd) ? absPath.slice(cwd.length).replace(/^[\\/]/, '') : absPath;
    const content = await window.agentDesk?.git?.file(cwd, rel, 'HEAD');
    return typeof content === 'string' ? content : null;
  } catch {
    return null;
  }
}

async function readWorkingCopy(absPath) {
  try {
    const res = await window.agentDesk?.file?.read(absPath);
    return res?.ok ? (res.content ?? '') : null;
  } catch {
    return null;
  }
}

function toAbsolute(cwd, file) {
  if (!file) return null;
  if (/^([a-zA-Z]:[\\/]|\/)/.test(file)) return file;
  if (!cwd) return null;
  const sep = cwd.includes('\\') ? '\\' : '/';
  return `${cwd.replace(/[\\/]$/, '')}${sep}${file}`;
}

async function captureEdit({ terminalId, file, tool }) {
  const key = `${terminalId}|${file}`;
  const last = recentCapturesByPath.get(key) ?? 0;
  const now = Date.now();
  if (now - last < DEBOUNCE_MS) return;
  recentCapturesByPath.set(key, now);

  if (!window.agentDesk?.edits?.ingest) return;
  const cwd = await resolveTerminalCwd(terminalId);
  const abs = toAbsolute(cwd, file);
  if (!abs) return;

  const [oldContent, newContent] = await Promise.all([readHead(cwd, abs), readWorkingCopy(abs)]);
  if (newContent === null) return;

  try {
    const info = state.terminals?.get?.(terminalId);
    const agentName = info?.agentName ?? null;
    await window.agentDesk.edits.ingest({
      terminalId,
      agentName,
      kind: kindFromTool(tool),
      filePath: abs,
      oldContent: oldContent ?? null,
      newContent,
    });
  } catch (err) {
    console.warn('[edits] ingest failed:', err);
  }
}

function setup() {
  if (!window.agentDesk?.edits) {
    console.warn('[edits] agentDesk.edits unavailable — skipping');
    return;
  }
  ensurePanel();

  window.agentDesk.edits.onUpdate(onEditUpdate);

  const bus = typeof eventBus !== 'undefined' ? eventBus : null;
  if (bus && typeof bus.on === 'function') {
    bus.on('agent:file-modified', (ev) => {
      const d = ev?.data ?? ev;
      if (!d || !d.terminalId || !d.file) return;
      if (d.tool === 'detected') return;
      captureEdit(d);
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && !e.altKey && (e.key === 'R' || e.key === 'r')) {
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
