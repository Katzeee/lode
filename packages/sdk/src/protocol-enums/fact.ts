import { FactActionKind as ProtocolFactActionKind } from "@lode/protocol/proto";
import { protocolEnum, type DomainEnum } from "./enum-codec.js";

export const factActionKind = protocolEnum(ProtocolFactActionKind, "Fact action kind");
export type FactActionKind = DomainEnum<typeof factActionKind>;
