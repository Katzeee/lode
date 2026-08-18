import { createHash, randomUUID } from "node:crypto";

import { aeadOpen, aeadSeal, openWithSecret, peerPublicKeyFromId, verifyBytes } from "../../crypto/index.js";
import type { ReplicaPeer, SyncProfileEntry, TransitHandshake } from "@lode/sdk/host";
import { projectGovernance, syncAdmittedPeers, type GovernanceState } from "../../domain/governance/index.js";
import { signPeerChallenge } from "./peer-identity.js";
import type { IdentityRuntime } from "./identity-runtime.js";
import { openOwnTransitKey, type GovernanceAuthority } from "./workspace-governance.js";

/**
 * The remote replica-exchange boundary, Engine-owned. A dialing Peer
 * authenticates every request with an Ed25519 signature over a canonical
 * challenge naming the workspace, its peer id, a fresh nonce, the target
 * document, and the sealed payload digest; the serving side checks admission
 * against its replayed governance state and answers under the workspace's
 * current transit key. Every response's handshake returns the dialer's own
 * transit envelope, which is how an admitted Peer learns a rotated key or
 * bootstraps after adoption — no Home access token, daemon control, or
 * provider logic crosses this boundary.
 */

export const PEER_EXCHANGE_PROTOCOL = "lode-peer-exchange/v1";

export type PeerProof = Readonly<{
  workspaceId: string;
  peerId: string;
  nonce: string;
  signature: Uint8Array;
}>;

export class PeerExchangeRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PeerExchangeRejected";
  }
}

type ChallengeInput = Readonly<{
  workspaceId: string;
  peerId: string;
  nonce: string;
  documentId: string;
  payload: Uint8Array;
}>;

/** The exact bytes a Peer signs for one request. */
export function peerChallenge(input: ChallengeInput): Uint8Array {
  const digest = createHash("sha256").update(input.payload).digest("hex");
  const canonical = [
    PEER_EXCHANGE_PROTOCOL,
    input.workspaceId,
    input.peerId,
    input.nonce,
    input.documentId,
    digest,
  ].join("\n");
  return new TextEncoder().encode(canonical);
}

export type ServingWorkspace = Readonly<{
  workspaceId: string;
  label: string;
  facts: GovernanceAuthority;
  peer(): ReplicaPeer;
}>;

/** The serving side: verify, gate on admission, seal under the transit key. */
export class PeerExchangeServer {
  constructor(
    private readonly identity: IdentityRuntime,
    private readonly workspace: (workspaceId: string) => ServingWorkspace,
  ) {}

  async exchangeProfile(
    proof: PeerProof,
  ): Promise<Readonly<{ handshake: TransitHandshake; sealedProfile: Uint8Array }>> {
    const { state, workspace, transitKey } = this.authenticate(proof, "", new Uint8Array());
    const admitted = syncAdmittedPeers(state).get(proof.peerId);
    if (!admitted) {
      throw new PeerExchangeRejected("Peer is not admitted at the current transit epoch");
    }
    const entries = await workspace.peer().profile();
    const profile = new TextEncoder().encode(
      JSON.stringify({
        label: workspace.label,
        entries: entries.map((entry) => ({
          documentId: entry.documentId,
          version: Buffer.from(entry.version).toString("base64"),
        })),
      }),
    );
    return {
      handshake: {
        epoch: state.epoch,
        envelopeEphemeral: decodeBase64(admitted.envelope.ephemeral),
        envelopeSeal: decodeBase64(admitted.envelope.seal),
      },
      sealedProfile: aeadSeal(transitKey, profile),
    };
  }

  async exchangeFetch(proof: PeerProof, documentId: string, sealedFrom: Uint8Array): Promise<Uint8Array> {
    const { workspace, transitKey } = this.authenticate(proof, documentId, sealedFrom);
    const from = aeadOpen(transitKey, sealedFrom);
    const payload = await workspace.peer().fetch(documentId, from);
    return aeadSeal(transitKey, payload);
  }

  async exchangeSend(proof: PeerProof, documentId: string, sealedPayload: Uint8Array): Promise<void> {
    const { workspace, transitKey } = this.authenticate(proof, documentId, sealedPayload);
    const payload = aeadOpen(transitKey, sealedPayload);
    await workspace.peer().send(documentId, payload);
  }

