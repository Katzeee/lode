import { fromBinary, toBinary } from "@bufbuild/protobuf";
import { WorkspaceCoordinateSchema, type WorkspaceCoordinate } from "@lode/protocol/proto";

// The CLI string form of a WorkspaceCoordinate: the protobuf bytes, base64-encoded — one pasteable
// token the owner hands a joiner out of band. The RPC carries the typed struct; this is presentation.
export function encodeCoordinate(coordinate: WorkspaceCoordinate): string {
  return Buffer.from(toBinary(WorkspaceCoordinateSchema, coordinate)).toString("base64");
}

export function decodeCoordinate(encoded: string): WorkspaceCoordinate {
  return fromBinary(WorkspaceCoordinateSchema, new Uint8Array(Buffer.from(encoded, "base64")));
}
