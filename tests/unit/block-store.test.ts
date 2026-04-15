import { describe, it, expect, beforeEach } from 'vitest';
import { BlockStore } from '../../packages/core/src/block-store.js';

const ESC = '\x1b';
const BEL = '\x07';
const ST = ESC + '\\';

function osc(body: string, terminator = BEL): string {
  return ESC + ']' + body + terminator;
}

describe('BlockStore', () => {
  let store: BlockStore;

  beforeEach(() => {
    store = new BlockStore();
  });

  it('creates a synthetic streaming block for output without OSC markers', () => {
    store.feed('t1', 'hello world');
    const list = store.list('t1');
    expect(list).toHaveLength(1);
    expect(list[0].output).toBe('hello world');
    expect(list[0].command).toBe('');
    expect(list[0].endedAt).toBeNull();
  });

  it('parses OSC 133 A/B/C/D as a full command block', () => {
    const seq =
      osc('133;A') +
      osc('133;B') +
      'ls -la' +
      osc('133;C') +
      'file1\nfile2\n' +
      osc('133;D;0');
    store.feed('t1', seq);
    const list = store.list('t1');
    expect(list).toHaveLength(1);
    expect(list[0].command).toBe('ls -la');
    expect(list[0].output).toBe('file1\nfile2\n');
    expect(list[0].exitCode).toBe(0);
    expect(list[0].endedAt).not.toBeNull();
  });

  it('records non-zero exit codes', () => {
    store.feed(
      't1',
      osc('133;B') + 'false' + osc('133;C') + osc('133;D;1'),
    );
    expect(store.list('t1')[0].exitCode).toBe(1);
  });

  it('handles OSC sequences split across feeds', () => {
    const full = osc('133;B') + 'echo x' + osc('133;C') + 'x\n' + osc('133;D;0');
    for (let i = 0; i < full.length; i++) {
      store.feed('t1', full.charAt(i));
    }
    const list = store.list('t1');
    expect(list).toHaveLength(1);
    expect(list[0].command).toBe('echo x');
    expect(list[0].output).toBe('x\n');
    expect(list[0].exitCode).toBe(0);
  });

  it('accepts both BEL and ESC\\ as OSC terminators', () => {
    const seq =
      osc('133;B', BEL) +
      'echo y' +
      osc('133;C', ST) +
      'y\n' +
      osc('133;D;0', ST);
    store.feed('t1', seq);
    const list = store.list('t1');
    expect(list).toHaveLength(1);
    expect(list[0].command).toBe('echo y');
    expect(list[0].exitCode).toBe(0);
  });

  it('captures cwd from OSC 7', () => {
    store.feed('t1', osc('7;file://host/home/user/proj'));
    store.feed('t1', osc('133;B') + 'pwd' + osc('133;C') + '/home/user/proj\n' + osc('133;D;0'));
    const b = store.list('t1')[0];
    expect(b.cwd).toBe('/home/user/proj');
  });

  it('closes any open block when a new prompt (OSC 133;A) arrives', () => {
    store.feed('t1', osc('133;B') + 'long-cmd' + osc('133;C') + 'partial output');
    // User Ctrl+C — no OSC 133;D; next prompt lands
    store.feed('t1', osc('133;A'));
    const list = store.list('t1');
    expect(list).toHaveLength(1);
    expect(list[0].endedAt).not.toBeNull();
    expect(list[0].exitCode).toBeNull();
  });

  it('emits new + update events via subscribe()', () => {
    const events: string[] = [];
    store.subscribe((ev) => events.push(ev.kind));
    store.feed('t1', osc('133;B') + 'ls' + osc('133;C') + 'a\n' + osc('133;D;0'));
    expect(events[0]).toBe('new');
    expect(events).toContain('update');
  });

  it('filters by terminal in list()', () => {
    store.feed('t1', osc('133;B') + 'a' + osc('133;C') + osc('133;D;0'));
    store.feed('t2', osc('133;B') + 'b' + osc('133;C') + osc('133;D;0'));
    expect(store.list('t1')).toHaveLength(1);
    expect(store.list('t2')).toHaveLength(1);
    expect(store.list()).toHaveLength(2);
  });

  it('clear() drops all blocks for a terminal', () => {
    store.feed('t1', osc('133;B') + 'x' + osc('133;C') + osc('133;D;0'));
    store.clear('t1');
    expect(store.list('t1')).toHaveLength(0);
  });

  it('search() matches output and command text', () => {
    store.feed('t1', osc('133;B') + 'grep foo' + osc('133;C') + 'matched line\n' + osc('133;D;0'));
    const hits = store.search('foo');
    expect(hits).toHaveLength(1);
    expect(hits[0].matches).toBeGreaterThan(0);
  });

  it('search() supports case-insensitive and regex modes', () => {
    store.feed('t1', osc('133;B') + 'cmd' + osc('133;C') + 'Hello World\n' + osc('133;D;0'));
    expect(store.search('hello').length).toBe(1);
    expect(store.search('HELLO', { caseSensitive: true }).length).toBe(0);
    expect(store.search('H\\w+', { regex: true }).length).toBe(1);
  });

  it('startBlock/endBlock drive synthetic blocks without OSC', () => {
    const b = store.startBlock('t1', 'make');
    expect(b.command).toBe('make');
    store.feed('t1', 'build output\n');
    store.endBlock('t1', 0);
    const list = store.list('t1');
    expect(list).toHaveLength(1);
    expect(list[0].command).toBe('make');
    expect(list[0].output).toBe('build output\n');
    expect(list[0].exitCode).toBe(0);
  });

  it('incrementToolCall attributes to the currently-open block', () => {
    store.feed('t1', osc('133;B') + 'claude' + osc('133;C'));
    store.incrementToolCall('t1');
    store.incrementToolCall('t1');
    const b = store.list('t1')[0];
    expect(b.toolCalls).toBe(2);
  });
});
