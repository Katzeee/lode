import type {
  HardDeletePreview as ProtocolHardDeletePreview,
  HardDeleteSelection as ProtocolHardDeleteSelection,
} from "@lode/protocol/dto/maintenance";
import type { ProtocolDto } from "./model.js";
import type { HardDeleteBlocker } from "./protocol-enums/maintenance.js";

export type HardDeleteSelection = ProtocolDto<ProtocolHardDeleteSelection>;
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
