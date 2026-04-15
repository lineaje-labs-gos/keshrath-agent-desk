import { describe, it, expect, beforeEach } from 'vitest';
import { PendingEditsStore } from '../../packages/core/src/pending-edits-store.js';

describe('PendingEditsStore', () => {
  let store: PendingEditsStore;

  beforeEach(() => {
    store = new PendingEditsStore();
  });

  function sample(overrides: Partial<Parameters<PendingEditsStore['ingest']>[0]> = {}) {
    return store.ingest({
      terminalId: 't1',
      agentName: 'claude',
      kind: 'edit',
      filePath: '/p/a.ts',
      oldContent: 'a',
      newContent: 'b',
      ...overrides,
    });
  }

  it('ingest assigns an id and pending status', () => {
    const e = sample();
    expect(e.id).toBeTruthy();
    expect(e.status).toBe('pending');
    expect(e.decidedAt).toBeNull();
    expect(e.comments).toEqual([]);
  });

  it('list filters by terminal and status', () => {
    sample({ terminalId: 't1' });
    sample({ terminalId: 't2' });
    const approved = sample({ terminalId: 't1' });
    store.approve(approved.id);
    expect(store.list({ terminalId: 't1' })).toHaveLength(2);
    expect(store.list({ terminalId: 't2' })).toHaveLength(1);
    expect(store.list({ status: 'pending' })).toHaveLength(2);
    expect(store.list({ status: 'approved' })).toHaveLength(1);
  });

  it('approve transitions pending → approved once', () => {
    const e = sample();
    expect(store.approve(e.id).ok).toBe(true);
    expect(store.get(e.id)!.status).toBe('approved');
    expect(store.approve(e.id).ok).toBe(false);
  });

  it('reject transitions with optional reason', () => {
    const e = sample();
    const res = store.reject(e.id, 'wrong approach');
    expect(res.ok).toBe(true);
    expect(store.get(e.id)!.rejectReason).toBe('wrong approach');
  });

  it('comment appends threaded notes', () => {
    const e = sample();
    const c = store.comment(e.id, 'hmm', 2);
    expect(c).not.toBeNull();
    expect(c!.hunkIndex).toBe(2);
    expect(store.get(e.id)!.comments).toHaveLength(1);
  });

  it('subscribe fires on ingest and state transitions', () => {
    const events: string[] = [];
    store.subscribe((edit) => events.push(edit.status));
    const e = sample();
    store.approve(e.id);
    expect(events).toEqual(['pending', 'approved']);
  });
});
