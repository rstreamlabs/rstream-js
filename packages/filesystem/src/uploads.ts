// See LICENSE file in the project root for license information.

import { z } from "zod";

const uploadID = z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/);
const byteCount = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine((value) => BigInt(value) <= 9223372036854775807n);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z
  .string()
  .min(2)
  .max(1024)
  .refine(
    (value) =>
      value.startsWith('"') &&
      value.endsWith('"') &&
      [...value.slice(1, -1)].every(
        (char) =>
          char !== '"' && char.charCodeAt(0) > 32 && char.charCodeAt(0) !== 127,
      ),
  );

export interface FileSystemUploadOptions {
  id: string;
  sizeBytes: string;
  sha256: string;
  /** null means create only. A revision means replace that exact content. */
  expectedRevision: string | null;
  contentType?: string;
  signal?: AbortSignal;
}

export type FileSystemUploadReceipt = Readonly<{
  id: string;
  path: string;
  state:
    | "receiving"
    | "prepared"
    | "committed"
    | "rejected"
    | "interrupted"
    | "uncertain";
  status: number;
  sizeBytes: string;
  sha256: string;
  revision: string | null;
  startedAt: string;
  completedAt: string | null;
}>;

export function uploadHeaders(options: FileSystemUploadOptions): Headers {
  uploadID.parse(options.id);
  byteCount.parse(options.sizeBytes);
  digest.parse(options.sha256);
  const headers = conditionHeaders(options.expectedRevision);
  headers.set("File-System-Action", "put");
  headers.set("Upload-Id", options.id);
  headers.set("Upload-Length", options.sizeBytes);
  headers.set(
    "Content-Digest",
    `sha-256=:${btoa(String.fromCharCode(...options.sha256.match(/../g)!.map((value) => Number.parseInt(value, 16))))}:`,
  );
  if (options.contentType) headers.set("Content-Type", options.contentType);
  return headers;
}

export function conditionHeaders(expectedRevision: string | null): Headers {
  return new Headers(
    expectedRevision === null
      ? { "If-None-Match": "*" }
      : { "If-Match": revision.parse(expectedRevision) },
  );
}

export function receiptIdentity(id: string): string {
  return uploadID.parse(id);
}

const receiptSchema = z
  .object({
    id: uploadID,
    path: z.string().min(1).max(4096),
    state: z.enum([
      "receiving",
      "prepared",
      "committed",
      "rejected",
      "interrupted",
      "uncertain",
    ]),
    status: z.number().int().min(0).max(599),
    size_bytes: byteCount,
    sha256: digest,
    revision: revision.optional(),
    started_at: z.iso.datetime(),
    completed_at: z.iso.datetime().optional(),
  })
  .superRefine((value, ctx) => {
    const active = value.state === "receiving" || value.state === "prepared";
    const valid = active
      ? value.status === 0 &&
        value.completed_at === undefined &&
        value.revision === undefined
      : value.completed_at !== undefined &&
        (value.state === "committed"
          ? value.status === 201 &&
            value.revision === `"sha256-${value.sha256}"`
          : value.status >= 400 && value.revision === undefined);
    if (!valid)
      ctx.addIssue({
        code: "custom",
        message: "Inconsistent upload receipt outcome",
      });
  });

// A receipt is bounded metadata, never a file body. Its binding is validated
// before it can be used as evidence for a different request or destination.
export async function readUploadReceipt(
  response: Response,
  id: string,
  path: string,
): Promise<FileSystemUploadReceipt> {
  if (response.headers.get("Upload-Protocol") !== "durable-v1") {
    await response.body?.cancel();
    throw new Error("The owner did not confirm the durable upload protocol.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Upload receipt body is missing.");
  const bytes = new Uint8Array(16384);
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (size + chunk.value.byteLength > bytes.length)
        throw new Error("Upload receipt is too large.");
      bytes.set(chunk.value, size);
      size += chunk.value.byteLength;
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const value = receiptSchema.parse(
    JSON.parse(new TextDecoder().decode(bytes.subarray(0, size))),
  );
  const expectedPath =
    path
      .split("/")
      .filter((value) => value !== "" && value !== ".")
      .join("/") || ".";
  if (value.id !== id || value.path !== expectedPath)
    throw new Error("Upload receipt identity or destination changed.");
  return {
    id: value.id,
    path: value.path,
    state: value.state,
    status: value.status,
    sizeBytes: value.size_bytes,
    sha256: value.sha256,
    revision: value.revision ?? null,
    startedAt: value.started_at,
    completedAt: value.completed_at ?? null,
  };
}
