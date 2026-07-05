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
    case "remove": {
      assertAllowedFlags(command, commandKey, ["--workspace", "--peer", "--actor"]);
      const workspaceId = getRequiredSingleFlag(command, "--workspace");
      const peerFlag = command.flags["--peer"]?.[0];
      const actorFlag = command.flags["--actor"]?.[0];
      const hasPeer = peerFlag !== undefined;
      const hasActor = actorFlag !== undefined;
      if (hasPeer === hasActor) {
        throw new Error(`Provide exactly one of --peer or --actor for "${commandKey}".`);
      }
      await client.revokePeer({
        workspaceId,
        ...(hasPeer ? { peerId: peerFlag } : { actorId: actorFlag }),
      });
      const target = hasPeer ? `peer ${peerFlag}` : `actor ${actorFlag} (all their peers)`;
      return `Revoked ${target} from workspace ${workspaceId}.`;
    }
    case "add-peer": {
      // Self-service: the actor adds their OWN further peer (the new peer exported this token; the
      // actor pastes it from an ADMITTED peer). owningActorId is the session actor (set by the daemon).
      assertAllowedFlags(command, commandKey, ["--workspace", "--identity"]);
      const workspaceId = getRequiredSingleFlag(command, "--workspace");
      const token = getRequiredSingleFlag(command, "--identity");
      const identity = decodeIdentityToken(token);
      await client.addPeer({
        workspaceId,
        peerEncPub: identity.peerEncPub,
        peerId: identity.peerId,
        peerName: identity.peerName,
        owningActorId: identity.actorId,
      });
      return `Added peer ${identity.peerName || identity.peerId} to workspace ${workspaceId}.`;
    }
    case "transfer": {
      assertAllowedFlags(command, commandKey, ["--workspace", "--to"]);
      const workspaceId = getRequiredSingleFlag(command, "--workspace");
      const newOwner = getRequiredSingleFlag(command, "--to");
      await client.transferOwner({ workspaceId, newOwnerActorId: newOwner });
      return `Transferred ownership of workspace ${workspaceId} to ${newOwner}.`;
    }
    default:
      throw new Error(`Unknown command "${commandKey}".`);
  }
}
