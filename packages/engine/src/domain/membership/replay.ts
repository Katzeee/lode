import {
  actorPublicKeyFromId,
  verifyActorSignature,
  type ActorPublicKey,
} from "../../crypto/index.js";
import type { MembershipRecord, MembershipState } from "./model.js";

export function deriveMembershipState(records: readonly MembershipRecord[]): {
  state: MembershipState;
  skipped: MembershipRecord[];
} {
  const state: MembershipState = { owner: "", peers: new Map(), currentEpoch: -1 };
  const skipped: MembershipRecord[] = [];
  for (const record of records) {
    const signatureValid = verifySignature(record);
    const authorized = authorize(state, record);
    const rootOwnerSignerMismatch =
      record.body.case === "root" && record.body.value.owner !== record.signer;
    const staleAdd = record.body.case === "add" && record.body.value.epoch < state.currentEpoch;
    const staleRotate =
      record.body.case === "rotate" && record.body.value.epoch <= state.currentEpoch;
    const transferTargetUnknown =
      record.body.case === "transfer" && !actorHasPeer(state, record.body.value.newOwner);
    const rotateDropsOwner =
      record.body.case === "rotate" &&
      !record.body.value.wrapped.some((peer) => peer.owningActorId === state.owner);
    const transferToSelf =
      record.body.case === "transfer" && record.body.value.newOwner === state.owner;
    if (
      !signatureValid ||
      !authorized ||
      rootOwnerSignerMismatch ||
      staleAdd ||
      staleRotate ||
      transferTargetUnknown ||
      rotateDropsOwner ||
      transferToSelf
    ) {
      skipped.push(record);
      continue;
    }
    apply(state, record);
  }
  return { state, skipped };
}

export function actorHasPeer(state: MembershipState, actorId: string): boolean {
  for (const peer of state.peers.values()) {
    if (peer.owningActorId === actorId) {
      return true;
    }
  }
  return false;
}

function authorize(state: MembershipState, record: MembershipRecord): boolean {
  if (record.body.case === "root") {
    return state.owner === "";
  }
  if (record.body.case === "add") {
    const ownerAdds = record.signer === state.owner;
    const selfAdds =
      record.signer === record.body.value.owningActor &&
      actorHasPeer(state, record.signer) &&
      state.owner !== "";
    return ownerAdds || selfAdds;
  }
  return record.body.case !== undefined && record.signer === state.owner;
}

function apply(state: MembershipState, record: MembershipRecord): void {
  const body = record.body;
  if (body.case === "root") {
    state.owner = body.value.owner;
    state.peers.set(body.value.ownerPeerId, {
      owningActorId: body.value.owner,
      peerEncPub: body.value.ownerPeerEncPub,
      epoch: body.value.epoch,
      wrappedTransit: body.value.wrappedTransit,
      peerName: body.value.peerName,
    });
    state.currentEpoch = body.value.epoch;
    return;
  }
  if (body.case === "add") {
    state.peers.set(body.value.peerId, {
      owningActorId: body.value.owningActor,
      peerEncPub: body.value.peerEncPub,
      epoch: body.value.epoch,
      wrappedTransit: body.value.wrappedTransit,
      peerName: body.value.peerName,
    });
    return;
  }
  if (body.case === "rotate") {
    const survivors = new Set(body.value.wrapped.map((peer) => peer.peerId));
    for (const peerId of [...state.peers.keys()]) {
      if (!survivors.has(peerId)) {
        state.peers.delete(peerId);
      }
    }
    for (const wrapped of body.value.wrapped) {
      const existing = state.peers.get(wrapped.peerId);
      if (existing === undefined) {
        state.peers.set(wrapped.peerId, {
          owningActorId: wrapped.owningActorId,
          peerEncPub: wrapped.peerEncPub,
          epoch: body.value.epoch,
          wrappedTransit: wrapped.wrappedTransit,
          peerName: wrapped.peerName,
        });
      } else {
        existing.wrappedTransit = wrapped.wrappedTransit;
        existing.epoch = body.value.epoch;
      }
    }
    state.currentEpoch = body.value.epoch;
    return;
  }
  if (body.case === "transfer") {
    state.owner = body.value.newOwner;
  }
}

function verifySignature(record: MembershipRecord): boolean {
  if (record.body.case === undefined) {
    return false;
  }
  let signPublicKey: ActorPublicKey;
  try {
    signPublicKey = actorPublicKeyFromId(record.signer);
  } catch {
    return false;
  }
  return verifyActorSignature(signPublicKey, record.signedBytes, record.sig);
}
