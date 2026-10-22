import { CliError, okOutcome, type CommandResult, type HumanView } from "../outcome/index.js";
import {
  fileOption,
  readCommand,
  writeCommand,
  type CommandContext,
  type CommandDefinition,
  type ParsedArgs,
} from "../command/index.js";
import { actorIdOf } from "../intent/index.js";
import { resolveWorkspaceFromList } from "../target/index.js";

/**
 * Workspace governance actions: list members and devices, admit and remove
 * Actors, transfer ownership, admit and revoke Peers, rotate transit. Every
 * command acts as the Actor selected with the global --actor flag.
 */

export function registerWorkspaceGovernanceCommands(catalog: { register(definition: CommandDefinition): void }): void {
  catalog.register(workspaceMembers);
  catalog.register(workspacePeers);
  catalog.register(workspaceAdmitActor);
  catalog.register(workspaceRemoveActor);
  catalog.register(workspaceTransferOwner);
  catalog.register(workspaceAdmitPeer);
  catalog.register(workspaceRevokePeer);
  catalog.register(workspaceRotateTransit);
}

const admissionFileOption = fileOption(
  "--admission-file",
  "Admission material exported by the joining Home ('-' for stdin)",
  { required: true },
);

const workspaceMembers = readCommand({
  path: ["workspace", "members"],
  summary: "List the Actor members of a workspace.",
  positionals: [["workspace", "Workspace label, workspace: ref, or canonical link", "optional"]],
  needsWorkspace: false,
  run: async (context: CommandContext, args: ParsedArgs): Promise<CommandResult> => {
    const workspaceId = await targetWorkspace(context, args);
    const summary = await context.session.governance.summary(workspaceId);
    const view: HumanView = {
      kind: "table",
      columns: ["actor", "owner"],
      rows: summary.memberActorIds.map((actorId) => [actorId, actorId === summary.ownerActorId ? "*" : ""]),
    };
    return okOutcome(
      { workspace: workspaceId, owner: summary.ownerActorId ?? null, members: summary.memberActorIds },
      { view },
    );
  },
});

const workspacePeers = readCommand({
  path: ["workspace", "peers"],
  summary: "List the admitted devices of a workspace.",
  positionals: [["workspace", "Workspace label, workspace: ref, or canonical link", "optional"]],
  needsWorkspace: false,
  run: async (context: CommandContext, args: ParsedArgs): Promise<CommandResult> => {
    const workspaceId = await targetWorkspace(context, args);
    const summary = await context.session.governance.summary(workspaceId);
    const view: HumanView = {
      kind: "table",
      columns: ["peer", "epoch", "admitted by", "sync"],
      rows: summary.peers.map((peer) => [
        peer.peerId,
        String(peer.admittedAtEpoch),
        peer.admittedByActorId,
        peer.syncAdmitted ? "admitted" : "stale",
      ]),
    };
    return okOutcome({ workspace: workspaceId, epoch: summary.epoch, peers: summary.peers }, { view });
  },
});

const workspaceAdmitActor = writeCommand({
  path: ["workspace", "admit-actor"],
  summary: "Admit an Actor as a workspace member (owner action).",
  positionals: [
    ["workspace", "Workspace label, workspace: ref, or canonical link"],
    ["actor", "Actor id to admit"],
  ],
  needsWorkspace: false,
  run: async (context, args) => {
    const workspaceId = await workspaceByToken(context, args.positional("workspace"));
    await context.session.governance.admitActor({
      workspaceId,
      actingActorId: await actingActorId(context, workspaceId),
      actorId: args.positional("actor"),
      requestId: context.requestId,
    });
    return okOutcome(
      { workspace: workspaceId, admitted: args.positional("actor") },
      { view: { kind: "text", lines: [`Admitted Actor ${args.positional("actor")} to ${workspaceId}.`] } },
    );
  },
});

const workspaceRemoveActor = writeCommand({
  path: ["workspace", "remove-actor"],
  summary: "Remove an Actor's membership (owner action).",
  positionals: [
    ["workspace", "Workspace label, workspace: ref, or canonical link"],
    ["actor", "Actor id to remove"],
  ],
  needsWorkspace: false,
  run: async (context, args) => {
    const workspaceId = await workspaceByToken(context, args.positional("workspace"));
    await context.session.governance.removeActor({
      workspaceId,
      actingActorId: await actingActorId(context, workspaceId),
      actorId: args.positional("actor"),
      requestId: context.requestId,
    });
    return okOutcome(
      { workspace: workspaceId, removed: args.positional("actor") },
      { view: { kind: "text", lines: [`Removed Actor ${args.positional("actor")} from ${workspaceId}.`] } },
    );
  },
});

