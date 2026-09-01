import { CliError, okOutcome } from "../outcome/index.js";
import type { CommandCatalog } from "../catalog/index.js";
import { readCommand, stringOption, writeCommand } from "../command/index.js";
import { workspaceIdOf } from "../intent/index.js";

/**
 * Sync family: manage the selected Workspace's remote Replica endpoint and run
 * the formal Fact-only exchange through the replica host port. Connection
 * state persists in CLI configuration, so it survives daemon restarts.
 */

export function registerSyncCommands(catalog: CommandCatalog): void {
  catalog.register(syncConnect);
  catalog.register(syncRun);
  catalog.register(syncStatus);
}

const syncConnect = writeCommand({
  path: ["sync", "connect"],
  summary: "Set the remote Replica endpoint for the selected Workspace.",
  positionals: [["endpoint", "Remote daemon endpoint"]],
  run: async (context, args) => {
    const endpoint = args.positional("endpoint");
    await context.persistence.setSyncEndpoint(workspaceIdOf(context), endpoint);
    return okOutcome(
      { endpoint, workspace: workspaceIdOf(context) },
      { view: { kind: "text", lines: [`Connected workspace to ${endpoint}.`, "Run `lode sync run` to exchange."] } },
    );
  },
});

const syncRun = writeCommand({
  path: ["sync", "run"],
  summary: "Run the Fact-only Replica exchange with the connected endpoint.",
  options: [stringOption("--endpoint", "Override the connected remote endpoint for this run")],
  run: async (context, args) => {
    const workspaceId = workspaceIdOf(context);
    const endpoint = args.option("--endpoint") ?? (await context.persistence.readSyncEndpoint(workspaceId));
    if (endpoint === null) {
      throw new CliError(
        "configuration-missing",
        "No remote endpoint connected. Run `lode sync connect <endpoint>` first or pass --endpoint.",
      );
    }
    const exchanged = await context.session.replicas.run(workspaceId, endpoint);
    return okOutcome(
      { endpoint, pulled: exchanged.pulled, pushed: exchanged.pushed },
      {
        view: {
          kind: "text",
          lines: [
            `Synced with ${endpoint}: pulled ${exchanged.pulled}, pushed ${exchanged.pushed}.`,
            "Only Facts were exchanged; Projections rebuild locally.",
          ],
        },
      },
    );
  },
});

const syncStatus = readCommand({
  path: ["sync", "status"],
  summary: "Show the selected Workspace's connection state.",
  run: async (context) => {
    const workspaceId = workspaceIdOf(context);
    const endpoint = await context.persistence.readSyncEndpoint(workspaceId);
    return okOutcome(
      { connected: endpoint !== null, endpoint },
      {
        view: {
          kind: "text",
          lines:
            endpoint === null
              ? ["No remote endpoint connected. Run `lode sync connect <endpoint>`."]
              : [`Connected to ${endpoint}.`, "Run `lode sync run` to exchange."],
        },
      },
    );
  },
});
