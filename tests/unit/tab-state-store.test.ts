import { describe, it, expect, beforeEach } from 'vitest';
import { TabStateStore } from '../../packages/core/src/tab-state-store.js';

describe('TabStateStore', () => {
  let store: TabStateStore;

  beforeEach(() => {
    store = new TabStateStore();
  });

  it('defaults to idle for unknown terminals', () => {
    expect(store.get('t1')).toBe('idle');
  });

  it('emits on transition but not on no-op set', () => {
    const events: Array<[string, string]> = [];
    store.subscribe((id, s) => events.push([id, s]));
    store.set('t1', 'running');
    store.set('t1', 'running');
    store.set('t1', 'edits-pending');
    expect(events).toEqual([
      ['t1', 'running'],
      ['t1', 'edits-pending'],
    ]);
  });

  it('all() returns a snapshot of all known terminals', () => {
    store.set('t1', 'running');
    store.set('t2', 'errored');
    expect(store.all()).toEqual({ t1: 'running', t2: 'errored' });
  });

  it('clear() reverts to idle and notifies', () => {
    const events: Array<[string, string]> = [];
    store.set('t1', 'edits-pending');
    store.subscribe((id, s) => events.push([id, s]));
    store.clear('t1');
    expect(store.get('t1')).toBe('idle');
    expect(events).toEqual([['t1', 'idle']]);
  });
});
