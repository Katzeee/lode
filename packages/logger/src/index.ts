// @lode/logger — the cross-cutting logging facade (mirrors any-sync's `app/logger` role: a neutral
// leaf every layer imports). Hides pino behind our own `Logger` type so call sites never touch
// pino directly — swapping the engine later is one package, not a sweep.
//
// Component identity lives in the NAME (any-sync's `var log = NewNamed("...")` convention), not in
// fields: `createLogger("sync.runner")`. Per-ws / per-peer context flows as fields via `child(...)`.
// Levels come from the `LODE_LOG` env var (per-prefix glob; see `levels.ts`). Default `*=warn`.
//
// Sink: JSON to **stderr** by default. The host (daemon) calls `configureLogger({ file })` at
// process entry to add a rotating file sink alongside stderr. The pino instance is built LAZILY on
// the first log emit, so `configureLogger` need only run before the first log — the daemon calls it
// at bin startup, well before any sync round emits; modules that grab a logger at import time are
// unaffected (their pino is built later, when the sink is already chosen).

import pino, { type Logger as PinoLogger } from "pino";
import { parseLevelSpec, resolveLevel, type Level, type LevelRule } from "./levels.js";
import { rotatingFileDestination, type RotatingFileOptions } from "./rotating-file.js";

export type { Level } from "./levels.js";
export type { RotatingFileOptions } from "./rotating-file.js";

/** Structured fields passed alongside a message (`{ wsId, peerId, err }`). pino's object API is the
 *  vocabulary — no helper module (anytype-heart uses raw fields; any-sync's `metric/log.go` helpers
 *  buy little over pino's object style). Reserved keys: `wsId`, `peerId`, `docId`, `relay`, `err`. */
export type LogFields = Record<string, unknown>;

export type Logger = {
  child(bindings: LogFields): Logger;
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
};

const DEFAULT_LEVEL: Level = "warn";

// Read once at module load — env is stable for the process lifetime. Call sites that need a
// different level in tests vary `LODE_LOG` and re-import (the standard vitest pattern); the pure
// `parseLevelSpec` / `resolveLevel` are unit-tested directly without env coupling.
const levelRules: LevelRule[] = parseLevelSpec(process.env.LODE_LOG ?? "");

/** The file-sink config set by `configureLogger` (undefined → stderr only). Read at the first-log
 *  pino build, NOT at `createLogger` time, so import order doesn't matter. */
let fileSink: RotatingFileOptions | undefined;

/** Configure the sinks. Call ONCE at process entry, before the first log emit. Default (or not
 *  called): JSON to stderr. With `file`: adds a size-rotated file sink ALONGSIDE stderr (a foreground
 *  process still shows logs in the terminal while they persist to disk). Mirrors anytype's dual
 *  stderr+file sink — the file/rotation MECHANISM is the logger's, the CHOICE is the host's. */
export function configureLogger(opts?: { file?: RotatingFileOptions }): void {
  fileSink = opts?.file;
}

/** Coerce a thrown value to a serializable shape. Errors get pino's standard treatment
 *  (type/message/stack); anything else (a string, null, a plain object thrown without `new Error`) is
 *  stringified so a non-Error throw never misrenders or loses context. Catch sites pass `unknown`, so
 *  this is where the narrowing happens. */
function errSerializer(err: unknown): unknown {
  return err instanceof Error ? pino.stdSerializers.err(err) : { value: String(err) };
}

function buildPino(component: string, level: Level): PinoLogger {
  const opts = {
    name: component,
    level,
    // Drop `hostname` (pure noise for a local-first single-process daemon; no fleet to correlate
    // against). Keep `pid` — useful when tests run several daemons in one process group.
    base: { pid: process.pid },
    serializers: { err: errSerializer },
    // String level labels (`"warn"`) instead of pino's int codes — matches the `*=warn` mental
    // model and is friendlier to grep / jq.
    formatters: { level: (label: string) => ({ level: label }) },
  };
  const stderr = pino.destination(2); // fd 2 = stderr
  if (!fileSink) {
    return pino(opts, stderr);
  }
  // stderr + rotating file. multistream so the instance-level opts (formatters/serializers/base)
  // apply to both — a pino-roll *transport* would run in a worker thread and fight them.
  return pino(
    opts,
    pino.multistream([{ stream: stderr }, { stream: rotatingFileDestination(fileSink) }]),
  );
}

/** Memoized by component name — mirrors any-sync's `NewNamed` registry (`log.go:84`): the name IS the
 *  identity, so two calls with the same name return the same logger. The pino instance is built
 *  lazily on first emit (root loggers) or supplied directly (children). */
class PinoLoggerWrapper implements Logger {
  private pino?: PinoLogger;
  constructor(
    private readonly component: string,
    private readonly level: Level,
    /** Provided for children (built from the parent's pino); undefined for roots (lazy-built). */
    pino?: PinoLogger,
  ) {
    this.pino = pino;
  }

  private log(): PinoLogger {
    if (!this.pino) {
      this.pino = buildPino(this.component, this.level);
    }
    return this.pino;
  }

  child(bindings: LogFields): Logger {
    return new PinoLoggerWrapper(this.component, this.level, this.log().child(bindings));
  }

  debug(msg: string, fields?: LogFields): void {
    this.log().debug(fields ?? {}, msg);
  }
  info(msg: string, fields?: LogFields): void {
    this.log().info(fields ?? {}, msg);
  }
  warn(msg: string, fields?: LogFields): void {
    this.log().warn(fields ?? {}, msg);
  }
  error(msg: string, fields?: LogFields): void {
    this.log().error(fields ?? {}, msg);
  }
}

const registry = new Map<string, PinoLoggerWrapper>();

/** Create a named logger. Component identity in `component` (e.g. `"sync.runner"`,
 *  `"engine.broker.client"`); level resolved from `LODE_LOG`. Sink is JSON to stderr, plus a
 *  rotating file when the host has called `configureLogger({ file })`. stdout stays clean for command
 *  output (binary tests parse it). */
export function createLogger(component: string): Logger {
  const existing = registry.get(component);
  if (existing) {
    return existing;
  }
  const wrapped = new PinoLoggerWrapper(
    component,
    resolveLevel(component, levelRules, DEFAULT_LEVEL),
  );
  registry.set(component, wrapped);
  return wrapped;
}
