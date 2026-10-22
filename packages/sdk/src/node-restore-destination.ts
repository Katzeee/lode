import type { FieldValueDestination } from "@lode/protocol/proto";
import type { ProtocolDto } from "./protocol-dto.js";

export type NodeRestoreDestination =
  Readonly<{ kind: "node"; nodeId: string }> | (Readonly<{ kind: "field" }> & ProtocolDto<FieldValueDestination>);
