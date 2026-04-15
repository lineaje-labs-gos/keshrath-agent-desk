// Block store + OSC 133 / OSC 7 parser.
//
// One block = one command invocation + its output. Framed by shell-integration
// escape sequences:
//
//   OSC 133 ; A ST   prompt start        → close any open block
//   OSC 133 ; B ST   command start       → begin new block (command text up to next OSC 133;C)
//   OSC 133 ; C ST   command executed    → stop capturing command text, start capturing output
//   OSC 133 ; D [; N] ST   command end   → close block with optional exit code
//
//   OSC 7 ; file://host/PATH ST          → update cwd
//
// ST terminator is either ESC \ (0x1b 0x5c) or BEL (0x07).
//
// The parser is byte-stream stateful per terminal: OSC sequences may split
// across feed() calls. When a sequence is incomplete, the remainder is
// stashed in pending state and resumed on the next feed.
//
// Output text (not part of any OSC) is appended to the currently-open block,
// with ANSI CSI sequences kept intact. If no block is open, a synthetic
// streaming block is created so early output isn't lost.

import { randomUUID } from 'node:crypto';
import type { TerminalBlock, BlockSearchMatch } from './transport/channels.js';

const PER_TERMINAL_MAX = 2_000;

type BlockListener = (
  ev: { kind: 'new'; block: TerminalBlock } | { kind: 'update'; blockId: string; patch: Partial<TerminalBlock> },
) => void;

interface ParserState {
  /** Unparsed remainder from a truncated OSC sequence across feed boundaries. */
  pending: string;
  /** If true, the open block is still capturing command text (between OSC 133;B and OSC 133;C). */
  capturingCommand: boolean;
  /** Most recently captured cwd for this terminal (from OSC 7). */
  cwd: string | null;
}

export class BlockStore {
  private blocks = new Map<string, TerminalBlock>();
  private byTerminal = new Map<string, string[]>();
  private openBlockByTerminal = new Map<string, string>();
  private parsers = new Map<string, ParserState>();
  private listeners = new Set<BlockListener>();

