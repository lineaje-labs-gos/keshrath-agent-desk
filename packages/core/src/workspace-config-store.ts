// Workspace config store — discovers and exposes .claude/* config files for
// a workspace's root directory. Powers the v1.7 skills/rules panel.
//
// Scope: read + edit skills (.claude/skills/*.md + SKILL.md dirs), hooks
// (.claude/hooks/*), .mcp.json, and CLAUDE.md at the workspace root.
//
// Writes pass through file-ops.ts with strict path containment: writes are
// refused unless the resolved absolute path is a descendant of the
// workspace's rootPath.

import { statSync, readdirSync } from 'node:fs';
import { resolve as pathResolve, relative as pathRelative, join as pathJoin, sep as pathSep } from 'node:path';
import { readConfig } from './config-store.js';
import { fileStat, fileWrite } from './file-ops.js';
import type { WorkspaceConfigFile, WorkspaceConfigKind } from './transport/channels.js';

interface Discovered {
  kind: WorkspaceConfigKind;
  /** Path relative to the workspace root. */
  relativePath: string;
  /** Resolved absolute path. */
  absolutePath: string;
}

function workspaceRootFor(workspaceId: string): string | null {
  const cfg = readConfig();
  const ws = cfg.workspaces[workspaceId];
  if (!ws || !ws.rootPath) return null;
  return pathResolve(ws.rootPath);
}

function isInside(parent: string, child: string): boolean {
  const rel = pathRelative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith(pathSep + '..') && !rel.startsWith('/' + '..');
}

function tryListDir(abs: string): string[] {
  try {
    return readdirSync(abs, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function tryListSubdirs(abs: string): string[] {
  try {
    return readdirSync(abs, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function discoverFiles(root: string): Discovered[] {
  const found: Discovered[] = [];

  // CLAUDE.md at root
  const claudeMd = pathJoin(root, 'CLAUDE.md');
  if (fileStat(claudeMd)) {
    found.push({ kind: 'claude-md', relativePath: 'CLAUDE.md', absolutePath: claudeMd });
  }

  // .mcp.json at root
  const mcp = pathJoin(root, '.mcp.json');
  if (fileStat(mcp)) {
    found.push({ kind: 'mcp', relativePath: '.mcp.json', absolutePath: mcp });
  }

  // .claude/hooks/* (shallow)
  const hooksDir = pathJoin(root, '.claude', 'hooks');
  for (const name of tryListDir(hooksDir)) {
    found.push({
      kind: 'hook',
      relativePath: pathJoin('.claude', 'hooks', name),
      absolutePath: pathJoin(hooksDir, name),
    });
  }

  // .claude/skills/*.md (top-level single-file skills)
  const skillsDir = pathJoin(root, '.claude', 'skills');
  for (const name of tryListDir(skillsDir)) {
    if (!name.endsWith('.md')) continue;
    found.push({
      kind: 'skill',
      relativePath: pathJoin('.claude', 'skills', name),
      absolutePath: pathJoin(skillsDir, name),
    });
  }
  // .claude/skills/<skill>/SKILL.md (bundled skills)
  for (const sub of tryListSubdirs(skillsDir)) {
    const skillMd = pathJoin(skillsDir, sub, 'SKILL.md');
    if (fileStat(skillMd)) {
      found.push({
        kind: 'skill',
        relativePath: pathJoin('.claude', 'skills', sub, 'SKILL.md'),
        absolutePath: skillMd,
      });
    }
  }

  return found;
}

export function listWorkspaceConfigFiles(workspaceId: string): WorkspaceConfigFile[] {
  const root = workspaceRootFor(workspaceId);
  if (!root) return [];
  const out: WorkspaceConfigFile[] = [];
  for (const d of discoverFiles(root)) {
    try {
      const st = statSync(d.absolutePath);
      out.push({
        kind: d.kind,
        relativePath: d.relativePath,
        absolutePath: d.absolutePath,
        size: st.size,
        mtime: st.mtimeMs,
      });
    } catch {
      // skip races
    }
  }
  return out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export function readWorkspaceConfig(workspaceId: string, relativePath: string): string {
  const root = workspaceRootFor(workspaceId);
  if (!root) return '';
  const abs = pathResolve(root, relativePath);
  if (!isInside(root, abs)) return '';
  try {
    return require('node:fs').readFileSync(abs, 'utf-8');
  } catch {
    return '';
  }
}

export function writeWorkspaceConfig(
  workspaceId: string,
  relativePath: string,
  content: string,
): { ok: boolean; error?: string } {
  const root = workspaceRootFor(workspaceId);
  if (!root) return { ok: false, error: 'workspace not found' };
  const abs = pathResolve(root, relativePath);
  if (!isInside(root, abs)) return { ok: false, error: 'path escapes workspace root' };
  try {
    fileWrite(abs, content);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
