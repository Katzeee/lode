import { fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  AddRecordSchema,
  MembershipRecordSchema,
  RootRecordSchema,
  RotateRecordSchema,
  TransferRecordSchema,
  type MembershipRecord,
} from "@lode/protocol/proto";
import {
  actorPublicKeyFromId,
  verifyActorSignature,
  type ActorPublicKey,
} from "../../utils/crypto/index.js";
import type { MembershipState } from "./membership-log.js";

/**
 * The replay half of the membership log — pure state derivation over a record list (design
 * sync-identity-persistence §2 + §13). Kept in its own module so `membership-log.ts` (the class:
 * builders, persistence, the Loro doc) stays under the lint line cap.
 *
 * The sign pub for any signer is recovered from its actorId (actorId IS the hex of the Ed25519 sign
 * pub), so records carry no sign-pub field. Authorization:
 *  - `root` — self-signed by the owner, valid only as the first record.
 *  - `add` — owner-signed (adding any peer) OR self-signed by the owning actor (self-service; the
 *    signer must already own ≥1 admitted peer).
 *  - `rotate` / `transfer` — owner-signed.
 *
 * A record is SKIPPED (not fatal) if it can't be decoded, its signature fails, its signer is
 * unauthorized, it's a `root` after the first, it's a `root` whose declared owner ≠ signer, it's an
 * `add` whose join epoch trails the current (staleAdd — closes the concurrent add-vs-rotate edge
 * self-service reopens), it's a `transfer` to a non-member actor or to the current owner, or it's a
 * `rotate` whose epoch isn't strictly ahead OR that drops every owner peer. Deterministic given the
 * merged list → every replica converges to the same membership.
 */

/** Replay every record in `rawRecords` (base64-encoded `MembershipRecord` bytes, as stored in the Loro
 *  list) into a membership state + the records that were skipped. */
export function deriveMembershipState(rawRecords: unknown[]): {
  state: MembershipState;
  skipped: MembershipRecord[];
} {
  const state: MembershipState = {
    owner: "",
    peers: new Map(),
    currentEpoch: -1,
  };
  const skipped: MembershipRecord[] = [];
  for (const raw of rawRecords) {
    let rec: MembershipRecord;
    try {
      rec = fromBinary(MembershipRecordSchema, Buffer.from(raw as string, "base64"));
    } catch {
      // An undecodable entry (e.g. a malformed/garbage push from a bad replica) can't be a valid
      // record — skip it, never let it abort the replay.
      continue;
    }
    const sigOk = verifySignature(rec);
    // A root self-authorizes ONLY as the first record (state.owner === "" → no root seen yet); a
    // later root is skipped, so a former owner can't re-seize governance by appending a new root.
    // `add` is owner-signed OR self-signed by the owning actor. rotate/transfer are owner-only.
    const authOk = authorize(state, rec);
    // A root's declared `owner` must equal its signer — the owner self-signs, so the label must not
    // diverge from the signing key (a forger can't set owner=X and sign with Y's key).
    const rootOwnerSignerMismatch = rec.body.case === "root" && rec.body.value.owner !== rec.signer;
    // An add racing a later rotate-that-omitted-the-actor must not re-admit it on a stale transit:
    // an add whose join epoch trails the current epoch is stale (mirrors staleRotate).
    const staleAdd = rec.body.case === "add" && rec.body.value.epoch < state.currentEpoch;
    const staleRotate = rec.body.case === "rotate" && rec.body.value.epoch <= state.currentEpoch;
    // Transfer must target an actor that already owns ≥1 peer (so the new owner holds the transit
    // key); otherwise governance would move to someone who can't read the workspace.
    const transferTargetUnknown =
      rec.body.case === "transfer" && !actorHasPeer(state, rec.body.value.newOwner);
    // The owner must survive a rotate — every owner peer dropped would brick governance (the owner
    // could no longer unwrap transit to read/produce content). Authority-independent (any-sync's
    // "can't remove the owner" rule). `appendRotate` refuses this too, but the replay is where the
    // state invariant lives.
    const rotateDropsOwner =
      rec.body.case === "rotate" &&
      !rec.body.value.wrapped.some((w) => w.owningActorId === state.owner);
    // Transfer to the current owner is a signed no-op — skip it.
    const transferToSelf = rec.body.case === "transfer" && rec.body.value.newOwner === state.owner;
    if (
      !sigOk ||
      !authOk ||
      rootOwnerSignerMismatch ||
      staleAdd ||
      staleRotate ||
      transferTargetUnknown ||
      rotateDropsOwner ||
      transferToSelf
    ) {
      skipped.push(rec);
      continue;
    }
    apply(state, rec);
  }
  return { state, skipped };
}

