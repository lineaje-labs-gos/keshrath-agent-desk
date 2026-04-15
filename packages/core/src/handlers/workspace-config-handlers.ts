// Workspace-config channel handlers (v1.7 — skills/rules panel).

import type { RequestHandlers } from '../index.js';
import { listWorkspaceConfigFiles, readWorkspaceConfig, writeWorkspaceConfig } from '../workspace-config-store.js';

export function buildWorkspaceConfigHandlers(): Partial<RequestHandlers> {
  return {
    'workspace:configFiles': (workspaceId) => listWorkspaceConfigFiles(workspaceId),
    'workspace:configRead': (workspaceId, relativePath) => readWorkspaceConfig(workspaceId, relativePath),
    'workspace:configWrite': (workspaceId, relativePath, content) =>
      writeWorkspaceConfig(workspaceId, relativePath, content),
  };
}
