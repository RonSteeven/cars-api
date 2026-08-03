import { pino, type Logger, type LoggerOptions } from 'pino';
import type { AppConfig } from '@/types/config.js';

export type { Logger } from 'pino';

const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'password',
  'mongo.uri',
  'MONGODB_URI',
];

export const createLogger = (config: AppConfig): Logger => {
  const options: LoggerOptions = {
    level: config.logging.level,
    base: { service: 'cars-api', env: config.env },
    redact: { paths: REDACTED_PATHS, remove: true },
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (config.logging.pretty) {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
      },
    });
  }

  return pino(options);
};
