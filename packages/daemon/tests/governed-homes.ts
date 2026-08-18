import { createDesktopClient, type DesktopClient } from "@lode/desktop-client";

import type { Daemon } from "../src/daemon.js";

/**
 * Test bootstrap for governed homes: every workspace now belongs to a real
 * Actor, and a second home joins through the product flow — admission
 * material out, owner admits actor and peer, joiner adopts from the exchange
 * endpoint. No fixture creates the same workspace id on two homes.
 */

export const TEST_PASSPHRASE = "governed-test-passphrase";

export type GovernedHome = Readonly<{
  client: DesktopClient;
  controlEndpoint: string;
  exchangeEndpoint: string;
}>;

export function homeOf(daemon: Daemon, accessToken: string): GovernedHome {
  return {
    client: createDesktopClient(daemon.address, accessToken),
    controlEndpoint: daemon.address,
    exchangeEndpoint: daemon.exchangeAddress,
  };
}

/** Creates a fresh Actor (left unlocked in the running daemon) on a home. */
export async function createActor(home: GovernedHome, label: string): Promise<string> {
  const created = await home.client.createActor({ label, passphrase: TEST_PASSPHRASE });
  return created.actorId;
}

/** Creates a governed workspace owned by a freshly created Actor. */
export async function createGovernedWorkspace(home: GovernedHome, workspaceId: string, label: string): Promise<string> {
  const ownerActorId = await createActor(home, `${label} Owner`);
  await home.client.createWorkspace(workspaceId, label, ownerActorId);
  return ownerActorId;
}

/**
 * The full admission-and-adoption product flow between two homes: the joiner
 * creates its own Actor, exports its admission material, the member admits
 * both the Actor and the Peer, and the joiner adopts the remote journal from
 * an empty frontier through the peer-exchange endpoint.
 */
export async function joinHomeToWorkspace(
  member: Readonly<{ home: GovernedHome; actingActorId: string }>,
  joiner: GovernedHome,
  workspaceId: string,
): Promise<Readonly<{ joinerActorId: string }>> {
  const joinerActor = await createActor(joiner, "Joiner");
  const material = await joiner.client.peerMaterial();
  await member.home.client.admitActor({
    workspaceId,
    actingActorId: member.actingActorId,
    actorId: joinerActor,
  });
  await member.home.client.admitPeer({
    workspaceId,
    actingActorId: member.actingActorId,
    peerId: material.peerId,
    peerKxPublicKey: material.peerKxPublicKey,
  });
  const adopted = await joiner.client.adoptWorkspace(member.home.exchangeEndpoint, workspaceId);
  if (adopted.workspaceId !== workspaceId) {
    throw new Error(`Adopted unexpected workspace ${adopted.workspaceId}`);
  }
  return { joinerActorId: joinerActor };
}