const workspaceTransferOwner = writeCommand({
  path: ["workspace", "transfer-owner"],
  summary: "Transfer workspace ownership to a member Actor.",
  positionals: [
    ["workspace", "Workspace label, workspace: ref, or canonical link"],
    ["actor", "Next owner Actor id (must already be a member)"],
  ],
  needsWorkspace: false,
  run: async (context, args) => {
    const workspaceId = await workspaceByToken(context, args.positional("workspace"));
    await context.session.governance.transferOwner({
      workspaceId,
      actingActorId: await actingActorId(context, workspaceId),
      nextOwnerActorId: args.positional("actor"),
      requestId: context.requestId,
    });
    return okOutcome(
      { workspace: workspaceId, owner: args.positional("actor") },
      { view: { kind: "text", lines: [`Ownership of ${workspaceId} transferred to ${args.positional("actor")}.`] } },
    );
  },
});

const workspaceAdmitPeer = writeCommand({
  path: ["workspace", "admit-peer"],
  summary: "Admit a joining Home's device using its exported admission material.",
  positionals: [["workspace", "Workspace label, workspace: ref, or canonical link"]],
  options: [admissionFileOption],
  needsWorkspace: false,
  run: async (context, args) => {
    const workspaceId = await workspaceByToken(context, args.positional("workspace"));
    const admission = parseAdmission(args.requiredOption("--admission-file"));
    await context.session.governance.admitPeer({
      workspaceId,
      actingActorId: await actingActorId(context, workspaceId),
      peerId: admission.peerId,
      peerKxPublicKey: admission.peerKxPublicKey,
      requestId: context.requestId,
    });
    return okOutcome(
      { workspace: workspaceId, admittedPeer: admission.peerId },
      {
        view: {
          kind: "text",
          lines: [
            `Admitted Peer ${admission.peerId} to ${workspaceId} at the current transit epoch.`,
            "The joining Home adopts with `lode workspace adopt <endpoint> <workspace>`.",
          ],
        },
      },
    );
  },
});

const workspaceRevokePeer = writeCommand({
  path: ["workspace", "revoke-peer"],
  summary: "Revoke a device and rotate the transit key past it (owner action).",
  positionals: [
    ["workspace", "Workspace label, workspace: ref, or canonical link"],
    ["peer", "Peer id to revoke"],
  ],
  needsWorkspace: false,
  run: async (context, args) => {
    const workspaceId = await workspaceByToken(context, args.positional("workspace"));
    await context.session.governance.revokePeer({
      workspaceId,
      actingActorId: await actingActorId(context, workspaceId),
      peerId: args.positional("peer"),
      requestId: context.requestId,
    });
    return okOutcome(
      { workspace: workspaceId, revokedPeer: args.positional("peer"), transitRotated: true },
      {
        view: {
          kind: "text",
          lines: [
            `Revoked Peer ${args.positional("peer")} and rotated the transit key.`,
            "Other devices pick up the new key on their next exchange.",
          ],
        },
      },
    );
  },
});

const workspaceRotateTransit = writeCommand({
  path: ["workspace", "rotate-transit"],
  summary: "Rotate the workspace transit key for every admitted device (owner action).",
  positionals: [["workspace", "Workspace label, workspace: ref, or canonical link"]],
  needsWorkspace: false,
  run: async (context, args) => {
    const workspaceId = await workspaceByToken(context, args.positional("workspace"));
    await context.session.governance.rotateTransit({
      workspaceId,
      actingActorId: await actingActorId(context, workspaceId),
      requestId: context.requestId,
    });
    return okOutcome(
      { workspace: workspaceId, transitRotated: true },
      { view: { kind: "text", lines: [`Rotated the transit key for ${workspaceId}.`] } },
    );
  },
});

function parseAdmission(text: string): Readonly<{ peerId: string; peerKxPublicKey: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CliError("invalid-value", "Admission material is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CliError("invalid-value", "Admission material is not an object.");
  }
  const candidate = parsed as Readonly<{ peerId?: unknown; peerKxPublicKey?: unknown }>;
  if (typeof candidate.peerId !== "string" || typeof candidate.peerKxPublicKey !== "string") {
    throw new CliError("invalid-value", "Admission material needs peerId and peerKxPublicKey.");
  }
  return { peerId: candidate.peerId, peerKxPublicKey: candidate.peerKxPublicKey };
}

/** Token > --workspace > error, for member and peer listing. */
async function targetWorkspace(context: CommandContext, args: ParsedArgs): Promise<string> {
  const token = args.optionalPositional("workspace") ?? context.workspaceChoice;
  if (token === null) {
    throw new CliError("configuration-missing", "No workspace given. Pass a workspace target or --workspace.");
  }
  return workspaceByToken(context, token);
}

/** Resolves a workspace token (label or ref) against the daemon catalog. */
async function workspaceByToken(context: CommandContext, token: string): Promise<string> {
  const entry = resolveWorkspaceFromList(await context.session.workspaces.list(), token);
  return entry.workspaceId;
}

async function actingActorId(context: CommandContext, workspaceId: string): Promise<string> {
  const saved = context.actor ?? (await context.persistence.readWorkspaceActor(workspaceId));
  return actorIdOf({ ...context, actor: saved });
}
