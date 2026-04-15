// Tab modality wiring (v1.7). Drives tabStateStore from two authoritative
// sources and bridges its emissions to a host-provided emit fn.
//
// Signals:
//   TerminalManager.onExit(code) → state: idle (code==0) | errored (non-zero)
//   pendingEditsStore: any pending edits for a terminal → state: edits-pending
//   pendingEditsStore: last pending edit cleared → state: running (or idle if exited)
//
// Client-side 'awaiting-input' detection stays in the renderer (agent-parser
// sees prompt markers we don't have access to server-side).

import { TerminalManager } from './terminal-manager.js';
import { pendingEditsStore } from './pending-edits-store.js';
import { tabStateStore } from './tab-state-store.js';
import type { PushChannel, PushChannelMap, TabState } from './transport/channels.js';

export interface WireTabsOptions {
  terminals: TerminalManager;
  emit: <K extends PushChannel>(channel: K, ...args: PushChannelMap[K]) => void;
}

export function wireTabs(opts: WireTabsOptions): () => void {
  const { terminals, emit } = opts;
  const exitedByTerminal = new Map<string, number>();
  const unsubs: Array<() => void> = [];

  function hasPendingEdits(terminalId: string): boolean {
    return pendingEditsStore.list({ terminalId, status: 'pending' }).length > 0;
  }

  function resolveState(terminalId: string): TabState {
    if (hasPendingEdits(terminalId)) return 'edits-pending';
    if (exitedByTerminal.has(terminalId)) {
      const code = exitedByTerminal.get(terminalId) ?? 0;
      return code === 0 ? 'idle' : 'errored';
    }
    return 'running';
  }

  function recompute(terminalId: string): void {
    tabStateStore.set(terminalId, resolveState(terminalId));
  }

  unsubs.push(
    terminals.onData((terminalId) => {
      if (exitedByTerminal.has(terminalId)) exitedByTerminal.delete(terminalId);
      if (tabStateStore.get(terminalId) === 'idle' || tabStateStore.get(terminalId) === 'errored') {
        recompute(terminalId);
      }
    }),
  );

  unsubs.push(
    terminals.onExit((terminalId, exitCode) => {
      exitedByTerminal.set(terminalId, exitCode);
      recompute(terminalId);
    }),
  );

  unsubs.push(
    pendingEditsStore.subscribe((edit) => {
      recompute(edit.terminalId);
    }),
  );

  unsubs.push(
    tabStateStore.subscribe((terminalId, state) => {
      emit('tabs:update', terminalId, state);
    }),
  );

  return () => {
    for (const off of unsubs) off();
  };
}
