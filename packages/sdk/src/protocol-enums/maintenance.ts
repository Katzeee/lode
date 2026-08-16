import { HardDeleteBlocker as ProtocolHardDeleteBlocker } from "@lode/protocol/dto/maintenance";
import { defineProtocolEnum, type DomainEnum } from "./enum-codec.js";

export const hardDeleteBlocker = defineProtocolEnum<ProtocolHardDeleteBlocker>()(
  {
    [ProtocolHardDeleteBlocker.HARD_DELETE_BLOCKER_UNSPECIFIED]: null,
    [ProtocolHardDeleteBlocker.HARD_DELETE_BLOCKER_ALREADY_PURGED]: "already-purged",
    [ProtocolHardDeleteBlocker.HARD_DELETE_BLOCKER_NOT_IN_TRASH]: "not-in-trash",
    [ProtocolHardDeleteBlocker.HARD_DELETE_BLOCKER_PENDING_PROPOSAL]: "pending-proposal",
    [ProtocolHardDeleteBlocker.HARD_DELETE_BLOCKER_REPLICA_UNCONFIRMED]: "replica-unconfirmed",
    [ProtocolHardDeleteBlocker.HARD_DELETE_BLOCKER_OUTCOME_UNKNOWN]: "outcome-unknown",
    [ProtocolHardDeleteBlocker.HARD_DELETE_BLOCKER_OWNED_DESCENDANTS]: "owned-descendants",
    [ProtocolHardDeleteBlocker.UNRECOGNIZED]: null,
  },
  "Hard Delete blocker",
);
export type HardDeleteBlocker = DomainEnum<typeof hardDeleteBlocker>;
