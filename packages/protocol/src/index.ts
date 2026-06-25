// @lode/protocol — the language-neutral wire contract. The single source of truth is the
// protobuf under protos/; this re-exports the buf-generated TS types + the LodeCommands
// Connect service descriptor. (Equivalent to importing from "@lode/protocol/proto".)
export * from "./proto.js";
