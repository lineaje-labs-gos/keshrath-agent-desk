// Provider channel handlers (v1.7 — unified-input NL routing).

import type { RequestHandlers } from '../index.js';
import { listProviders, getProvider, saveProvider, deleteProvider, complete } from '../provider-registry.js';

export function buildProvidersHandlers(): Partial<RequestHandlers> {
  return {
    'providers:list': () => listProviders(),
    'providers:get': (id) => getProvider(id),
    'providers:save': (cfg) => saveProvider(cfg),
    'providers:delete': (id) => deleteProvider(id),
    'providers:complete': (providerId, prompt, opts) => complete(providerId, prompt, opts ?? {}),
  };
}
