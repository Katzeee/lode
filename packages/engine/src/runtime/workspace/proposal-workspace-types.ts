import type { ProjectionVersions } from "../../domain/reconcile/index.js";
import type { FactAuthority } from "../authority/fact-authority.js";
import type { ProjectionLifecycleOptions } from "./projection-lifecycle/index.js";

export type ProposalWorkspaceOptions = Readonly<{
  workspaceId: string;
  facts: FactAuthority;
  versions: ProjectionVersions;
  reviewCapabilityKey?: string;
  projection?: ProjectionLifecycleOptions;
}>;
