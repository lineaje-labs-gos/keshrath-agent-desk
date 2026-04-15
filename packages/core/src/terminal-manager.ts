import * as pty from 'node-pty';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';

const BUFFER_MAX = 100_000;

export interface TerminalClient {
  send: (data: string) => void;
  sendExit: (exitCode: number) => void;
}

export interface HistoryEntry {
  command: string;
  terminalId: string;
  terminalTitle: string;
  timestamp: number;
  cwd?: string;
}

export interface ManagedTerminal {
  id: string;
  pty: pty.IPty;
  cwd: string;
  command: string;
  args: string[];
  clients: Set<TerminalClient>;
  outputBuffer: string;
  bufferChunks: string[];
  bufferLength: number;
  status: 'running' | 'exited';
  exitCode: number | null;
  createdAt: string;
  title: string;
  // Agent/profile metadata for session persistence
  agentName: string | null;
  profileName: string | null;
  // Input history tracking (F13)
  inputBuffer: string;
}

export type TerminalDataListener = (terminalId: string, data: string) => void;
export type TerminalExitListener = (terminalId: string, exitCode: number) => void;

export class TerminalManager {
  private terminals = new Map<string, ManagedTerminal>();
  private historyListeners: Array<(entry: HistoryEntry) => void> = [];
  private dataListeners: TerminalDataListener[] = [];
  private exitListeners: TerminalExitListener[] = [];

  onHistoryEntry(listener: (entry: HistoryEntry) => void): void {
    this.historyListeners.push(listener);
  }

  /**
   * Subscribe to raw pty data. Called on every chunk for every terminal.
   * Used by the block-store wiring to partition output into blocks via
   * OSC 133 sequences. Returns an unsubscribe fn.
   */
  onData(listener: TerminalDataListener): () => void {
    this.dataListeners.push(listener);
    return () => {
      const i = this.dataListeners.indexOf(listener);
      if (i >= 0) this.dataListeners.splice(i, 1);
    };
  }

  /** Subscribe to pty exit events. Returns an unsubscribe fn. */
  onExit(listener: TerminalExitListener): () => void {
    this.exitListeners.push(listener);
    return () => {
      const i = this.exitListeners.indexOf(listener);
      if (i >= 0) this.exitListeners.splice(i, 1);
    };
  }

