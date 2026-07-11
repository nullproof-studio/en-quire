// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { createLogger, format, transports, Logger } from 'winston';
import { join } from 'node:path';

export interface LoggingConfig {
  level: 'error' | 'warn' | 'info' | 'debug';
  dir: string | null; // null = no file logging (stderr only)
}

const DEFAULT_LOGGING: LoggingConfig = {
  level: 'info',
  dir: null,
};

let _logger: Logger | undefined;
let _productName = 'en-quire';

/**
 * Name of the binary currently running (e.g. "en-quire", "en-scribe"). Used
 * as the stderr log prefix and the leading tag on commit messages and
 * proposal-approval merge messages so git history records which product
 * produced each commit.
 *
 * Each bin sets this via initLogger(config, name) at startup.
 */
export function getProductName(): string {
  return _productName;
}

/**
 * Initialise the global logger.
 * Call once at startup. If `config.dir` is set, logs are also written to files
 * in that directory (combined.log + error.log).
 *
 * `name` is the tag that prefixes each stderr line (e.g. "[en-quire]",
 * "[en-scribe]"). Each bin should pass its own so operators can tell which
 * process produced a line when the two MCPs run side by side.
 */
export function initLogger(config: LoggingConfig = DEFAULT_LOGGING, name = 'en-quire'): Logger {
  _productName = name;
  const logTransports: transports.StreamTransportInstance[] = [];

  // Always log to stderr (keeps stdout clean for stdio MCP transport)
  logTransports.push(
    new transports.Console({
      stderrLevels: ['error', 'warn', 'info', 'debug'],
      format: format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `[${name}] ${timestamp} ${level}: ${message}${metaStr}`;
        }),
      ),
    }),
  );

  // Optionally log to files
  if (config.dir) {
    const fileFormat = format.combine(
      format.timestamp(),
      format.json(),
    );

    logTransports.push(
      new transports.File({
        filename: join(config.dir, 'error.log'),
        level: 'error',
        format: fileFormat,
        maxsize: 10 * 1024 * 1024, // 10 MB
        maxFiles: 5,
      }) as unknown as transports.StreamTransportInstance,
      new transports.File({
        filename: join(config.dir, 'combined.log'),
        format: fileFormat,
        maxsize: 10 * 1024 * 1024,
        maxFiles: 10,
      }) as unknown as transports.StreamTransportInstance,
    );
  }

  _logger = createLogger({
    level: config.level,
    transports: logTransports,
  });

  return _logger;
}

/**
 * Get the global logger instance.
 * If not yet initialised, creates a default stderr-only logger.
 */
export function getLogger(): Logger {
  if (!_logger) {
    _logger = initLogger();
  }
  return _logger;
}