  subscribe(fn: BlockListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(ev: Parameters<BlockListener>[0]): void {
    for (const l of this.listeners) {
      try {
        l(ev);
      } catch {
        // listener errors must not break the store
      }
    }
  }

  private getParser(terminalId: string): ParserState {
    let p = this.parsers.get(terminalId);
    if (!p) {
      p = { pending: '', capturingCommand: false, cwd: null };
      this.parsers.set(terminalId, p);
    }
    return p;
  }

  /**
   * Feed raw terminal output. Segments text into OSC sequences vs normal
   * output, drives the block state machine, and appends output bytes to
   * the currently open block.
   */
  feed(terminalId: string, chunk: string, fallbackCwd: string | null = null): void {
    if (!chunk) return;
    const p = this.getParser(terminalId);
    if (fallbackCwd && !p.cwd) p.cwd = fallbackCwd;
    const buf = p.pending + chunk;
    p.pending = '';
    let i = 0;

    while (i < buf.length) {
      const escIdx = buf.indexOf('\x1b', i);
      if (escIdx < 0) {
        this.appendOutput(terminalId, buf.slice(i));
        break;
      }

      if (escIdx > i) {
        this.appendOutput(terminalId, buf.slice(i, escIdx));
      }

      // We have an ESC. Need at least one more char to know if this is an OSC.
      if (escIdx === buf.length - 1) {
        p.pending = buf.slice(escIdx);
        break;
      }

      if (buf.charAt(escIdx + 1) !== ']') {
        // Not an OSC — emit the ESC as plain output and continue.
        this.appendOutput(terminalId, buf.charAt(escIdx));
        i = escIdx + 1;
        continue;
      }

      const termEscBackslash = buf.indexOf('\x1b\\', escIdx + 2);
      const termBel = buf.indexOf('\x07', escIdx + 2);
      let end = -1;
      let termLen = 0;
      if (termEscBackslash >= 0 && (termBel < 0 || termEscBackslash < termBel)) {
        end = termEscBackslash;
        termLen = 2;
      } else if (termBel >= 0) {
        end = termBel;
        termLen = 1;
      }

      if (end < 0) {
        p.pending = buf.slice(escIdx);
        break;
      }

      const body = buf.slice(escIdx + 2, end);
      this.handleOsc(terminalId, body);
      i = end + termLen;
    }
  }

  private handleOsc(terminalId: string, body: string): void {
    // OSC 7 ; file://host/PATH — cwd update
    if (body.startsWith('7;')) {
      const url = body.slice(2);
      const m = /^file:\/\/[^/]*(\/.+)$/.exec(url);
      if (m) {
        const path = decodeURIComponent(m[1]);
        const p = this.getParser(terminalId);
        p.cwd = path;
        const open = this.currentOpen(terminalId);
        if (open && !open.cwd) {
          open.cwd = path;
          this.emit({ kind: 'update', blockId: open.id, patch: { cwd: path } });
        }
      }
      return;
    }

    // OSC 133 ; X [; args]
    if (body.startsWith('133;')) {
      const rest = body.slice(4);
      const kind = rest.charAt(0);
      const args = rest.length > 1 && rest.charAt(1) === ';' ? rest.slice(2) : '';
      const p = this.getParser(terminalId);
      switch (kind) {
        case 'A':
          // Prompt starts — close any open block as interrupted if it had no end
          this.closeOpen(terminalId, null);
          p.capturingCommand = false;
          return;
        case 'B':
          // Command start — begin a new block. Command text may follow as output
          // until OSC 133;C lands.
          this.closeOpen(terminalId, null);
          this.createBlock(terminalId, '', p.cwd);
          p.capturingCommand = true;
          return;
        case 'C': {
          // Command executed — freeze captured command-line text into `command`
          const open = this.currentOpen(terminalId);
          if (open && p.capturingCommand) {
            // Everything written to `output` during the B→C phase is the command line
            const cmd = stripAnsi(open.output).trim();
            open.command = cmd;
            open.output = '';
            open.byteCount = 0;
            this.emit({
              kind: 'update',
              blockId: open.id,
              patch: { command: cmd, output: '', byteCount: 0 },
            });
          }
          p.capturingCommand = false;
          return;
        }
        case 'D': {
          const code = args ? parseInt(args.split(';')[0], 10) : NaN;
          this.closeOpen(terminalId, Number.isFinite(code) ? code : null);
          p.capturingCommand = false;
          return;
        }
      }
    }
  }

  private appendOutput(terminalId: string, text: string): void {
    if (!text) return;
    let open = this.currentOpen(terminalId);
    if (!open) {
      open = this.createBlock(terminalId, '', this.getParser(terminalId).cwd);
    }
    open.output += text;
    open.byteCount = open.output.length;
    this.emit({
      kind: 'update',
      blockId: open.id,
      patch: { output: open.output, byteCount: open.byteCount },
    });
  }

  private currentOpen(terminalId: string): TerminalBlock | null {
    const id = this.openBlockByTerminal.get(terminalId);
    if (!id) return null;
    return this.blocks.get(id) ?? null;
  }

  /**
   * Explicit command-boundary entrypoints (for hosts that prefer to feed
   * structured events instead of raw OSC bytes, e.g. synthetic test harnesses).
   */
  startBlock(terminalId: string, command: string, cwd: string | null = null): TerminalBlock {
    this.closeOpen(terminalId, null);
    return this.createBlock(terminalId, command, cwd);
  }

  endBlock(terminalId: string, exitCode: number | null): TerminalBlock | null {
    return this.closeOpen(terminalId, exitCode);
  }

  list(terminalId?: string, limit = 500): TerminalBlock[] {
    if (terminalId) {
      const ids = this.byTerminal.get(terminalId) ?? [];
      return ids
        .slice(-limit)
        .map((id) => this.blocks.get(id)!)
        .filter(Boolean);
    }
    const all: TerminalBlock[] = [];
    for (const ids of this.byTerminal.values()) {
      for (const id of ids) {
        const b = this.blocks.get(id);
        if (b) all.push(b);
      }
    }
    all.sort((a, b) => a.startedAt - b.startedAt);
    return all.slice(-limit);
  }

  get(blockId: string): TerminalBlock | null {
    return this.blocks.get(blockId) ?? null;
  }

  search(
    query: string,
    opts: { terminalId?: string; caseSensitive?: boolean; regex?: boolean } = {},
  ): BlockSearchMatch[] {
    if (!query) return [];
    const scope = this.list(opts.terminalId, 5_000);
    const rx = this.buildMatcher(query, opts);
    if (!rx) return [];
    const out: BlockSearchMatch[] = [];
    for (const block of scope) {
      const matches = this.countMatches(block.output, rx) + this.countMatches(block.command, rx);
      if (matches > 0) out.push({ block, matches });
    }
    return out;
  }

  clear(terminalId: string): void {
    const ids = this.byTerminal.get(terminalId);
    if (ids) {
      for (const id of ids) this.blocks.delete(id);
      this.byTerminal.delete(terminalId);
    }
    this.openBlockByTerminal.delete(terminalId);
    this.parsers.delete(terminalId);
  }

  incrementToolCall(terminalId: string): void {
    const open = this.currentOpen(terminalId);
    if (!open) return;
    open.toolCalls += 1;
    this.emit({ kind: 'update', blockId: open.id, patch: { toolCalls: open.toolCalls } });
  }

  /** Test hook. */
  _reset(): void {
    this.blocks.clear();
    this.byTerminal.clear();
    this.openBlockByTerminal.clear();
    this.parsers.clear();
  }

  // ---------------------------------------------------------------------

  private createBlock(terminalId: string, command: string, cwd: string | null): TerminalBlock {
    const block: TerminalBlock = {
      id: randomUUID(),
      terminalId,
      command,
      cwd,
      startedAt: Date.now(),
      endedAt: null,
      exitCode: null,
      output: '',
      byteCount: 0,
      toolCalls: 0,
    };
    this.blocks.set(block.id, block);
    const ids = this.byTerminal.get(terminalId) ?? [];
    ids.push(block.id);
    if (ids.length > PER_TERMINAL_MAX) {
      const dropped = ids.shift()!;
      this.blocks.delete(dropped);
    }
    this.byTerminal.set(terminalId, ids);
    this.openBlockByTerminal.set(terminalId, block.id);
    this.emit({ kind: 'new', block });
    return block;
  }

  private closeOpen(terminalId: string, exitCode: number | null): TerminalBlock | null {
    const openId = this.openBlockByTerminal.get(terminalId);
    if (!openId) return null;
    const b = this.blocks.get(openId);
    this.openBlockByTerminal.delete(terminalId);
    if (!b) return null;
    b.endedAt = Date.now();
    b.exitCode = exitCode;
    this.emit({
      kind: 'update',
      blockId: b.id,
      patch: { endedAt: b.endedAt, exitCode: b.exitCode },
    });
    return b;
  }

  private buildMatcher(query: string, opts: { caseSensitive?: boolean; regex?: boolean }): RegExp | null {
    const flags = opts.caseSensitive ? 'g' : 'gi';
    try {
      if (opts.regex) return new RegExp(query, flags);
      return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    } catch {
      return null;
    }
  }

  private countMatches(text: string, rx: RegExp): number {
    if (!text) return 0;
    const m = text.match(rx);
    return m ? m.length : 0;
  }
}

// eslint-disable-next-line no-control-regex
const ANSI_RX = /\x1b\[[0-9;?]*[A-Za-z]/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_RX, '');
}

export const blockStore = new BlockStore();