  spawn(
    cwd?: string,
    command?: string,
    args?: string[],
    cols?: number,
    rows?: number,
    env?: Record<string, string>,
  ): ManagedTerminal {
    const id = randomUUID();
    const resolvedCwd = cwd || process.env.USERPROFILE || process.env.HOME || process.cwd();
    const cmd = command || this.getDefaultShell();
    const cmdArgs = args || [];

    const isWindows = process.platform === 'win32';
    let file: string;
    let spawnArgs: string[];

    const isAbsolutePath = /^[a-zA-Z]:[/\\]/.test(cmd) || cmd.startsWith('/');
    if (
      isWindows &&
      !isAbsolutePath &&
      cmd !== 'cmd' &&
      cmd !== 'cmd.exe' &&
      cmd !== 'powershell' &&
      cmd !== 'powershell.exe'
    ) {
      if (!/^[a-zA-Z0-9._-]+$/.test(cmd)) {
        throw new Error(`Invalid command name: ${cmd}`);
      }
      try {
        file = execFileSync('where', [cmd], { encoding: 'utf-8' }).trim().split('\n')[0].trim();
      } catch {
        file = cmd;
      }
      spawnArgs = cmdArgs;
    } else {
      file = cmd;
      spawnArgs = cmdArgs;
    }

    const ptyProcess = pty.spawn(file, spawnArgs, {
      name: 'xterm-256color',
      cols: cols || 120,
      rows: rows || 30,
      cwd: resolvedCwd,
      env: {
        ...(process.env as Record<string, string>),
        FORCE_COLOR: '1',
        TERM: 'xterm-256color',
        ...(env || {}),
      },
    });

    const terminal: ManagedTerminal = {
      id,
      pty: ptyProcess,
      cwd: resolvedCwd,
      command: cmd,
      args: cmdArgs,
      clients: new Set(),
      outputBuffer: '',
      bufferChunks: [],
      bufferLength: 0,
      status: 'running',
      exitCode: null,
      createdAt: new Date().toISOString(),
      title: this.getTitle(cmd, cmdArgs),
      agentName: null,
      profileName: null,
      inputBuffer: '',
    };

    ptyProcess.onData((data: string) => {
      terminal.bufferChunks.push(data);
      terminal.bufferLength += data.length;
      if (terminal.bufferLength > BUFFER_MAX * 1.5) {
        terminal.outputBuffer = this.compactBuffer(terminal);
      }

      for (const client of terminal.clients) {
        try {
          client.send(data);
        } catch {
          /* client gone */
        }
      }
      for (const listener of this.dataListeners) {
        try {
          listener(id, data);
        } catch {
          /* listener errors must not break the pty loop */
        }
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      terminal.status = 'exited';
      terminal.exitCode = exitCode;
      for (const client of terminal.clients) {
        try {
          client.sendExit(exitCode);
        } catch {
          /* client gone */
        }
      }
      for (const listener of this.exitListeners) {
        try {
          listener(id, exitCode);
        } catch {
          /* listener errors must not break the exit path */
        }
      }
    });

    this.terminals.set(id, terminal);
    return terminal;
  }

  write(id: string, data: string): boolean {
    const terminal = this.terminals.get(id);
    if (!terminal || terminal.status !== 'running') return false;
    try {
      terminal.pty.write(data);
      // Track input for command history (F13)
      this.trackInput(terminal, data);
      return true;
    } catch {
      return false;
    }
  }

  resize(id: string, cols: number, rows: number): boolean {
    const terminal = this.terminals.get(id);
    if (!terminal || terminal.status !== 'running') return false;
    try {
      terminal.pty.resize(cols, rows);
      return true;
    } catch {
      return false;
    }
  }

  kill(id: string): boolean {
    const terminal = this.terminals.get(id);
    if (!terminal || terminal.status !== 'running') return false;
    try {
      terminal.pty.kill();
      return true;
    } catch {
      return false;
    }
  }

  signal(id: string, sig: string): boolean {
    const terminal = this.terminals.get(id);
    if (!terminal || terminal.status !== 'running') return false;
    try {
      if (sig === 'SIGINT') {
        // Send Ctrl+C character sequence
        terminal.pty.write('\x03');
      } else if (sig === 'SIGTERM' || sig === 'SIGKILL') {
        terminal.pty.kill(sig);
      } else {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  restart(id: string): { id: string; cwd: string; command: string; args: string[] } | null {
    const terminal = this.terminals.get(id);
    if (!terminal) return null;

    const { cwd, command, args } = terminal;

    // Kill the old process if still running
    if (terminal.status === 'running') {
      try {
        terminal.pty.kill();
      } catch {
        /* noop */
      }
    }

    this.terminals.delete(id);

    // Spawn a new one with same params and a new ID
    const newTerm = this.spawn(cwd, command, args);
    return { id: newTerm.id, cwd: newTerm.cwd, command: newTerm.command, args: newTerm.args };
  }

  subscribe(id: string, client: TerminalClient): void {
    const terminal = this.terminals.get(id);
    if (!terminal) return;
    terminal.clients.add(client);
    const buffer = this.compactBuffer(terminal);
    if (buffer.length > 0) {
      try {
        client.send(buffer);
      } catch {
        /* noop */
      }
    }
    if (terminal.status === 'exited') {
      try {
        client.sendExit(terminal.exitCode ?? -1);
      } catch {
        /* noop */
      }
    }
  }

  unsubscribeAll(id: string): void {
    const terminal = this.terminals.get(id);
    if (terminal) terminal.clients.clear();
  }

  remove(id: string): void {
    const terminal = this.terminals.get(id);
    if (!terminal) return;
    if (terminal.status === 'running') {
      try {
        terminal.pty.kill();
      } catch {
        /* noop */
      }
    }
    this.terminals.delete(id);
  }

  setAgentInfo(id: string, agentName: string | null, profileName: string | null): boolean {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;
    if (agentName !== undefined) terminal.agentName = agentName;
    if (profileName !== undefined) terminal.profileName = profileName;
    return true;
  }

  list(): Array<{
    id: string;
    cwd: string;
    command: string;
    args: string[];
    status: string;
    exitCode: number | null;
    createdAt: string;
    title: string;
    agentName: string | null;
    profileName: string | null;
  }> {
    return Array.from(this.terminals.values()).map((t) => ({
      id: t.id,
      cwd: t.cwd,
      command: t.command,
      args: t.args,
      status: t.status,
      exitCode: t.exitCode,
      createdAt: t.createdAt,
      title: t.title,
      agentName: t.agentName,
      profileName: t.profileName,
    }));
  }

  getPid(id: string): number | null {
    const terminal = this.terminals.get(id);
    if (!terminal || terminal.status !== 'running') return null;
    return terminal.pty.pid;
  }

  getBuffer(id: string): string {
    const terminal = this.terminals.get(id);
    if (!terminal) return '';
    return this.compactBuffer(terminal);
  }

  // --- Input History Tracking (F13) ---

  private trackInput(terminal: ManagedTerminal, data: string): void {
    // Detect Enter key (carriage return or newline)
    if (data.includes('\r') || data.includes('\n')) {
      const command = terminal.inputBuffer.trim();
      terminal.inputBuffer = '';

      // Filter: skip empty, single char, or control sequences
      if (command.length <= 1) return;
      // eslint-disable-next-line no-control-regex
      if (/^[\x00-\x1f]+$/.test(command)) return;
      // eslint-disable-next-line no-control-regex
      const cleaned = command.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').trim();
      if (cleaned.length <= 1) return;

      const entry: HistoryEntry = {
        command: cleaned,
        terminalId: terminal.id,
        terminalTitle: terminal.title,
        timestamp: Date.now(),
        cwd: terminal.cwd,
      };
      for (const listener of this.historyListeners) {
        try {
          listener(entry);
        } catch {
          /* noop */
        }
      }
    } else {
      // Accumulate input (handle backspace)
      for (const ch of data) {
        if (ch === '\x7f' || ch === '\b') {
          terminal.inputBuffer = terminal.inputBuffer.slice(0, -1);
        } else if (ch.charCodeAt(0) >= 32) {
          terminal.inputBuffer += ch;
        }
      }
    }
  }

  private compactBuffer(terminal: ManagedTerminal): string {
    if (terminal.bufferChunks.length > 0) {
      terminal.outputBuffer += terminal.bufferChunks.join('');
      terminal.bufferChunks = [];
    }
    if (terminal.outputBuffer.length > BUFFER_MAX) {
      terminal.outputBuffer = terminal.outputBuffer.slice(-BUFFER_MAX);
    }
    terminal.bufferLength = terminal.outputBuffer.length;
    return terminal.outputBuffer;
  }

  cleanup(): void {
    for (const [, terminal] of this.terminals) {
      if (terminal.status === 'running') {
        try {
          terminal.pty.kill();
        } catch {
          /* noop */
        }
      }
    }
    this.terminals.clear();
  }

  private getDefaultShell(): string {
    if (process.platform === 'win32') {
      return process.env.COMSPEC || 'powershell.exe';
    }
    return process.env.SHELL || '/bin/bash';
  }

  private getTitle(cmd: string, args: string[]): string {
    const base = cmd.split(/[/\\]/).pop() || cmd;
    if (base === 'claude' || base === 'claude.exe') return 'Claude';
    if (base === 'powershell.exe' || base === 'pwsh.exe' || base === 'pwsh') return 'PowerShell';
    if (base === 'cmd.exe') return 'Command Prompt';
    if (base === 'bash' || base === 'zsh' || base === 'fish') return base.charAt(0).toUpperCase() + base.slice(1);
    return args.length ? `${base} ${args.join(' ')}` : base;
  }
}
