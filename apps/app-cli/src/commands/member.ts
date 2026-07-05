import type { ParsedCli } from "../args.js";
import { assertAllowedFlags, getRequiredSingleFlag } from "./shared.js";
import { decodeIdentityToken } from "./identity.js";
import type { ClientLike } from "./types.js";

export async function executeMemberCommand(
  client: ClientLike,
  command: ParsedCli,
  commandKey: string,
): Promise<string> {
  switch (command.action) {
    case "add": {
      assertAllowedFlags(command, commandKey, ["--workspace", "--identity"]);
      const workspaceId = getRequiredSingleFlag(command, "--workspace");
      const token = getRequiredSingleFlag(command, "--identity");
      const identity = decodeIdentityToken(token);
      await client.addMember({
        workspaceId,
        peerEncPub: identity.peerEncPub,
        peerId: identity.peerId,
        owningActorId: identity.actorId,
        peerName: identity.peerName,
      });
      const who = identity.displayName || identity.actorId;
      return `Added ${who} to workspace ${workspaceId}.`;
    }
    case "list": {
      assertAllowedFlags(command, commandKey, ["--workspace"]);
      const workspaceId = getRequiredSingleFlag(command, "--workspace");
      const res = await client.listMembers({ workspaceId });
      if (res.peers.length === 0) {
        return `Workspace ${workspaceId} has no members yet.`;
      }
      // Group peers by owning actor; owner first. Show peer_name (peerId fallback) nested under each.
      const byActor = new Map<string, { peerId: string; name: string }[]>();
      for (const p of res.peers) {
        const arr = byActor.get(p.owningActorId) ?? [];
        arr.push({ peerId: p.peerId, name: p.peerName });
        byActor.set(p.owningActorId, arr);
      }
      const actors = [...byActor.keys()].sort((a, b) =>
        a === res.owner ? -1 : b === res.owner ? 1 : 0,
      );
      const lines = [`Members of ${workspaceId} (epoch ${res.epoch}):`];
      for (const actor of actors) {
        lines.push(`  ${actor}${actor === res.owner ? " (owner)" : ""}`);
        for (const peer of byActor.get(actor) ?? []) {
          lines.push(`    ${peer.name || peer.peerId}`);
        }
      }
      return lines.join("\n");
    }
    default:
      throw new Error(`Unknown command "${commandKey}".`);
  }
}
