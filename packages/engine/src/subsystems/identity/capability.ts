export type ActorSummary = Readonly<{
  actorId: string;
  label: string;
  createdAt: string;
  unlocked: boolean;
}>;

export type PeerIdentityCapability = Readonly<{
  peerId(): string;
  identityPublicKey(): Uint8Array;
  exchangePublicKey(): Uint8Array;
  sign(bytes: Uint8Array): Uint8Array;
  openEnvelope(envelope: Uint8Array): Uint8Array;
}>;

export type IdentityCapability = Readonly<{
  vault: Readonly<{
    exists(): boolean;
    listActors(): readonly ActorSummary[];
    createActor(
      input: Readonly<{ label: string; passphrase: string }>,
    ): Promise<Readonly<{ actorId: string; phrase: string }>>;
    importActor(
      input: Readonly<{ phrase: string; passphrase: string; label: string }>,
    ): Promise<Readonly<{ actorId: string }>>;
    unlock(passphrase: string): Promise<readonly ActorSummary[]>;
    lock(): void;
  }>;
  signing: Readonly<{
    isActorUnlocked(actorId: string): boolean;
    signFact(digest: string, actorId: string): string;
  }>;
  peer: PeerIdentityCapability;
}>;
