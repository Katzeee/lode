import { LoroDoc, LoroList } from "loro-crdt";
import {
  aeadDecrypt,
  aeadEncrypt,
  fromHex,
  newTransitKey,
  signEd,
  toHex,
  unwrapKey,
  verifyEd,
  wrapKey,
  type Actor,
} from "./membership-crypto.js";

/**
 * P7 — the membership log (design sync-identity-persistence §2). NOT an ACL: lode has no
 * authoritative server, so there is no "access control list" — this is a replicated, signed,
 * append-only log of *who is in* the workspace, *who owns* it, and each member's *transit key*.
 *
 * Two roles only: **owner** (single governance authority) + **member(rw)**. The owner alone
 * signs governance records; members are full rw. Records:
 *   - `root`   — owner self-signs; carries the owner's transit key wrapped to the owner.
 *   - `add`    — owner adds a member; the current transit key wrapped to them.
 *   - `rotate` — owner re-keys. `wrapped` IS the new membership: every member listed gets the
 *                new transit key; anyone OMITTED is revoked (this is the atomic removeAndRotate
 *                — revocation always re-keys, so there is no separate "remove without rotate").
 *   - `transfer` — owner transfers ownership to an existing member (the new owner already holds
 *                the transit key as a member; only the governance authority changes hands).
 *
 * Validity = signature verifies AND the signer is the current owner (root self-authorizes); a
 * rotate whose epoch isn't strictly ahead of the current is stale (skipped). Invalid records
 * are SKIPPED at replay (not fatal) — deterministic given the merged Loro list, so every replica
 * converges. Owner-only governance means there is no multi-admin concurrent conflict to resolve.
 *
 * Re-key chain: each rotate's `encPrev` = AEAD(newTransitKey, oldTransitKey), so a current
 * member walks back to decrypt transit from any prior epoch; a revoked member cannot. Rotate
 * only re-wraps the transit key (O(members)); content is never re-encrypted (transport-only).
 *
 * The actor key is mnemonic-derived and does not rotate, so the root is self-signed and "same
 * actorId" is cryptographic continuity — no masterKey co-signature (design §2/§3).
 *
 * Records are JSON here for playground simplicity; production uses protobuf in @lode/protocol
 * (Loro stores the bytes either way). Signing canonicalization (sorted keys) is a production
 * concern; the playground validates the algorithm, not the wire format.
 */

export type Member = {
  signPubSpki: Uint8Array;
  encPubSpki: Uint8Array;
  epoch: number;
  /** The current-epoch transit key, wrapped to this member's X25519 pubkey (hex). */
  wrappedTransitKey: string;
};

export type MembershipState = {
  owner: string;
  members: Map<string, Member>;
  currentEpoch: number;
  /** Rotate records by epoch, for the history chain walk. */
  rotates: Map<number, { encPrev: Uint8Array }>;
};

export type MembershipRecord =
  | {
      t: "root";
      owner: string;
      ownerSignSpki: string;
      ownerEnc: string;
      wrapped: string;
      epoch: number;
      signer: string;
      sig: string;
    }
  | {
      t: "add";
      actor: string;
      signSpki: string;
      enc: string;
      wrapped: string;
      epoch: number;
      signer: string;
      sig: string;
    }
  | {
      t: "rotate";
      epoch: number;
      wrapped: Record<string, string>;
      encPrev: string;
      signer: string;
      sig: string;
    }
  | { t: "transfer"; newOwner: string; signer: string; sig: string };

const LOG_CONTAINER = "log";

export class MembershipLog {
  readonly doc: LoroDoc;
  private readonly list: LoroList;

  constructor(doc: LoroDoc = new LoroDoc()) {
    this.doc = doc;
    this.list = doc.getList(LOG_CONTAINER);
  }

  records(): MembershipRecord[] {
    return this.list.toArray().map((s) => JSON.parse(s as string) as MembershipRecord);
  }

  private append(rec: MembershipRecord): void {
    this.list.push(JSON.stringify(rec));
    this.doc.commit();
  }

  exportBytes(): Uint8Array {
    return this.doc.export({ mode: "snapshot" });
  }

  importBytes(bytes: Uint8Array): void {
    this.doc.import(bytes);
  }

  // ── record builders (owner signs + appends) ────────────────────────────────────

  /** Create the workspace: owner self-signs; transit key wrapped to the owner. */
  appendRoot(owner: Actor, transitKey: Uint8Array): void {
    this.append(
      this.sign(
        {
          t: "root",
          owner: owner.actorId,
          ownerSignSpki: toHex(owner.signPubSpki),
          ownerEnc: toHex(owner.encPubSpki),
          wrapped: toHex(wrapKey(owner.encPubSpki, transitKey)),
          epoch: 0,
          signer: owner.actorId,
        },
        owner,
      ),
    );
  }

  /** Owner adds a member; the current transit key wrapped to them. */
  appendAdd(owner: Actor, member: Actor, transitKey: Uint8Array, currentEpoch: number): void {
    this.append(
      this.sign(
        {
          t: "add",
          actor: member.actorId,
          signSpki: toHex(member.signPubSpki),
          enc: toHex(member.encPubSpki),
          wrapped: toHex(wrapKey(member.encPubSpki, transitKey)),
          epoch: currentEpoch,
          signer: owner.actorId,
        },
        owner,
      ),
    );
  }

