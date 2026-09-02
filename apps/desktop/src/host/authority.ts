import { access } from "node:fs/promises";
import { join } from "node:path";

import { ensureRunningDaemon, probeDaemon, type DesktopClient, type HomeSelection } from "@lode/desktop-client";

export type OwnedDaemonExit = Readonly<{ code: number; output: string }>;

export type OwnedDaemon = Readonly<{
  pid: number;
  exit: Promise<OwnedDaemonExit>;
  terminate(): Promise<OwnedDaemonExit>;
}>;

export type AuthorityConnection = Readonly<{
  client: DesktopClient;
  ownership: "owned" | "reused";
  notice: string | null;
  ownedPid: number | null;
}>;

type AuthorityDependencies = Readonly<{
  probe: typeof probeDaemon;
  ensure: typeof ensureRunningDaemon;
  endpointExists(selection: HomeSelection): Promise<boolean>;
  spawn(selection: HomeSelection): Promise<OwnedDaemon>;
}>;

export type AuthorityShutdown = Readonly<{
  ownedPid: number | null;
  ownedExited: boolean;
  exitCode: number | null;
}>;

export class DaemonAuthority {
  private client: DesktopClient | undefined;
  private owned: OwnedDaemon | undefined;

  constructor(private readonly dependencies: AuthorityDependencies) {}

  async connect(selection: HomeSelection): Promise<AuthorityConnection> {
    if (this.client !== undefined) {
      throw new Error("Desktop authority is already connected");
    }
    const endpointExists = await this.dependencies.endpointExists(selection);
    const existing = await this.dependencies.probe(selection);
    if (existing !== null) {
      this.client = existing.client;
      return { client: existing.client, ownership: "reused", notice: null, ownedPid: null };
    }

    let resolveOwned: (owned: OwnedDaemon) => void = () => undefined;
    let rejectOwned: (error: unknown) => void = () => undefined;
    const ownedStarted = new Promise<OwnedDaemon>((resolve, reject) => {
      resolveOwned = resolve;
      rejectOwned = reject;
    });
    const readinessAbort = new AbortController();
    const connection = this.dependencies.ensure(
      selection,
      async () => {
        try {
          const owned = await this.dependencies.spawn(selection);
          this.owned = owned;
          resolveOwned(owned);
        } catch (error) {
          rejectOwned(error);
          throw error;
        }
      },
      { signal: readinessAbort.signal },
    );
    const processFailure = ownedStarted.then(async (owned) => {
      const exit = await owned.exit;
      throw new Error(daemonExitMessage(exit));
    });

    try {
      const client = await Promise.race([connection, processFailure]);
      this.client = client;
      return {
        client,
        ownership: this.owned === undefined ? "reused" : "owned",
        notice: endpointExists ? "A stale daemon endpoint was replaced by a live authority." : null,
        ownedPid: this.owned?.pid ?? null,
      };
    } catch (error) {
      readinessAbort.abort(error);
      return this.cleanupAfterFailure(error);
    }
  }

  async close(): Promise<AuthorityShutdown> {
    const client = this.client;
    const owned = this.owned;
    this.client = undefined;
    this.owned = undefined;
    const failures: Error[] = [];
    let gracefulShutdown = false;
    if (client !== undefined && owned !== undefined) {
      try {
        await client.shutdown();
        gracefulShutdown = true;
      } catch (error) {
        failures.push(toError(error));
      }
    }
    if (client !== undefined) {
      try {
        client.close();
      } catch (error) {
        failures.push(toError(error));
      }
    }
    let exit: OwnedDaemonExit | undefined;
    if (owned !== undefined) {
      try {
        exit = gracefulShutdown
          ? await withTimeout(owned.exit, 10_000, "Desktop-owned daemon did not exit after its shutdown request")
          : await owned.terminate();
      } catch (error) {
        failures.push(toError(error));
        if (gracefulShutdown) {
          try {
            exit = await owned.terminate();
          } catch (terminationError) {
            failures.push(toError(terminationError));
          }
        }
      }
    }
    if (failures.length > 0) {
      if (failures.length === 1) {
        throw toError(failures[0]);
      }
      throw new AggregateError(failures, "Desktop authority cleanup failed");
    }
    return {
      ownedPid: owned?.pid ?? null,
      ownedExited: owned === undefined || exit !== undefined,
      exitCode: exit?.code ?? null,
    };
  }

  private async cleanupAfterFailure(failure: unknown): Promise<never> {
    try {
      await this.close();
    } catch (cleanupError) {
      throw new AggregateError(
        [toError(failure), toError(cleanupError)],
        "Desktop authority failed and did not clean up fully",
        { cause: cleanupError },
      );
    }
    throw toError(failure);
  }
}

export function createDaemonAuthority(spawn: AuthorityDependencies["spawn"]): DaemonAuthority {
  return new DaemonAuthority({
    probe: probeDaemon,
    ensure: ensureRunningDaemon,
    endpointExists: async (selection) => {
      try {
        await access(join(selection.path, "endpoint"));
        return true;
      } catch (error) {
        if (hasCode(error, "ENOENT")) {
          return false;
        }
        throw error;
      }
    },
    spawn,
  });
}

function daemonExitMessage(exit: OwnedDaemonExit): string {
  const detail = exit.output.trim();
  return detail.length === 0
    ? `Desktop daemon exited before it became ready (code ${exit.code})`
    : `Desktop daemon exited before it became ready (code ${exit.code}): ${detail}`;
}

function hasCode(value: unknown, code: string): boolean {
  return typeof value === "object" && value !== null && "code" in value && value.code === code;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function withTimeout<Result>(promise: Promise<Result>, timeoutMs: number, message: string): Promise<Result> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    void promise.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(toError(error));
      },
    );
  });
}
