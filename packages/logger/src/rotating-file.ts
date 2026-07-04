import { appendFileSync, existsSync, renameSync, statSync, unlinkSync } from "node:fs";
import { Writable } from "node:stream";

export type RotatingFileOptions = {
  /** File path to append to. Rotated backups are `<path>.1`, `<path>.2`, … (`.1` is the most recent). */
  path: string;
  /** Max bytes per file before rotation. Default 50 MB. */
  maxSize?: number;
  /** Rotated backups to keep. Default 5. */
  maxBackups?: number;
};

const DEFAULT_MAX_SIZE = 50 * 1024 * 1024;
const DEFAULT_MAX_BACKUPS = 5;

/** A pino-agnostic append + rotate destination. Writes lines to `path`; when a write would exceed
 *  `maxSize`, rotates — `path` becomes `path.1`, `path.1` → `path.2`, …, the oldest
 *  (`path.<maxBackups>`) is dropped, a fresh `path` is opened. Used as a plain Writable in a pino
 *  `multistream` so it composes with the stderr sink without disturbing the logger's instance-level
 *  options (a pino-roll *transport* would run in a worker thread and fight those).
 *
 *  Writes are **synchronous** (`appendFileSync` + sync renames). This is deliberate: an async
 *  WriteStream opens its file lazily, which races with synchronous rotation (the next rotate's
 *  rename can run before a pending open lands, scattering lines across the wrong file). Sync I/O is
 *  correct + deterministic; the cost is negligible at a local-first daemon's log volume (warn/error
 *  + occasional info — a few lines/sec at most). Revisit with a buffered async sink (anytype's
 *  lumberjack shape) only if profiling shows log I/O on the hot path. */
export function rotatingFileDestination(opts: RotatingFileOptions): Writable {
  const path = opts.path;
  const maxSize = opts.maxSize ?? DEFAULT_MAX_SIZE;
  const maxBackups = opts.maxBackups ?? DEFAULT_MAX_BACKUPS;
  let bytes = existsSync(path) ? statSync(path).size : 0;

  const rotate = (): void => {
    if (existsSync(`${path}.${maxBackups}`)) {
      unlinkSync(`${path}.${maxBackups}`);
    }
    for (let i = maxBackups - 1; i >= 1; i--) {
      if (existsSync(`${path}.${i}`)) {
        renameSync(`${path}.${i}`, `${path}.${i + 1}`);
      }
    }
    if (existsSync(path)) {
      renameSync(path, `${path}.1`);
    }
    bytes = 0;
  };

  return new Writable({
    write(chunk: Uint8Array | string, _encoding: BufferEncoding, callback): void {
      const byteLength = typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
      if (bytes > 0 && bytes + byteLength > maxSize) {
        rotate();
      }
      appendFileSync(path, chunk);
      bytes += byteLength;
      callback();
    },
  });
}
