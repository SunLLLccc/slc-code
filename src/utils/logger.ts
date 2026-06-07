// Console-based logger with test environment suppression

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function isTestEnvironment(): boolean {
  return (
    typeof process !== "undefined" &&
    (process.env["NODE_ENV"] === "test" ||
      typeof process.env["VITEST"] !== "undefined")
  );
}

function formatMessage(level: LogLevel, message: string): string {
  const timestamp = new Date().toISOString();
  return `[${level}] [${timestamp}] ${message}`;
}

export class Logger {
  private level: LogLevel = "info";
  private silent: boolean;

  constructor() {
    this.silent = isTestEnvironment();
  }

  setLogLevel(level: LogLevel): void {
    this.level = level;
  }

  setSilent(silent: boolean): void {
    this.silent = silent;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.level];
  }

  private output(level: LogLevel, message: string): void {
    if (this.silent || !this.shouldLog(level)) return;
    const formatted = formatMessage(level, message);

    switch (level) {
      case "debug":
      case "info":
        process.stdout.write(formatted + "\n");
        break;
      case "warn":
      case "error":
        process.stderr.write(formatted + "\n");
        break;
    }
  }

  debug(message: string): void {
    this.output("debug", message);
  }

  info(message: string): void {
    this.output("info", message);
  }

  warn(message: string): void {
    this.output("warn", message);
  }

  error(message: string): void {
    this.output("error", message);
  }
}

export const logger = new Logger();

export function setLogLevel(level: LogLevel): void {
  logger.setLogLevel(level);
}
