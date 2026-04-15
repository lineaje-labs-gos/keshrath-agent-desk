// Pending edits store — captures agent tool calls (Edit / Write / MultiEdit /
// Create) as reviewable edit records. The review panel in the renderer reads
// these via edits:list and drives approve/reject/comment.
//
// This is the v1.7-base skeleton: data model + in-memory store + subscription
// wiring. The ingestion path (terminal data → JSON-RPC tool-call sniffing →
// old/new content resolution) lives in the edits-feature subagent worktree.

import { randomUUID } from 'node:crypto';
import type { PendingEdit, PendingEditComment, PendingEditKind, PendingEditStatus } from './transport/channels.js';

type EditListener = (edit: PendingEdit) => void;

export interface EditIngest {
  terminalId: string;
  agentName: string | null;
  kind: PendingEditKind;
  filePath: string;
  oldContent: string | null;
  newContent: string;
}

export class PendingEditsStore {
  private edits = new Map<string, PendingEdit>();
  private listeners = new Set<EditListener>();

  subscribe(fn: EditListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(edit: PendingEdit): void {
    for (const l of this.listeners) {
      try {
        l(edit);
      } catch {
        // never break the store on listener failure
      }
    }
  }

  ingest(input: EditIngest): PendingEdit {
    const edit: PendingEdit = {
      id: randomUUID(),
      terminalId: input.terminalId,
      agentName: input.agentName,
      kind: input.kind,
      filePath: input.filePath,
      oldContent: input.oldContent,
      newContent: input.newContent,
      createdAt: Date.now(),
      decidedAt: null,
      status: 'pending',
      comments: [],
      rejectReason: null,
    };
    this.edits.set(edit.id, edit);
    this.emit(edit);
    return edit;
  }

  list(opts: { terminalId?: string; status?: PendingEditStatus } = {}): PendingEdit[] {
    const out: PendingEdit[] = [];
    for (const e of this.edits.values()) {
      if (opts.terminalId && e.terminalId !== opts.terminalId) continue;
      if (opts.status && e.status !== opts.status) continue;
      out.push(e);
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): PendingEdit | null {
    return this.edits.get(id) ?? null;
  }

  approve(id: string): { ok: boolean; error?: string } {
    const e = this.edits.get(id);
    if (!e) return { ok: false, error: 'not found' };
    if (e.status !== 'pending') return { ok: false, error: `already ${e.status}` };
    e.status = 'approved';
    e.decidedAt = Date.now();
    this.emit(e);
    return { ok: true };
  }

  reject(id: string, reason?: string): { ok: boolean; error?: string } {
    const e = this.edits.get(id);
    if (!e) return { ok: false, error: 'not found' };
    if (e.status !== 'pending') return { ok: false, error: `already ${e.status}` };
    e.status = 'rejected';
    e.decidedAt = Date.now();
    e.rejectReason = reason ?? null;
    this.emit(e);
    return { ok: true };
  }

  comment(id: string, body: string, hunkIndex: number | null = null): PendingEditComment | null {
    const e = this.edits.get(id);
    if (!e) return null;
    const c: PendingEditComment = {
      id: randomUUID(),
      hunkIndex,
      body,
      createdAt: Date.now(),
    };
    e.comments.push(c);
    this.emit(e);
    return c;
  }

  /** Test hook — drop everything. Not exposed on the channel. */
  _reset(): void {
    this.edits.clear();
  }
}

export const pendingEditsStore = new PendingEditsStore();
