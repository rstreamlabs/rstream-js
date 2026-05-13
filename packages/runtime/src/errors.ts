// See LICENSE file in the project root for license information.

export interface RuntimeErrorOptions {
  code: string;
  cause?: unknown;
  details?: Record<string, unknown>;
}

export class RuntimeError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, options: RuntimeErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "RuntimeError";
    this.code = options.code;
    this.details = options.details;
  }
}

export class EngineError extends RuntimeError {
  public readonly engineCode: number;

  constructor(engineCode: number, message: string) {
    super(message, {
      code: "ERR_RSTREAM_ENGINE",
      details: { engineCode },
    });
    this.name = "EngineError";
    this.engineCode = engineCode;
  }
}

export function abortError(message = "Operation aborted."): Error {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
