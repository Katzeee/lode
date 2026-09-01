import { createHash, randomUUID } from "node:crypto";

import { aeadOpen, aeadSeal, peerPublicKeyFromId, verifyBytes } from "../../crypto/index.js";
import type { ReplicaPeer, SyncProfileEntry } from "./sync-exchange.js";
import { projectGovernance, syncAdmittedPeers, type GovernanceState } from "../../domain/governance/index.js";
import type { FactSnapshot } from "../../domain/fact/index.js";
import type { ReplicaExchangeProof, ReplicaExchangeWire, TransitHandshake } from "../connection/index.js";
import type { PeerIdentityCapability } from "../identity/index.js";

/**
 * The remote replica-exchange boundary, Engine-owned. A dialing Peer
 * authenticates every request with an Ed25519 signature over a canonical
 * challenge naming the workspace, its peer id, a fresh nonce, the target
 * document, and the sealed payload digest; the serving side checks interpretation
 * against its replayed governance state and answers under the workspace's
 * current transit key. Every response's handshake returns the dialer's own
 * transit envelope, which is how an admitted Peer learns a rotated key or
 * bootstraps after adoption — no Home access token, daemon control, or
 * provider logic crosses this boundary.
 */

const REPLICA_EXCHANGE_PROTOCOL = "lode-peer-exchange/v1";

class ReplicaExchangeRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplicaExchangeRejected";
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
function peerChallenge(input: ChallengeInput): Uint8Array {
  const digest = createHash("sha256").update(input.payload).digest("hex");
  const canonical = [
    REPLICA_EXCHANGE_PROTOCOL,
    input.workspaceId,
    input.peerId,
    input.nonce,
    input.documentId,
    digest,
  ].join("\n");
  return new TextEncoder().encode(canonical);
}

type ServingWorkspace = Readonly<{
  workspaceId: string;
  facts: Readonly<{ snapshot(): FactSnapshot }>;
  openTransitKey(state: GovernanceState): Uint8Array;
  peer(): ReplicaPeer;
}>;

/** The serving side: verify, gate on snapshot, seal under the transit key. */
export class ReplicaExchangeGateway {
  constructor(private readonly workspace: (workspaceId: string) => ServingWorkspace) {}