/** The canonical bytes a record's signature commits to: the deterministic proto3 encoding of its body
 *  (signer + sig excluded). `repeated` fields keep insertion order, so the wrapped set is canonical.
 *  Shared by the builders (sign) and the replay (verify). */
export function bodyBytes(body: MembershipRecord["body"]): Uint8Array {
  switch (body.case) {
    case "root":
      return toBinary(RootRecordSchema, body.value);
    case "add":
      return toBinary(AddRecordSchema, body.value);
    case "rotate":
      return toBinary(RotateRecordSchema, body.value);
    case "transfer":
      return toBinary(TransferRecordSchema, body.value);
    case undefined:
      return new Uint8Array(0);
  }
}

// ── replay internals ─────────────────────────────────────────────────────────────

/** Is `actorId` a member — does it own ≥1 admitted peer? Shared by replay (transfer-target check,
 *  self-add auth) and the wire membership gate (resolveActorPub). */
export function actorHasPeer(state: MembershipState, actorId: string): boolean {
  for (const d of state.peers.values()) {
    if (d.owningActorId === actorId) {
      return true;
    }
  }
  return false;
}

/** Authorization per record type. Root: first-record only. Add: owner OR owning-actor-self (the self
 *  signer must already own ≥1 peer — established by an earlier owner-add). Rotate/transfer: owner. */
function authorize(state: MembershipState, rec: MembershipRecord): boolean {
  if (rec.body.case === "root") {
    return state.owner === "";
  }
  if (rec.body.case === "add") {
    const b = rec.body.value;
    const ownerAdds = rec.signer === state.owner;
    const selfAdds =
      rec.signer === b.owningActor && actorHasPeer(state, rec.signer) && state.owner !== "";
    return ownerAdds || selfAdds;
  }
  // rotate / transfer
  return rec.signer === state.owner;
}

function apply(state: MembershipState, rec: MembershipRecord): void {
  if (rec.body.case === "root") {
    const b = rec.body.value;
    state.owner = b.owner;
    state.peers.set(b.ownerPeerId, {
      owningActorId: b.owner,
      peerEncPub: b.ownerPeerEncPub,
      epoch: b.epoch,
      wrappedTransit: b.wrappedTransit,
      peerName: b.peerName,
    });
    state.currentEpoch = b.epoch;
  } else if (rec.body.case === "add") {
    const b = rec.body.value;
    state.peers.set(b.peerId, {
      owningActorId: b.owningActor,
      peerEncPub: b.peerEncPub,
      epoch: b.epoch,
      wrappedTransit: b.wrappedTransit,
      peerName: b.peerName,
    });
  } else if (rec.body.case === "rotate") {
    const b = rec.body.value;
    // The wrapped set IS the new peer roster: peers omitted are revoked.
    const survivors = new Set(b.wrapped.map((w) => w.peerId));
    for (const peerId of [...state.peers.keys()]) {
      if (!survivors.has(peerId)) {
        state.peers.delete(peerId);
      }
    }
    for (const w of b.wrapped) {
      const d = state.peers.get(w.peerId);
      if (d) {
        d.wrappedTransit = w.wrappedTransit;
        d.epoch = b.epoch;
      } else {
        // The wrapped set IS the owner-signed roster — a peerId the owner lists IS admitted (the owner
        // attests it by wrapping transit to it). Upserting here is also required for CRDT convergence:
        // a concurrent add(X,epoch=N) + rotate([…,X],epoch=N+1) merge in either order — root→add→rotate
        // (add applies, rotate re-keys X) or root→rotate→add (rotate admits X via this branch; the add
        // is then staleAdd-skipped at epoch N < N+1) — and both orders must land X admitted at epoch N+1.
        state.peers.set(w.peerId, {
          owningActorId: w.owningActorId,
          peerEncPub: w.peerEncPub,
          epoch: b.epoch,
          wrappedTransit: w.wrappedTransit,
          peerName: w.peerName,
        });
      }
    }
    state.currentEpoch = b.epoch;
  } else if (rec.body.case === "transfer") {
    // Ownership moves to an actor that owns ≥1 peer (enforced before apply); they already hold the
    // transit key. (The owner is always a member.)
    state.owner = rec.body.value.newOwner;
  }
}

/** Verify a record's signature. The sign pub is recovered from `rec.signer` (actorId is the hex of the
 *  sign pub). Returns false on any malformed input (bad hex, bad sig) — never throws, so a garbage
 *  record is simply skipped, not fatal to replay. */
function verifySignature(rec: MembershipRecord): boolean {
  if (rec.body.case === undefined) {
    return false;
  }
  let signPub: ActorPublicKey;
  try {
    signPub = actorPublicKeyFromId(rec.signer);
  } catch {
    return false;
  }
  return verifyActorSignature(signPub, bodyBytes(rec.body), rec.sig);
}
