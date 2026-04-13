// Plugin manifest discovery + info-list building. Pure Node — no Electron.
// The Electron-specific bits (protocol.handle, ipcMain handlers, BrowserWindow
// init) live in @agent-desk/desktop's plugin-electron.ts and call into here.
//
// Web/server target builds plugin info from this same module and serves
// assets via HTTP routes instead of the plugin:// protocol.

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { pathToFileURL } from 'url';

interface PluginManifest {
  id: string;
  name: string;
  icon: string;
  version: string;
  description: string;
  main?: string; // main process module path (relative to package)
  ui: string; // renderer module path (relative to package)
  css?: string; // CSS file path (relative to package)
  uiFiles?: string[]; // ordered list of UI JS files
  position?: number;
}

interface LoadedPlugin {
  manifest: PluginManifest;
  packageDir: string;
  mainModule?: Record<string, unknown>;
}

interface PluginInfo {
  id: string;
  name: string;
  icon: string;
  version: string;
  description: string;
  position: number;
  cssUrl: string | null;
  scriptUrls: string[];
}

// Discover plugins from node_modules + ~/.agent-desk/plugins/.
// Caller passes the node_modules root explicitly so this module stays
// independent of how/where it's bundled (Electron asar vs Express dist).
function discoverPlugins(nodeModulesDir: string): LoadedPlugin[] {
  const plugins: LoadedPlugin[] = [];

  if (!existsSync(nodeModulesDir)) return plugins;

  for (const entry of readdirSync(nodeModulesDir)) {
    const entryPath = join(nodeModulesDir, entry);
    if (entry.startsWith('@')) {
      try {
        for (const subEntry of readdirSync(entryPath)) {
          tryLoadPlugin(join(entryPath, subEntry), plugins);
        }
      } catch {
        /* skip */
      }
      continue;
    }
    tryLoadPlugin(entryPath, plugins);
  }

  // Also scan ~/.agent-desk/plugins/
  const localPluginsDir = join(homedir(), '.agent-desk', 'plugins');
  if (existsSync(localPluginsDir)) {
    for (const entry of readdirSync(localPluginsDir)) {
      tryLoadPlugin(join(localPluginsDir, entry), plugins);
    }
  }

  plugins.sort((a, b) => (a.manifest.position ?? 99) - (b.manifest.position ?? 99));
  return plugins;
}

function tryLoadPlugin(dir: string, plugins: LoadedPlugin[]): void {
  const manifestPath = join(dir, 'agent-desk-plugin.json');
  if (!existsSync(manifestPath)) return;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    plugins.push({ manifest, packageDir: dir });
  } catch {
    /* skip malformed */
  }
}

// Resolve a plugin asset request to an absolute file path on disk, or null
// if the plugin is unknown or the path tries to escape the plugin's ui dir.
// Used by both Electron's protocol.handle and the future HTTP route.
export function resolvePluginAsset(
  plugins: LoadedPlugin[],
  pluginId: string,
  filePath: string,
): { absPath: string; mimeType: string } | null {
  const plugin = plugins.find((p) => p.manifest.id === pluginId);
  if (!plugin) return null;

  const uiDir = join(plugin.packageDir, 'dist', 'ui');
  const resolved = join(uiDir, filePath);
  if (!resolved.startsWith(uiDir)) return null;
  if (!existsSync(resolved)) return null;

  const ext = resolved.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    js: 'application/javascript',
    css: 'text/css',
    html: 'text/html',
    json: 'application/json',
    svg: 'image/svg+xml',
  };
  return { absPath: resolved, mimeType: mimeTypes[ext || ''] || 'application/octet-stream' };
}

// Build plugin info for renderer
function getPluginInfoList(plugins: LoadedPlugin[]): PluginInfo[] {
  return plugins.map((p) => {
    const m = p.manifest;
    const uiDir = join(p.packageDir, 'dist', 'ui');
    const uiFiles = m.uiFiles || [m.ui.split('/').pop() || 'app.js'];
    // Prefer version from package.json (always up-to-date) over manifest
    let version = m.version;
    try {
      const pkgPath = join(p.packageDir, 'package.json');
      if (existsSync(pkgPath)) {
        version = JSON.parse(readFileSync(pkgPath, 'utf-8')).version || version;
      }
    } catch {
      /* use manifest version */
    }
    return {
      id: m.id,
      name: m.name,
      icon: m.icon,
      version,
      description: m.description || '',
      position: m.position ?? 99,
      cssUrl: m.css ? pathToFileURL(join(uiDir, 'styles.css')).href : null,
      scriptUrls: uiFiles.map((f) => pathToFileURL(join(uiDir, f)).href),
    };
  });
}

// Cleanup
function destroyPlugins(plugins: LoadedPlugin[]): void {
  for (const plugin of plugins) {
    const mod = plugin.mainModule as Record<string, unknown> | undefined;
    if (mod && typeof mod.destroyMain === 'function') {
      try {
        (mod.destroyMain as () => void)();
      } catch {
        /* ignore */
      }
    }
  }
}

// Pure handler for the 'plugins:getConfig' channel — returns the dashboard
// base URL for a given plugin id, or null if unknown. Both desktop and server
// targets bind this directly to their router.
export function getPluginConfig(plugins: LoadedPlugin[], pluginId: string): { baseUrl: string; wsUrl: string } | null {
  const plugin = plugins.find((p) => p.manifest.id === pluginId);
  if (!plugin) return null;
  const portMap: Record<string, { env: string; fallback: number }> = {
    'agent-comm': { env: 'AGENT_COMM_PORT', fallback: 3421 },
    'agent-tasks': { env: 'AGENT_TASKS_PORT', fallback: 3422 },
    'agent-knowledge': { env: 'AGENT_KNOWLEDGE_PORT', fallback: 3423 },
    'agent-discover': { env: 'AGENT_DISCOVER_PORT', fallback: 3424 },
  };
  const entry = portMap[pluginId];
  const port = entry ? parseInt(process.env[entry.env] ?? String(entry.fallback), 10) : undefined;
  return port
    ? {
        baseUrl: `http://localhost:${port}`,
        wsUrl: `localhost:${port}`,
      }
    : null;
}

export { discoverPlugins, destroyPlugins, getPluginInfoList, LoadedPlugin, PluginManifest, PluginInfo };
