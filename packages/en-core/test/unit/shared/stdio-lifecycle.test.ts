// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { installStdioLifecycle } from '@nullproof-studio/en-core';

function setup(overrides: Partial<Parameters<typeof installStdioLifecycle>[0]> = {}) {
  const stdin = new EventEmitter();
  const server: { onclose?: () => void } = {};
  const cleanup = vi.fn(async () => {});
  const exit = vi.fn();
  const log = { info: vi.fn(), warn: vi.fn() };
  const shutdown = installStdioLifecycle({
    stdin: stdin as unknown as NodeJS.ReadStream,
    server,
    cleanup,
    exit,
    log,
    graceMs: 50,
    ...overrides,
  });
  return { stdin, server, cleanup, exit, log, shutdown };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('installStdioLifecycle', () => {
  it('runs cleanup and exits 0 when stdin ends', async () => {
    const { stdin, cleanup, exit } = setup();
    stdin.emit('end');
    await tick();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('runs cleanup and exits 0 when stdin closes without an end event', async () => {
    const { stdin, cleanup, exit } = setup();
    stdin.emit('close');
    await tick();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('runs cleanup and exits 0 when the MCP server reports close', async () => {
    const { server, cleanup, exit } = setup();
    expect(server.onclose).toBeTypeOf('function');
    server.onclose!();
    await tick();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('is idempotent: end followed by close only cleans up and exits once', async () => {
    const { stdin, server, cleanup, exit } = setup();
    stdin.emit('end');
    stdin.emit('close');
    server.onclose!();
    await tick();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('force-exits 1 when cleanup hangs past the grace timer', async () => {
    const hang = vi.fn(() => new Promise<void>(() => {}));
    const { stdin, exit, log } = setup({ cleanup: hang, graceMs: 20 });
    stdin.emit('end');
    await new Promise((r) => setTimeout(r, 60));
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(log.warn).toHaveBeenCalled();
  });

  it('still exits when cleanup throws', async () => {
    const boom = vi.fn(async () => { throw new Error('db close failed'); });
    const { stdin, exit, log } = setup({ cleanup: boom });
    stdin.emit('end');
    await tick();
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(log.warn).toHaveBeenCalled();
  });

  it('does not exit on its own before any close signal', async () => {
    const { exit } = setup();
    await new Promise((r) => setTimeout(r, 80));
    expect(exit).not.toHaveBeenCalled();
  });
});
