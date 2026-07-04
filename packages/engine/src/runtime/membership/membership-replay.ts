import { fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  AddRecordSchema,
  MembershipRecordSchema,
  RootRecordSchema,
  RotateRecordSchema,
  TransferRecordSchema,
  type MembershipRecord,
} from "@lode/protocol/proto";
import { actorIdFromPublicKey, verifyActorSignature } from "../../utils/crypto/index.js";
import type { MembershipState } from "./membership-log.js";

/**
 * The replay half of the membership log — pure state derivation over a record list (design
 * sync-identity-persistence §2). Kept in its own module so `membership-log.ts` (the class: builders,
 * persistence, the Loro doc) stays under the lint line cap.
 *
 * A record is SKIPPED (not fatal) if it can't be decoded, its signature fails, its signer is unknown,
 * its signer isn't the current owner, it's a `root` after the first, it's a `transfer` to a non-member
 * or to the current owner, it's a `rotate` whose epoch isn't strictly ahead OR that omits the owner, or
 * it's a `root` whose declared owner ≠ actorIdFromPublicKey(ownerSignPub). Deterministic given the
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
    members: new Map(),
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
    const sigOk = verifySignature(state, rec);
    // A root self-authorizes ONLY as the first record (state.owner === "" → no root seen yet); a
    // later root is skipped, so a former owner can't re-seize governance by appending a new root.
    // Any other record must be signed by the current owner.
    const authOk = rec.body.case === "root" ? state.owner === "" : rec.signer === state.owner;
    const staleRotate = rec.body.case === "rotate" && rec.body.value.epoch <= state.currentEpoch;
    // Transfer must target an existing member (design §2: transfer to an existing member); otherwise
    // it would leave the workspace with an owner who holds no transit key (bricked governance).
    const transferTargetUnknown =
      rec.body.case === "transfer" && !state.members.has(rec.body.value.newOwner);
    // The owner always survives a rotate — a rotate that omits the owner would delete them from
    // `members`, after which no remaining member can sign owner-only records (verifySignature looks
    // up members[owner].signPub), bricking governance permanently. Authority-independent (any-sync's
    // "can't remove the owner / can't remove yourself" rule). `appendRotate` refuses this too, but
    // the replay is where the state invariant lives.
    const rotateDropsOwner =
      rec.body.case === "rotate" && !rec.body.value.wrapped.some((w) => w.actorId === state.owner);
    // Transfer to the current owner is a signed no-op — skip it (any-sync rejects self-transfer).
    const transferToSelf = rec.body.case === "transfer" && rec.body.value.newOwner === state.owner;
    // The root's declared `owner` actorId must equal the actorId derived from its embedded
    // `ownerSignPub` — actorId is a pure function of the sign pubkey in our model, so the label
    // must not diverge from the signing key.
    const rootOwnerMismatch =
      rec.body.case === "root" &&
      rec.body.value.owner !== actorIdFromPublicKey(rec.body.value.ownerSignPub);
    if (
      !sigOk ||
      !authOk ||
      staleRotate ||
      transferTargetUnknown ||
      rotateDropsOwner ||
      transferToSelf ||
      rootOwnerMismatch
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

function apply(state: MembershipState, rec: MembershipRecord): void {
  if (rec.body.case === "root") {
    const b = rec.body.value;
    state.owner = b.owner;
    state.members.set(b.owner, {
      signPub: b.ownerSignPub,
      encPub: b.ownerEncPub,
      epoch: b.epoch,
      wrappedTransit: b.wrappedTransit,
    });
    state.currentEpoch = b.epoch;
  } else if (rec.body.case === "add") {
    const b = rec.body.value;
    state.members.set(b.actor, {
      signPub: b.signPub,
      encPub: b.encPub,
      epoch: b.epoch,
      wrappedTransit: b.wrappedTransit,
    });
  } else if (rec.body.case === "rotate") {
    const b = rec.body.value;
    // The wrapped set IS the new membership: members omitted are revoked.
    const survivors = new Set(b.wrapped.map((w) => w.actorId));
    for (const actorId of [...state.members.keys()]) {
      if (!survivors.has(actorId)) {
        state.members.delete(actorId);
      }
    }
    for (const w of b.wrapped) {
      const m = state.members.get(w.actorId);
      if (m) {
        m.wrappedTransit = w.wrappedTransit;
        m.epoch = b.epoch;
      }
    }
    state.currentEpoch = b.epoch;
  } else if (rec.body.case === "transfer") {
    // Ownership moves to a current member (enforced before apply); they're already in `members`, so
    // their signPub is found there for governance verification. (The owner is always a member.)
    state.owner = rec.body.value.newOwner;
  }
}

/** Verify a record's signature. Root self-authorizes (via its embedded owner_sign_pub); every other
 *  record is owner-signed, and the owner is always a member, so their signPub lives in `members`. A
 *  non-owner signer's record is skipped by the auth check regardless. `verifyActorSignature` returns
 *  false on any malformed input (including a missing/empty pubkey), so no extra guard is needed. */
function verifySignature(state: MembershipState, rec: MembershipRecord): boolean {
  if (rec.body.case === undefined) {
    return false;
  }
  const signPub =
    rec.body.case === "root" ? rec.body.value.ownerSignPub : state.members.get(rec.signer)?.signPub;
  return signPub !== undefined && verifyActorSignature(signPub, bodyBytes(rec.body), rec.sig);
}
