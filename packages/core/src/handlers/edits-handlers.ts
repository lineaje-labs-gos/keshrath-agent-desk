// Pending-edits channel handlers (v1.7).

import type { RequestHandlers } from '../index.js';
import { pendingEditsStore } from '../pending-edits-store.js';

export function buildEditsHandlers(): Partial<RequestHandlers> {
  return {
    'edits:list': (opts) => pendingEditsStore.list(opts ?? {}),
    'edits:get': (editId) => pendingEditsStore.get(editId),
    'edits:approve': (editId) => pendingEditsStore.approve(editId),
    'edits:reject': (editId, reason) => pendingEditsStore.reject(editId, reason),
    'edits:comment': (editId, body, hunkIndex) => pendingEditsStore.comment(editId, body, hunkIndex ?? null),
    'edits:ingest': (input) => pendingEditsStore.ingest(input),
  };
}
