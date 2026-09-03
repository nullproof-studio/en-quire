// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE

/**
 * Exit when the stdio client goes away.
 *
 * A stdio MCP server has exactly one client: the process that spawned it and
 * owns the other end of stdin. When that process exits — including a SIGKILL
 * or a hard crash, which no parent-side hook can cover — the kernel closes
 * the pipe and stdin emits `end`/`close`. The MCP SDK's StdioServerTransport
 * only listens for `data` and `error`, so without this the server has no
 * reason to exit and can be left orphaned if anything holds the event loop.
 *
 * Shutdown runs once, whichever signal fires first, and is bounded by a grace
 * timer so a hung cleanup (e.g. a blocked SQLite close) cannot keep the
 * process alive.
 */

export interface StdioLifecycleLog {
  info: (msg: string, meta?: Record<string, unknown>) => unknown;
  warn: (msg: string, meta?: Record<string, unknown>) => unknown;
}

export interface StdioLifecycleOptions {
  /** Releases resources before exit — close the database here. */
  cleanup: () => void | Promise<void>;
  /** The stdin the transport reads from. Defaults to process.stdin. */
  stdin?: NodeJS.ReadStream;
  /**
   * The low-level SDK Server (McpServer#server). Its `onclose` fires when the
   * transport closes for any reason, e.g. a read error on stdin.
   */
  server?: { onclose?: () => void };
  /** Defaults to process.exit. */
  exit?: (code: number) => void;
  /** Milliseconds cleanup may take before the process is force-exited. */
  graceMs?: number;
  log?: StdioLifecycleLog;
}

const DEFAULT_GRACE_MS = 2000;

/**
 * Install the handlers and return the shutdown function so callers can also
 * trigger it from SIGINT/SIGTERM. Exit code is 0 for a clean shutdown and 1
 * when cleanup threw or overran the grace timer.
 */
export function installStdioLifecycle(opts: StdioLifecycleOptions): (reason?: string) => void {
  const stdin = opts.stdin ?? process.stdin;
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const graceMs = opts.graceMs ?? DEFAULT_GRACE_MS;
  const log = opts.log;
  let shuttingDown = false;

  const shutdown = (reason = 'unknown'): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log?.info('Client went away — shutting down', { reason });

    const timer = setTimeout(() => {
      log?.warn('Cleanup did not finish within grace period — forcing exit', { grace_ms: graceMs });
      exit(1);
    }, graceMs);
    // Never let the watchdog itself be the thing that keeps the loop alive.
    timer.unref?.();

    void (async () => {
      let code = 0;
      try {
        await opts.cleanup();
      } catch (err) {
        code = 1;
        log?.warn('Cleanup failed during shutdown', { error: String(err) });
      }
      clearTimeout(timer);
      exit(code);
    })();
  };

  stdin.on('end', () => shutdown('stdin end'));
  stdin.on('close', () => shutdown('stdin close'));
  if (opts.server) {
    const prior = opts.server.onclose;
    opts.server.onclose = () => {
      prior?.();
      shutdown('transport closed');
    };
  }

  return shutdown;
}
