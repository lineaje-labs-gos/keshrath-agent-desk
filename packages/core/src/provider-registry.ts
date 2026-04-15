// Provider registry — per-workspace LLM providers for the unified-input bar.
//
// Scope (v1.7): bring-your-own-key, one-shot completions only. The registry
// does NOT spawn new long-running agents; those still come from profiles.
// The titlebar input bar uses providers:complete to route plain-text input
// to a single response when the user has no agent tab focused.
//
// Persistence lives in ConfigData under `providers` keyed by id. API keys
// are referenced by env-var name or OS-keychain ref; literal keys never
// touch disk or the channel.

import type { ConfigData } from './config-store.js';
import { readConfig, writeConfig } from './config-store.js';
import type { ProviderConfig, ProviderCompletion, ProviderKind } from './transport/channels.js';

const ENV_PREFIX = 'AGENT_DESK_PROVIDER_';
const DEFAULT_MAX_TOKENS = 1024;
const REQUEST_TIMEOUT_MS = 60_000;

function ensureProvidersSlot(cfg: ConfigData): ConfigData {
  const anyCfg = cfg as ConfigData & { providers?: Record<string, ProviderConfig> };
  if (!anyCfg.providers) anyCfg.providers = {};
  return anyCfg;
}

function readProviders(): Record<string, ProviderConfig> {
  const cfg = ensureProvidersSlot(readConfig()) as ConfigData & {
    providers: Record<string, ProviderConfig>;
  };
  return cfg.providers;
}

export function listProviders(): ProviderConfig[] {
  return Object.values(readProviders());
}

export function getProvider(id: string): ProviderConfig | null {
  return readProviders()[id] ?? null;
}

export function saveProvider(cfg: ProviderConfig): boolean {
  if (!cfg || typeof cfg.id !== 'string' || !cfg.id) return false;
  const full = ensureProvidersSlot(readConfig()) as ConfigData & {
    providers: Record<string, ProviderConfig>;
  };
  full.providers = { ...full.providers, [cfg.id]: { ...cfg } };
  writeConfig(full);
  return true;
}

export function deleteProvider(id: string): boolean {
  const full = ensureProvidersSlot(readConfig()) as ConfigData & {
    providers: Record<string, ProviderConfig>;
  };
  if (!full.providers[id]) return false;
  const next = { ...full.providers };
  delete next[id];
  full.providers = next;
  writeConfig(full);
  return true;
}

function resolveApiKey(cfg: ProviderConfig): string | null {
  if (!cfg.apiKeyRef) return null;
  if (cfg.apiKeyRef.startsWith('env:')) return process.env[cfg.apiKeyRef.slice(4)] ?? null;
  return process.env[cfg.apiKeyRef] ?? process.env[`${ENV_PREFIX}${cfg.id.toUpperCase()}`] ?? null;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } finally {
    clearTimeout(timer);
  }
}

interface Driver {
  complete(
    cfg: ProviderConfig,
    apiKey: string | null,
    prompt: string,
    opts: { maxTokens?: number; system?: string },
  ): Promise<string>;
}

const anthropicDriver: Driver = {
  async complete(cfg, apiKey, prompt, opts) {
    if (!apiKey) throw new Error('Anthropic provider requires an API key');
    const endpoint = cfg.endpoint || 'https://api.anthropic.com';
    const res = (await postJson(
      `${endpoint.replace(/\/$/, '')}/v1/messages`,
      {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      {
        model: cfg.model || 'claude-opus-4-6',
        max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: opts.system,
        messages: [{ role: 'user', content: prompt }],
      },
    )) as { content?: Array<{ type: string; text?: string }> };
    const parts = (res.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '');
    return parts.join('');
  },
};

const openaiDriver: Driver = {
  async complete(cfg, apiKey, prompt, opts) {
    if (!apiKey) throw new Error('OpenAI provider requires an API key');
    const endpoint = cfg.endpoint || 'https://api.openai.com';
    const res = (await postJson(
      `${endpoint.replace(/\/$/, '')}/v1/chat/completions`,
      { Authorization: `Bearer ${apiKey}` },
      {
        model: cfg.model || 'gpt-4o-mini',
        max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
        messages: [
          ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
          { role: 'user', content: prompt },
        ],
      },
    )) as { choices?: Array<{ message?: { content?: string } }> };
    return res.choices?.[0]?.message?.content ?? '';
  },
};

const ollamaDriver: Driver = {
  async complete(cfg, _apiKey, prompt, opts) {
    const endpoint = cfg.endpoint || 'http://localhost:11434';
    const res = (await postJson(
      `${endpoint.replace(/\/$/, '')}/api/generate`,
      {},
      {
        model: cfg.model || 'llama3',
        prompt: opts.system ? `${opts.system}\n\n${prompt}` : prompt,
        stream: false,
        options: { num_predict: opts.maxTokens ?? DEFAULT_MAX_TOKENS },
      },
    )) as { response?: string };
    return res.response ?? '';
  },
};

const customDriver: Driver = {
  async complete(cfg, apiKey, prompt, opts) {
    if (!cfg.endpoint) throw new Error('Custom provider requires an endpoint URL');
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = (await postJson(cfg.endpoint, headers, {
      model: cfg.model,
      prompt,
      system: opts.system,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    })) as { text?: string; response?: string };
    return res.text ?? res.response ?? '';
  },
};

const DRIVERS: Record<ProviderKind, Driver> = {
  anthropic: anthropicDriver,
  openai: openaiDriver,
  ollama: ollamaDriver,
  custom: customDriver,
};

export async function complete(
  providerId: string,
  prompt: string,
  opts: { maxTokens?: number; system?: string } = {},
): Promise<ProviderCompletion> {
  const cfg = getProvider(providerId);
  if (!cfg) return { text: '', error: `provider not found: ${providerId}` };
  const key = resolveApiKey(cfg);
  if (cfg.kind !== 'ollama' && !key) {
    return {
      text: '',
      error: `provider ${providerId} has no API key; set ${cfg.apiKeyRef ?? `$${ENV_PREFIX}${cfg.id.toUpperCase()}`}`,
    };
  }
  const driver = DRIVERS[cfg.kind];
  if (!driver) return { text: '', error: `unknown provider kind: ${cfg.kind}` };

  try {
    const text = await driver.complete(cfg, key, prompt, opts);
    return { text };
  } catch (err) {
    return { text: '', error: err instanceof Error ? err.message : String(err) };
  }
}

export const PROVIDER_KINDS: ProviderKind[] = ['anthropic', 'openai', 'ollama', 'custom'];