  private authenticate(
    proof: PeerProof,
    documentId: string,
    sealedPayload: Uint8Array,
  ): Readonly<{ state: GovernanceState; workspace: ServingWorkspace; transitKey: Uint8Array }> {
    const workspace = this.workspace(proof.workspaceId);
    const admission = workspace.facts.admission();
    if (admission.kind === "fault") {
      throw new PeerExchangeRejected("Workspace authority is faulted");
    }
    const state = projectGovernance(admission.snapshot.facts);
    const publicKey = peerPublicKeyFromId(proof.peerId);
    if (publicKey === null) {
      throw new PeerExchangeRejected("Peer id does not encode a public key");
    }
    const challenge = peerChallenge({
      workspaceId: proof.workspaceId,
      peerId: proof.peerId,
      nonce: proof.nonce,
      documentId,
      payload: sealedPayload,
    });
    if (!verifyBytes(challenge, proof.signature, publicKey)) {
      throw new PeerExchangeRejected("Peer authentication failed");
    }
    if (!syncAdmittedPeers(state).has(proof.peerId)) {
      throw new PeerExchangeRejected("Peer is not admitted to this Workspace");
    }
    const transitKey = openOwnTransitKey(this.identity, state);
    return { state, workspace, transitKey };
  }
}

/** The dialing side: sign every request, unseal every response. */
export class PeerExchangeDialer {
  private epochKey: Readonly<{ epoch: number; key: Uint8Array }> | undefined;
  private remoteLabel: string | null = null;

  constructor(
    private readonly identity: IdentityRuntime,
    private readonly workspaceId: string,
    private readonly wire: Readonly<{
      profile(proof: PeerProof): Promise<Readonly<{ handshake: TransitHandshake; sealedProfile: Uint8Array }>>;
      fetch(proof: PeerProof, documentId: string, sealedFrom: Uint8Array): Promise<Uint8Array>;
      send(proof: PeerProof, documentId: string, sealedPayload: Uint8Array): Promise<void>;
    }>,
  ) {}

  /** The remote workspace's catalog label, learned from the last profile. */
  label(): string | null {
    return this.remoteLabel;
  }

  peer(): ReplicaPeer {
    return {
      profile: async () => {
        const { handshake, sealedProfile } = await this.wire.profile(this.proof("", new Uint8Array()));
        this.adoptHandshake(handshake);
        const plaintext = this.open(sealedProfile);
        this.remoteLabel = profileLabel(plaintext);
        return decodeProfile(plaintext);
      },
      fetch: async (documentId, from) => {
        const sealedFrom = aeadSeal(this.transitKey(), from);
        return this.open(await this.wire.fetch(this.proof(documentId, sealedFrom), documentId, sealedFrom));
      },
      send: async (documentId, bytes) => {
        const sealed = aeadSeal(this.transitKey(), bytes);
        await this.wire.send(this.proof(documentId, sealed), documentId, sealed);
      },
    };
  }

  /** Opens the remote's handshake envelope for this Peer and caches the key. */
  private adoptHandshake(handshake: TransitHandshake): void {
    if (this.epochKey?.epoch === handshake.epoch) {
      return;
    }
    const exchange = this.identity.peer().exchange;
    const key = openWithSecret(
      new Uint8Array([...handshake.envelopeEphemeral, ...handshake.envelopeSeal]),
      exchange.secret,
    );
    this.epochKey = { epoch: handshake.epoch, key };
  }

  private transitKey(): Uint8Array {
    if (!this.epochKey) {
      throw new PeerExchangeRejected("No transit handshake yet; profile the remote first");
    }
    return this.epochKey.key;
  }

  private open(sealed: Uint8Array): Uint8Array {
    return aeadOpen(this.transitKey(), sealed);
  }

  private proof(documentId: string, payload: Uint8Array): PeerProof {
    const nonce = randomUUID();
    const material = this.identity.peer();
    return {
      workspaceId: this.workspaceId,
      peerId: material.peerId,
      nonce,
      signature: signPeerChallenge(
        material,
        peerChallenge({ workspaceId: this.workspaceId, peerId: material.peerId, nonce, documentId, payload }),
      ),
    };
  }
}

export function decodeProfile(bytes: Uint8Array): readonly SyncProfileEntry[] {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new PeerExchangeRejected("Remote profile is malformed");
  }
  const record = parsed as Readonly<{ label?: unknown; entries?: unknown }>;
  if (!Array.isArray(record.entries)) {
    throw new PeerExchangeRejected("Remote profile has no entries");
  }
  return record.entries.map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      throw new PeerExchangeRejected("Remote profile entry is malformed");
    }
    const candidate = entry as Readonly<{ documentId?: unknown; version?: unknown }>;
    if (typeof candidate.documentId !== "string" || typeof candidate.version !== "string") {
      throw new PeerExchangeRejected("Remote profile entry is malformed");
    }
    return {
      documentId: candidate.documentId,
      version: new Uint8Array(Buffer.from(candidate.version, "base64")),
    };
  });
}

export function profileLabel(bytes: Uint8Array): string | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const label = (parsed as Readonly<{ label?: unknown }>).label;
      return typeof label === "string" && label.length > 0 ? label : null;
    }
  } catch {
    return null;
  }
  return null;
}

function decodeBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}
