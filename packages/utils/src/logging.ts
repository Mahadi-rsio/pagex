// Logging utilities

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  service?: string;
  context?: Record<string, unknown>;
  error?: Error;
}

export interface LoggerConfig {
  service: string;
  level: LogLevel;
  pretty?: boolean;
  includeTimestamp?: boolean;
}

export class Logger {
  private config: LoggerConfig;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      service: 'unknown',
      level: 'info',
      pretty: true,
      includeTimestamp: true,
      ...config
    };
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    const currentLevelIndex = levels.indexOf(this.config.level);
    const targetLevelIndex = levels.indexOf(level);
    return targetLevelIndex >= currentLevelIndex;
  }

  private formatMessage(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: Error
  ): string {
    const timestamp = this.config.includeTimestamp 
      ? new Date().toISOString() 
      : '';
    
    const service = this.config.service;
    const contextStr = context && Object.keys(context).length > 0
      ? ` ${JSON.stringify(context)}`
      : '';
    const errorStr = error ? ` error=${error.message}` : '';
    
    if (this.config.pretty) {
      return `[${timestamp}] [${level.toUpperCase()}] [${service}] ${message}${contextStr}${errorStr}`;
    }
    
    return JSON.stringify({
      timestamp,
      level,
      service,
      message,
      context,
      error: error ? { message: error.message, stack: error.stack } : undefined
    });
  }

  debug(message: string, context?: Record<string, unknown>): void {
    if (!this.shouldLog('debug')) return;
    console.debug(this.formatMessage('debug', message, context));
  }

  info(message: string, context?: Record<string, unknown>): void {
    if (!this.shouldLog('info')) return;
    console.info(this.formatMessage('info', message, context));
  }

  warn(message: string, context?: Record<string, unknown>, error?: Error): void {
    if (!this.shouldLog('warn')) return;
    console.warn(this.formatMessage('warn', message, context, error));
  }

  error(message: string, context?: Record<string, unknown>, error?: Error): void {
    if (!this.shouldLog('error')) return;
    console.error(this.formatMessage('error', message, context, error));
  }

  // Child logger with additional context
  child(context: Record<string, unknown>): Logger {
    return new Logger({
      ...this.config,
      context: { ...this.config.context, ...context }
    });
  }
}

// Global logger instance
let globalLogger: Logger | null = null;

export function getLogger(config?: Partial<LoggerConfig>): Logger {
  if (!globalLogger) {
    globalLogger = new Logger(config);
  }
  return globalLogger;
}

export function setLogger(logger: Logger): void {
  globalLogger = logger;
}

// Create a logger for a specific service
export function createServiceLogger(service: string, level: LogLevel = 'info'): Logger {
  return new Logger({ service, level });
}
