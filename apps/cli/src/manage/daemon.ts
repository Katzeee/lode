import { ConnectError } from "@connectrpc/connect";
import {
  ensureRunningDaemon,
  probeDaemon,
  readHomeRegistry,
  selectHome,
  type DaemonStatusView,
  type HomeSelection,
} from "@lode/desktop-client";

import { CliError, okOutcome, type CommandResult } from "../outcome/index.js";
import type { CommandDefinition, ManagementCommandContext } from "../catalog/index.js";
import type { ParsedArgs } from "../invocation/index.js";
import { launchDaemon } from "../daemon-launch.js";

/**
 * The `daemon` command family: process management for the daemon serving one
 * Home. `status`/`stop` only probe — they never start a daemon; `start` is the
 * ensure-running path the product commands use implicitly.
 */

type DaemonManagementPort = Readonly<{
  /** Never spawns; resolves null when the daemon does not answer Status. */
  probe(): Promise<{ status: DaemonStatusView; shutdown(): Promise<void> } | null>;
  /** Spawns through the launcher when missing, then waits for Status ready. */
  ensureStarted(): Promise<DaemonStatusView>;
  /** Waits until the daemon no longer answers Status, or throws. */
  waitStopped(): Promise<void>;
}>;

export function daemonCommands(): readonly CommandDefinition[] {
  const home = [["home", "Registered home name (optional; defaults to the resolved home)", "optional"] as const];
  return [
    {
      path: ["daemon", "start"],
      summary: "Ensure the daemon for the home is running.",
      positionals: home,
      options: [],
      kind: "write",
      paginated: false,
      needsWorkspace: false,
      runManagement: async (context, args) => startDaemon(await daemonPort(context, args)),
    },
    {
      path: ["daemon", "status"],
      summary: "Report the daemon's run state without starting it.",
      positionals: home,
      options: [],
      kind: "read",
      paginated: false,
      needsWorkspace: false,
      runManagement: async (context, args) => daemonStatus(await daemonPort(context, args)),
    },
    {
      path: ["daemon", "stop"],
      summary: "Stop the daemon for the home through its Shutdown RPC.",
      positionals: home,
      options: [],
      kind: "write",
      paginated: false,
      needsWorkspace: false,
      runManagement: async (context, args) => stopDaemon(await daemonPort(context, args)),
    },
  ];
}

async function daemonPort(context: ManagementCommandContext, args: ParsedArgs): Promise<DaemonManagementPort> {
  const registry = await readHomeRegistry(context.configDir);
  const positional = args.optionalPositional("home");
  const selection = selectHome(registry, positional ?? context.globals.home, context.environment.LODE_HOME);
  return {
    probe: async () => {
      const probe = await probeDaemon(selection);
      if (probe === null) {
        return null;
      }
      const client = probe.client;
      return { status: probe.status, shutdown: () => client.shutdown() };
    },
    ensureStarted: async () => {
      const client = await ensureRunningDaemon(selection, launchDaemon);
      try {
        return await client.status();
      } finally {
        client.close();
      }
    },
    waitStopped: () => waitStopped(selection),
  };
}

async function waitStopped(selection: HomeSelection, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const probe = await probeDaemon(selection).catch(() => null);
    if (probe === null) {
      return;
    }
    probe.client.close();
  }
  throw new CliError("transport", `Daemon for home "${selection.name}" did not stop within ${timeoutMs}ms`);
}

async function startDaemon(port: DaemonManagementPort): Promise<CommandResult> {
  const status = await port.ensureStarted();
  return statusResult(status, `Daemon is running (version ${status.daemonVersion}).`);
}

async function daemonStatus(port: DaemonManagementPort): Promise<CommandResult> {
  const probe = await port.probe();
  if (probe === null) {
    return okOutcome({ running: false }, { view: { kind: "text", lines: ["Daemon is not running."] } });
  }
  return statusResult(probe.status, `Daemon is running (version ${probe.status.daemonVersion}).`);
}

async function stopDaemon(port: DaemonManagementPort): Promise<CommandResult> {
  const probe = await port.probe();
  if (probe === null) {
    return okOutcome({ stopped: false, running: false }, { view: { kind: "text", lines: ["Daemon is not running."] } });
  }
  const homeName = probe.status.homeName;
  try {
    await probe.shutdown();
  } catch (error) {
    // The socket can reset while the daemon tears the listener down; the
    // wait below is the source of truth for whether it actually stopped.
    if (!(error instanceof ConnectError)) {
      throw error;
    }
  }
  await port.waitStopped();
  return okOutcome({ stopped: true }, { view: { kind: "text", lines: [`Daemon for home "${homeName}" stopped.`] } });
}

function statusResult(status: DaemonStatusView, headline: string): CommandResult {
  return okOutcome(
    {
      running: true,
      homeName: status.homeName,
      homePath: status.homePath,
      daemonVersion: status.daemonVersion,
      ready: status.ready,
      workspaces: status.workspaces,
    },
    {
      view: {
        kind: "text",
        lines: [
          headline,
          ...status.workspaces.map(
            (workspace) => `  ${workspace.label.length > 0 ? workspace.label : workspace.workspaceId}`,
          ),
        ],
      },
    },
  );
}
