// See LICENSE file in the project root for license information.

export class RstreamHTTPError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(`HTTP error ${status}: ${message}`);
    this.name = "RstreamHTTPError";
  }
}
