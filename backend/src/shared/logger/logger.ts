type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

interface LogContext {
  [key: string]: unknown;
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatContext(context?: LogContext): string {
  if (!context || Object.keys(context).length === 0) {
    return '';
  }

  return ` ${JSON.stringify(context)}`;
}

function log(level: LogLevel, message: string, context?: LogContext): void {
  const timestamp = formatTimestamp();

  const output = `[${timestamp}] [${level}] ${message}` + formatContext(context);

  switch (level) {
    case 'ERROR':
      console.error(output);
      break;

    case 'WARN':
      console.warn(output);
      break;

    case 'DEBUG':
      console.debug(output);
      break;

    default:
      console.log(output);
  }
}

export const logger = {
  info(message: string, context?: LogContext): void {
    log('INFO', message, context);
  },

  warn(message: string, context?: LogContext): void {
    log('WARN', message, context);
  },

  error(message: string, context?: LogContext): void {
    log('ERROR', message, context);
  },

  debug(message: string, context?: LogContext): void {
    log('DEBUG', message, context);
  },
};
