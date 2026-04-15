// Unit tests for discoverRepoTree — workspace-as-folder + recursive submodule
// discovery. Builds a real temp git repo with nested submodules so the test
// exercises the actual simple-git + fs.promises code paths.

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';

let tmpRoot: string;

function hasGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

function initRepo(dir: string, initialFile = 'README.md', initialContent = '# repo\n'): void {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Tester');
  git(dir, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, initialFile), initialContent, 'utf8');
  git(dir, 'add', initialFile);
  git(dir, 'commit', '-q', '-m', 'init');
}

function addSubmodule(parentDir: string, submoduleName: string, submoduleSourceDir: string): void {
  // Use a file:// URL so git treats it as a remote. On Windows the leading
  // slash is already present in absolute paths, so we normalize once.
  const abs = submoduleSourceDir.replace(/\\/g, '/');
  const url = abs.startsWith('/') ? `file://${abs}` : `file:///${abs}`;
  git(parentDir, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', url, submoduleName);
  git(parentDir, 'commit', '-q', '-m', `add ${submoduleName}`);
}

beforeAll(() => {
  if (!hasGit()) {
    throw new Error('git CLI required for git-store-tree tests');
  }
});

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'agent-desk-git-tree-'));
});

afterEach(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe('discoverRepoTree — workspace root IS a git repo', () => {
  it('returns a single top-level node with empty children for a repo with no submodules', async () => {
    const { discoverRepoTree, _clearGitStoreCache } = await import('../../packages/core/src/git-store.js');
    _clearGitStoreCache();

    const repo = join(tmpRoot, 'solo');
    initRepo(repo);

    const tree = await discoverRepoTree(repo);
    expect(tree.repos).toHaveLength(1);
    const node = tree.repos[0];
    expect(node.isSubmodule).toBe(false);
    expect(node.depth).toBe(0);
    expect(node.parentRoot).toBe(null);
    expect(node.relativePath).toBe('');
    expect(node.children).toEqual([]);
    expect(node.status).not.toBeNull();
    expect(node.status?.branch).toBe('main');
  });

  it('discovers a single submodule at depth 1', async () => {
    const { discoverRepoTree, _clearGitStoreCache } = await import('../../packages/core/src/git-store.js');
    _clearGitStoreCache();

    const parent = join(tmpRoot, 'parent');
    const sub = join(tmpRoot, 'sub-source');
    initRepo(parent);
    initRepo(sub);
    addSubmodule(parent, 'libs/sub', sub);

    const tree = await discoverRepoTree(parent);
    expect(tree.repos).toHaveLength(1);
    const parentNode = tree.repos[0];
    expect(parentNode.children).toHaveLength(1);
    const subNode = parentNode.children[0];
    expect(subNode.isSubmodule).toBe(true);
    expect(subNode.depth).toBe(1);
    expect(subNode.parentRoot).toBe(parentNode.root);
    expect(subNode.relativePath).toBe('libs/sub');
    expect(subNode.name).toBe('sub');
    expect(subNode.status).not.toBeNull();
  });

  it('discovers nested submodules (submodule inside a submodule)', { timeout: 30000 }, async () => {
    const { discoverRepoTree, _clearGitStoreCache, flattenRepoTree } =
      await import('../../packages/core/src/git-store.js');
    _clearGitStoreCache();

    // Build a 3-level tree: grandchild → child → parent
    const grandchildSrc = join(tmpRoot, 'grandchild-src');
    initRepo(grandchildSrc);

    const childSrc = join(tmpRoot, 'child-src');
    initRepo(childSrc);
    addSubmodule(childSrc, 'vendor/grandchild', grandchildSrc);

    const parent = join(tmpRoot, 'parent');
    initRepo(parent);
    addSubmodule(parent, 'libs/child', childSrc);

    const tree = await discoverRepoTree(parent);
    expect(tree.repos).toHaveLength(1);
    const flat = flattenRepoTree(tree);
    // Depending on submodule.recurse config + git version the exact node
    // count can be 3 (parent + child + grandchild) or 4 (if git recursed on
    // submodule add). Either way the key invariants below must hold: at
    // least three nodes exist, there's at least one at depth 2, and the
    // grandchild is correctly marked as a submodule with a parentRoot.
    expect(flat.length).toBeGreaterThanOrEqual(3);
    const depths = flat.map((n) => n.depth).sort();
    expect(depths[0]).toBe(0);
    expect(depths[depths.length - 1]).toBeGreaterThanOrEqual(2);
    const grandchild = flat.find((n) => n.depth === 2);
    expect(grandchild).toBeTruthy();
    expect(grandchild?.parentRoot).toBeTruthy();
    expect(grandchild?.isSubmodule).toBe(true);
  });
});

describe('discoverRepoTree — workspace root is NOT a git repo', () => {
  it('returns empty repos when the folder has no git children', async () => {
    const { discoverRepoTree, _clearGitStoreCache } = await import('../../packages/core/src/git-store.js');
    _clearGitStoreCache();

    const folder = join(tmpRoot, 'empty');
    mkdirSync(join(folder, 'docs'), { recursive: true });
    mkdirSync(join(folder, 'scripts'), { recursive: true });

    const tree = await discoverRepoTree(folder);
    expect(tree.repos).toEqual([]);
    expect(tree.workspaceRoot).toContain('empty');
  });

  it('discovers sibling projects at depth 0', async () => {
    const { discoverRepoTree, _clearGitStoreCache } = await import('../../packages/core/src/git-store.js');
    _clearGitStoreCache();

    const folder = join(tmpRoot, 'multi');
    mkdirSync(folder, { recursive: true });
    initRepo(join(folder, 'projectA'));
    initRepo(join(folder, 'projectB'));
    // A plain directory that shouldn't be picked up
    mkdirSync(join(folder, 'docs'), { recursive: true });
    writeFileSync(join(folder, 'docs', 'readme.md'), 'not a repo', 'utf8');

    const tree = await discoverRepoTree(folder);
    expect(tree.repos).toHaveLength(2);
    const names = tree.repos.map((r) => r.name).sort();
    expect(names).toEqual(['projectA', 'projectB']);
    for (const node of tree.repos) {
      expect(node.depth).toBe(0);
      expect(node.isSubmodule).toBe(false);
      expect(node.parentRoot).toBe(null);
      expect(node.status).not.toBeNull();
    }
  });

  it('skips node_modules, .git, dist, build and hidden directories', async () => {
    const { discoverRepoTree, _clearGitStoreCache } = await import('../../packages/core/src/git-store.js');
    _clearGitStoreCache();

    const folder = join(tmpRoot, 'skippy');
    mkdirSync(folder, { recursive: true });
    // Valid repo to be found
    initRepo(join(folder, 'real-project'));
    // Disguised git directories that must be skipped
    for (const skip of ['node_modules', 'dist', 'build', '.hidden']) {
      const p = join(folder, skip);
      mkdirSync(p, { recursive: true });
      mkdirSync(join(p, '.git'), { recursive: true });
    }

    const tree = await discoverRepoTree(folder);
    const names = tree.repos.map((r) => r.name);
    expect(names).toContain('real-project');
    expect(names).not.toContain('node_modules');
    expect(names).not.toContain('dist');
    expect(names).not.toContain('build');
    expect(names).not.toContain('.hidden');
  });
});

describe('discoverRepoTree — caching', () => {
  it('returns the same object reference within the TTL window', async () => {
    const { discoverRepoTree, _clearGitStoreCache } = await import('../../packages/core/src/git-store.js');
    _clearGitStoreCache();

    const repo = join(tmpRoot, 'cached');
    initRepo(repo);

    // Freeze Date.now so the real wall-clock cost of the first call (which can
    // exceed TREE_TTL_MS=2000ms on slow filesystems / Windows) doesn't expire
    // the cache before the second call is made.
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      const first = await discoverRepoTree(repo);
      const second = await discoverRepoTree(repo);
      expect(second).toBe(first); // same object — served from cache
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('normalizes the root so different path representations share a cache entry', async () => {
    const { discoverRepoTree, _clearGitStoreCache } = await import('../../packages/core/src/git-store.js');
    _clearGitStoreCache();

    const repo = join(tmpRoot, 'normalized');
    initRepo(repo);

    const first = await discoverRepoTree(repo);
    const second = await discoverRepoTree(repo + '/');
    expect(second.workspaceRoot).toBe(first.workspaceRoot);
    // Both should have the same structure
    expect(second.repos.length).toBe(first.repos.length);
  });
});

describe('discoverRepoTree — uninitialized submodules', () => {
  it('emits a node for a submodule whose working tree is empty, with status null', async () => {
    const { discoverRepoTree, _clearGitStoreCache } = await import('../../packages/core/src/git-store.js');
    _clearGitStoreCache();

    const parent = join(tmpRoot, 'parent');
    initRepo(parent);
    // Hand-author a .gitmodules pointing at a non-existent path so we exercise
    // the "uninit" fallback where the path exists in config but not on disk.
    writeFileSync(join(parent, '.gitmodules'), `[submodule "fake"]\n\tpath = libs/fake\n\turl = ./fake\n`, 'utf8');
    git(parent, 'add', '.gitmodules');
    git(parent, 'commit', '-q', '-m', 'add fake submodule entry');

    const tree = await discoverRepoTree(parent);
    const parentNode = tree.repos[0];
    const fake = parentNode.children.find((c) => c.relativePath.endsWith('fake'));
    expect(fake).toBeTruthy();
    // The fake submodule path doesn't exist, so status is null but the node
    // is still emitted so the UI can show "pending / uninitialized".
    expect(fake?.isSubmodule).toBe(true);
    expect(fake?.status).toBe(null);
    // No real checkout exists at that path
    expect(existsSync(fake!.root)).toBe(false);
  });
});
