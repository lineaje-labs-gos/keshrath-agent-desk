// Tab modality channel handlers (v1.7).

import type { RequestHandlers } from '../index.js';
import { tabStateStore } from '../tab-state-store.js';

export function buildTabsHandlers(): Partial<RequestHandlers> {
  return {
    'tabs:state': (terminalId) => tabStateStore.get(terminalId),
    'tabs:allStates': () => tabStateStore.all(),
  };
}
