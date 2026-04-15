// Bridges pendingEditsStore emissions into a host-provided emit fn.

import { pendingEditsStore } from './pending-edits-store.js';
import type { PushChannel, PushChannelMap } from './transport/channels.js';

export interface WireEditsOptions {
  emit: <K extends PushChannel>(channel: K, ...args: PushChannelMap[K]) => void;
}

export function wireEdits(opts: WireEditsOptions): () => void {
  return pendingEditsStore.subscribe((edit) => {
    opts.emit('edits:update', edit);
  });
}
