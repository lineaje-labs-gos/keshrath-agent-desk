// Trivial filesystem ops exposed via IPC. The host wraps these with whatever
// path-approval policy is appropriate (Electron uses a save-dialog approval
// set; the server target rejects writes outside an allowlist).

import { statSync, writeFileSync, readFileSync } from 'fs';
import { dirname } from 'path';

export interface FileStat {
  isDirectory: boolean;
  isFile: boolean;
  size: number;
}

export function fileStat(filePath: string): FileStat | null {
  try {
    const s = statSync(filePath);
    return { isDirectory: s.isDirectory(), isFile: s.isFile(), size: s.size };
  } catch {
    return null;
  }
}

export function fileDirname(filePath: string): string {
  return dirname(filePath);
}

export function fileWrite(filePath: string, content: string): boolean {
  writeFileSync(filePath, content, 'utf-8');
  return true;
}

export function fileRead(filePath: string): { ok: boolean; content?: string; error?: string } {
  try {
    return { ok: true, content: readFileSync(filePath, 'utf-8') };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
