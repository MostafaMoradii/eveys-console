import { pino, type Logger, type LoggerOptions } from 'pino';

import type { Config } from './config.js';

export function buildLogger(cfg: Pick<Config, 'LOG_LEVEL' | 'LOG_PRETTY'>): Logger {
  const opts: LoggerOptions = {
    level: cfg.LOG_LEVEL,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', '*.token', '*.secret'],
      remove: true,
    },
  };
  if (cfg.LOG_PRETTY) {
    opts.transport = {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss.l' },
    };
  }
  return pino(opts);
}

export type { Logger } from 'pino';
