// Wires TerminalManager pty output into blockStore, and bridges blockStore
// emissions into a host-provided emit fn (Router.emit for desktop / WS).

import { TerminalManager } from './terminal-manager.js';
import { blockStore } from './block-store.js';
import type { PushChannel, PushChannelMap, TerminalBlock } from './transport/channels.js';

export interface WireBlocksOptions {
  terminals: TerminalManager;
  emit: <K extends PushChannel>(channel: K, ...args: PushChannelMap[K]) => void;
}

export function wireBlocks(opts: WireBlocksOptions): () => void {
  const { terminals, emit } = opts;
  const unsubs: Array<() => void> = [];

  unsubs.push(
    terminals.onData((terminalId, data) => {
      blockStore.feed(terminalId, data);
    }),
  );

  unsubs.push(
    terminals.onExit((terminalId, exitCode) => {
      blockStore.endBlock(terminalId, exitCode);
    }),
  );

  unsubs.push(
    blockStore.subscribe((ev) => {
      if (ev.kind === 'new') {
        emit('blocks:new', ev.block as TerminalBlock);
      } else {
        emit('blocks:update', ev.blockId, ev.patch);
      }
    }),
  );

  return () => {
    for (const off of unsubs) off();
  };
}
