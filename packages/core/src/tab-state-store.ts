// Tab state store — 5-state machine for terminal tabs (v1.7).
//
// States: idle / running / awaiting-input / edits-pending / errored
//
// Transitions are driven by three upstream signals:
//   1. terminal lifecycle (terminal:exit → idle or errored)
//   2. agent-parser events from the renderer (running, awaiting-input)
//   3. pending-edits store (edits-pending supersedes running when any
//      pending edits exist for the terminal)
//
// The store keeps a map terminalId → TabState and emits update events.
// The renderer consumes 'tabs:update' push events to repaint tab chrome.

import type { TabState } from './transport/channels.js';

type TabListener = (terminalId: string, state: TabState) => void;

export class TabStateStore {
  private states = new Map<string, TabState>();
  private listeners = new Set<TabListener>();

  subscribe(fn: TabListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(terminalId: string, state: TabState): void {
    for (const l of this.listeners) {
      try {
        l(terminalId, state);
      } catch {
        // never break the store on listener failure
      }
    }
  }

  set(terminalId: string, state: TabState): void {
    const prev = this.states.get(terminalId);
    if (prev === state) return;
    this.states.set(terminalId, state);
    this.emit(terminalId, state);
  }

  get(terminalId: string): TabState {
    return this.states.get(terminalId) ?? 'idle';
  }

  all(): Record<string, TabState> {
    const out: Record<string, TabState> = {};
    for (const [id, s] of this.states) out[id] = s;
    return out;
  }

  clear(terminalId: string): void {
    if (this.states.delete(terminalId)) this.emit(terminalId, 'idle');
  }
}

export const tabStateStore = new TabStateStore();
