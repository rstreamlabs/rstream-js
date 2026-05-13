// See LICENSE file in the project root for license information.

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug?: (message: string, fields?: LogFields) => void;
  info?: (message: string, fields?: LogFields) => void;
  warn?: (message: string, fields?: LogFields) => void;
  error?: (message: string, fields?: LogFields) => void;
}

export const noopLogger: Required<Logger> = {
  debug: () => undefined,
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
};

export function resolveLogger(logger?: Logger): Required<Logger> {
  return {
    debug: logger?.debug ?? noopLogger.debug,
    error: logger?.error ?? noopLogger.error,
    info: logger?.info ?? noopLogger.info,
    warn: logger?.warn ?? noopLogger.warn,
  };
}
