import type {
  HardDeletePreview as ProtocolHardDeletePreview,
  HardDeleteSelection as ProtocolHardDeleteSelection,
} from "@lode/protocol/dto/maintenance";
import type { ProtocolDto } from "./model.js";
import type { HardDeleteBlocker } from "./protocol-enums/maintenance.js";
import type { FactActionId, FactId } from "./fact-identities.js";

export type HardDeleteSelection = Omit<
  ProtocolDto<ProtocolHardDeleteSelection>,
  "deletionActionIds" | "acknowledgementFactIds"
> &
  Readonly<{
    deletionActionIds: readonly FactActionId[];
    acknowledgementFactIds: readonly FactId[];
  }>;
export type { HardDeleteBlocker };
export type HardDeletePreview = Omit<
  ProtocolDto<ProtocolHardDeletePreview>,
  "selection" | "blockers" | "historyImpact"
> &
  Readonly<{
    selection: HardDeleteSelection;
    blockers: readonly HardDeleteBlocker[];
    historyImpact: NonNullable<ProtocolDto<ProtocolHardDeletePreview>["historyImpact"]>;
  }>;