  /** Owner re-keys. `survivors` IS the new membership: listed members get the new transit key;
   *  anyone omitted is revoked (atomic removeAndRotate). encPrev chains the old key under the
   *  new so current members can walk back to decrypt history. */
  appendRotate(
    owner: Actor,
    survivors: { actorId: string; encPubSpki: Uint8Array }[],
    newKey: Uint8Array,
    oldKey: Uint8Array,
    newEpoch: number,
  ): void {
    const wrapped: Record<string, string> = {};
    for (const s of survivors) {
      wrapped[s.actorId] = toHex(wrapKey(s.encPubSpki, newKey));
    }
    this.append(
      this.sign(
        {
          t: "rotate",
          epoch: newEpoch,
          wrapped,
          encPrev: toHex(aeadEncrypt(newKey, oldKey)),
          signer: owner.actorId,
        },
        owner,
      ),
    );
  }

  /** Owner transfers ownership to an existing member. The new owner already holds the transit
   *  key; only governance authority moves. The old owner stays on as a member. */
  appendTransfer(owner: Actor, newOwnerActorId: string): void {
    this.append(
      this.sign({ t: "transfer", newOwner: newOwnerActorId, signer: owner.actorId }, owner),
    );
  }

  private sign<T extends MembershipRecord>(rec: Omit<T, "sig">, signer: Actor): T {
    const sig = signEd(signer.signPriv, canonicalBytes(rec));
    return { ...(rec as object), sig: toHex(sig) } as T;
  }

  // ── state derivation / decryption ───────────────────────────────────────────────

  /** Replay every record, verifying signatures + owner authorization. A record is SKIPPED
   *  (not fatal) if its signature fails, its signer is unknown, its signer isn't the current
   *  owner, or (rotate) its epoch isn't strictly ahead of the current. Deterministic given
   *  `records()`, so every replica converges to the same membership. */
  deriveState(): { state: MembershipState; skipped: MembershipRecord[] } {
    const state: MembershipState = {
      owner: "",
      members: new Map(),
      currentEpoch: -1,
      rotates: new Map(),
    };
    const skipped: MembershipRecord[] = [];
    for (const rec of this.records()) {
      const signerSpki =
        rec.t === "root" ? fromHex(rec.ownerSignSpki) : state.members.get(rec.signer)?.signPubSpki;
      const sigOk =
        signerSpki !== undefined &&
        verifyEd(signerSpki, canonicalBytes(stripSig(rec)), fromHex(rec.sig));
      // Owner-only governance: every non-root record must be signed by the current owner.
      const authOk = rec.t === "root" || rec.signer === state.owner;
      const staleRotate = rec.t === "rotate" && rec.epoch <= state.currentEpoch;
      if (!sigOk || !authOk || staleRotate) {
        skipped.push(rec);
        continue;
      }
      apply(state, rec);
    }
    return { state, skipped };
  }

  /** A member unwraps its current-epoch transit key. */
  unwrapCurrentTransitKey(state: MembershipState, member: Actor): Uint8Array {
    const m = state.members.get(member.actorId);
    if (!m) {
      throw new Error(`not a member: ${member.actorId}`);
    }
    return unwrapKey(member.encPriv, fromHex(m.wrappedTransitKey));
  }

  /** Walk the re-key chain back to `targetEpoch` (< current). Each rotate's encPrev decrypts the
   *  prior epoch's transit key under the current one. */
  walkHistoryTransitKey(state: MembershipState, member: Actor, targetEpoch: number): Uint8Array {
    if (targetEpoch > state.currentEpoch) {
      throw new Error(
        `target epoch ${targetEpoch} is in the future (current ${state.currentEpoch})`,
      );
    }
    let key = this.unwrapCurrentTransitKey(state, member);
    let epoch = state.currentEpoch;
    while (epoch > targetEpoch) {
      const rot = state.rotates.get(epoch);
      if (!rot) {
        throw new Error(`missing rotate record for epoch ${epoch}`);
      }
      key = aeadDecrypt(key, rot.encPrev);
      epoch--;
    }
    return key;
  }
}

// ── replay apply + canonical signing ──────────────────────────────────────────────

function apply(state: MembershipState, rec: MembershipRecord): void {
  switch (rec.t) {
    case "root": {
      state.owner = rec.owner;
      state.members.set(rec.owner, {
        signPubSpki: fromHex(rec.ownerSignSpki),
        encPubSpki: fromHex(rec.ownerEnc),
        epoch: rec.epoch,
        wrappedTransitKey: rec.wrapped,
      });
      state.currentEpoch = rec.epoch;
      break;
    }
    case "add": {
      state.members.set(rec.actor, {
        signPubSpki: fromHex(rec.signSpki),
        encPubSpki: fromHex(rec.enc),
        epoch: rec.epoch,
        wrappedTransitKey: rec.wrapped,
      });
      break;
    }
    case "rotate": {
      // The wrapped set IS the new membership: members omitted are revoked.
      for (const actorId of [...state.members.keys()]) {
        if (!(actorId in rec.wrapped)) {
          state.members.delete(actorId);
        }
      }
      for (const [actorId, wrapped] of Object.entries(rec.wrapped)) {
        const m = state.members.get(actorId);
        if (m) {
          m.wrappedTransitKey = wrapped;
          m.epoch = rec.epoch;
        }
      }
      state.rotates.set(rec.epoch, { encPrev: fromHex(rec.encPrev) });
      state.currentEpoch = rec.epoch;
      break;
    }
    case "transfer": {
      state.owner = rec.newOwner;
      break;
    }
  }
}

function canonicalBytes(rec: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(rec));
}

function stripSig(rec: MembershipRecord): Record<string, unknown> {
  const { sig: _sig, ...rest } = rec;
  return rest as Record<string, unknown>;
}

// Re-exported for tests that need to mint a fresh transit key.
export { newTransitKey };
