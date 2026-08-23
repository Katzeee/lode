import { Identity } from "./identity.js";
import { openWithSecret, signBytes } from "../../crypto/index.js";
import { defineEngineSubsystem, type EngineSubsystemReference } from "../definition.js";
import type { PersistenceCapability } from "../persistence/index.js";
import type { IdentityCapability } from "./capability.js";

export function createIdentitySubsystemDefinition(persistence: EngineSubsystemReference<PersistenceCapability>) {
  return defineEngineSubsystem({
    id: "identity",
    dependencies: { persistence },
    create: ({ persistence: persistenceCapability }, control) => {
      let identity: Identity | undefined;
      return {
        capability: createCapability(() => requireIdentity(identity, control.stopRequested)),
        init: async () => {
          identity = await Identity.open(await persistenceCapability.identityStorage.open());
        },
        stop: () => {
          identity?.lock();
          identity = undefined;
        },
      };
    },
  });
}

function createCapability(identity: () => Identity): IdentityCapability {
  return {
    vault: {
      exists: () => identity().vaultExists(),
      listActors: () => identity().listActors(),
      createActor: (input) => identity().createActor(input),
      importActor: (input) => identity().importActor(input),
      unlock: (passphrase) => identity().unlock(passphrase),
      lock: () => identity().lock(),
      isActorUnlocked: (actorId) => identity().isActorUnlocked(actorId),
    },
    peer: {
      peerId: () => identity().material().peerId,
      identityPublicKey: () => identity().material().identity.publicKey,
      exchangePublicKey: () => identity().material().exchange.publicKey,
      sign: (bytes) => signBytes(bytes, identity().material().identity.seed),
      openEnvelope: (envelope) => openWithSecret(envelope, identity().material().exchange.secret),
    },
  };
}

function requireIdentity(identity: Identity | undefined, stopRequested: boolean): Identity {
  if (!identity || stopRequested) {
    throw new Error("Identity subsystem is not initialized");
  }
  return identity;
}