  async exchangeProfile(
    proof: ReplicaExchangeProof,
  ): Promise<Readonly<{ handshake: TransitHandshake; sealedProfile: Uint8Array }>> {
    const { state, workspace, transitKey } = this.authenticate(proof, "", new Uint8Array());
    const admitted = syncAdmittedPeers(state).get(proof.peerId);
    if (!admitted) {
      throw new ReplicaExchangeRejected("Peer is not admitted at the current transit epoch");
    }
    const entries = await workspace.peer().profile();
    const profile = new TextEncoder().encode(
      JSON.stringify({
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

  async exchangeFetch(proof: ReplicaExchangeProof, documentId: string, sealedFrom: Uint8Array): Promise<Uint8Array> {
    const { workspace, transitKey } = this.authenticate(proof, documentId, sealedFrom);
    const from = aeadOpen(transitKey, sealedFrom);
    const payload = await workspace.peer().fetch(documentId, from);
    return aeadSeal(transitKey, payload);
  }

  async exchangeSend(proof: ReplicaExchangeProof, documentId: string, sealedPayload: Uint8Array): Promise<void> {
    const { workspace, transitKey } = this.authenticate(proof, documentId, sealedPayload);
    const payload = aeadOpen(transitKey, sealedPayload);
    await workspace.peer().send(documentId, payload);
  }

  private authenticate(
    proof: ReplicaExchangeProof,
    documentId: string,
    sealedPayload: Uint8Array,
  ): Readonly<{ state: GovernanceState; workspace: ServingWorkspace; transitKey: Uint8Array }> {
    const workspace = this.workspace(proof.workspaceId);
    const snapshot = workspace.facts.snapshot();
    const state = projectGovernance(snapshot.facts);
    const publicKey = peerPublicKeyFromId(proof.peerId);
    if (publicKey === null) {
      throw new ReplicaExchangeRejected("Peer id does not encode a public key");
    }
    const challenge = peerChallenge({
      workspaceId: proof.workspaceId,
      peerId: proof.peerId,
      nonce: proof.nonce,
      documentId,
      payload: sealedPayload,
    });
    if (!verifyBytes(challenge, proof.signature, publicKey)) {
      throw new ReplicaExchangeRejected("Peer authentication failed");
    }
    if (!syncAdmittedPeers(state).has(proof.peerId)) {
      throw new ReplicaExchangeRejected("Peer is not admitted to this Workspace");
    }
    const transitKey = workspace.openTransitKey(state);
    return { state, workspace, transitKey };
  }
}

/** The dialing side: sign every request, unseal every response. */
export class OutboundExchange {
  private epochKey: Readonly<{ epoch: number; key: Uint8Array }> | undefined;

  constructor(
    private readonly identity: PeerIdentityCapability,
    private readonly workspaceId: string,
    private readonly wire: ReplicaExchangeWire,
  ) {}

  peer(): ReplicaPeer {
    return {
      profile: async () => {
        const { handshake, sealedProfile } = await this.wire.profile(this.proof("", new Uint8Array()));
        this.adoptHandshake(handshake);
        const plaintext = this.open(sealedProfile);
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
    const key = this.identity.openEnvelope(new Uint8Array([...handshake.envelopeEphemeral, ...handshake.envelopeSeal]));
    this.epochKey = { epoch: handshake.epoch, key };
  }

  private transitKey(): Uint8Array {
    if (!this.epochKey) {
      throw new ReplicaExchangeRejected("No transit handshake yet; profile the remote first");
    }
    return this.epochKey.key;
  }

  private open(sealed: Uint8Array): Uint8Array {
    return aeadOpen(this.transitKey(), sealed);
  }

  private proof(documentId: string, payload: Uint8Array): ReplicaExchangeProof {
    const nonce = randomUUID();
    const peerId = this.identity.peerId();
    return {
      workspaceId: this.workspaceId,
      peerId,
      nonce,
      signature: this.identity.sign(
        peerChallenge({ workspaceId: this.workspaceId, peerId, nonce, documentId, payload }),
      ),
    };
  }
}

export function decodeProfile(bytes: Uint8Array): readonly SyncProfileEntry[] {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ReplicaExchangeRejected("Remote profile is malformed");
  }
  const record = parsed as Readonly<{ entries?: unknown }>;
  if (!Array.isArray(record.entries)) {
    throw new ReplicaExchangeRejected("Remote profile has no entries");
  }
  const documentIds = new Set<string>();
  return record.entries.map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      throw new ReplicaExchangeRejected("Remote profile entry is malformed");
    }
    const candidate = entry as Readonly<{ documentId?: unknown; version?: unknown }>;
    if (
      typeof candidate.documentId !== "string" ||
      candidate.documentId.length === 0 ||
      typeof candidate.version !== "string"
    ) {
      throw new ReplicaExchangeRejected("Remote profile entry is malformed");
    }
    if (documentIds.has(candidate.documentId)) {
      throw new ReplicaExchangeRejected(`Remote profile repeats document identity ${candidate.documentId}`);
    }
    documentIds.add(candidate.documentId);
    return {
      documentId: candidate.documentId,
      version: decodeCanonicalBase64(candidate.version, "Remote profile version"),
    };
  });
}

function decodeBase64(value: string): Uint8Array {
  return decodeCanonicalBase64(value, "Governance envelope");
}

function decodeCanonicalBase64(value: string, label: string): Uint8Array {
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new ReplicaExchangeRejected(`${label} is not canonical base64`);
  }
  return new Uint8Array(decoded);
}
