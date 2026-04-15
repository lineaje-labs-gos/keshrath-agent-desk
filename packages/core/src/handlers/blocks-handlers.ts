// Blocks channel handlers (v1.7).

import type { RequestHandlers } from '../index.js';
import { blockStore } from '../block-store.js';
import type { TerminalManager } from '../terminal-manager.js';

export interface BuildBlocksHandlersDeps {
  terminals: TerminalManager;
}

export function buildBlocksHandlers(deps: BuildBlocksHandlersDeps): Partial<RequestHandlers> {
  const { terminals } = deps;
  return {
    'blocks:list': (terminalId, limit) => blockStore.list(terminalId, limit),
    'blocks:get': (blockId) => blockStore.get(blockId),
    'blocks:search': (query, opts) => blockStore.search(query, opts ?? {}),
    'blocks:rerun': (blockId, targetTerminalId) => {
      const block = blockStore.get(blockId);
      if (!block) return { ok: false, error: 'block not found' };
      if (!block.command) return { ok: false, error: 'block has no command to rerun' };
      const tid = targetTerminalId ?? block.terminalId;
      const ok = terminals.write(tid, `${block.command}\n`);
      if (!ok) return { ok: false, error: 'terminal not writable' };
      return { ok: true, terminalId: tid };
    },
    'blocks:clear': (terminalId) => {
      blockStore.clear(terminalId);
      return true;
    },
  };
}
