import type { ProjectionGeneration } from "../../domain/reconcile/index.js";

export type MaterializedShard = Readonly<{
  key: string;
  generationId: string;
  value: unknown;
}>;

export type BoundedMaterializerOptions = Readonly<{
  capacity?: number;
  beforeCommit?: (generation: ProjectionGeneration) => void | Promise<void>;
}>;
