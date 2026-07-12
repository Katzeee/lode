import { fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  AddRecordSchema,
  MembershipRecordSchema,
  RootRecordSchema,
  RotateRecordSchema,
  TransferRecordSchema,
  type MembershipRecord as ProtoMembershipRecord,
  type PeerWrap as ProtoPeerWrap,
} from "@lode/protocol/proto";
import type { MembershipBody, MembershipRecord, PeerWrap } from "../../domain/membership/model.js";

export function decodeMembershipRecord(bytes: Uint8Array): MembershipRecord | null {
  let record: ProtoMembershipRecord;
  try {
    record = fromBinary(MembershipRecordSchema, bytes);
  } catch {
    return null;
  }
  return {
    signer: record.signer,
    sig: record.sig,
    body: decodeBody(record.body),
    signedBytes: bodyBytes(record.body),
  };
}

export function bodyBytes(body: ProtoMembershipRecord["body"]): Uint8Array {
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

function decodeBody(body: ProtoMembershipRecord["body"]): MembershipBody {
  switch (body.case) {
    case "root":
      return { case: "root", value: { ...body.value } };
    case "add":
      return { case: "add", value: { ...body.value } };
    case "rotate":
      return {
        case: "rotate",
        value: {
          epoch: body.value.epoch,
          encPrev: body.value.encPrev,
          wrapped: body.value.wrapped.map(decodePeerWrap),
        },
      };
    case "transfer":
      return { case: "transfer", value: { ...body.value } };
    case undefined:
      return { case: undefined };
  }
}

function decodePeerWrap(peer: ProtoPeerWrap): PeerWrap {
  return { ...peer };
}
