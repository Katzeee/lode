import type {
  ProjectionCheckpointStore,
  ProjectionGenerationReader,
  ProjectionIdentityReader,
  ProjectionPageReader,
  ProjectionPublisher,
  ReviewReadModelReader,
  ProjectionSchemaSearchReader,
  ProjectionSnapshotReader,
} from "../../materialization/index.js";

export type WorkspaceProjectionAccess = ProjectionPublisher &
  ProjectionGenerationReader &
  ProjectionIdentityReader &
  ProjectionSnapshotReader &
  ProjectionPageReader &
  ReviewReadModelReader &
  ProjectionSchemaSearchReader;

export type ProjectionLifecycleOptions = Readonly<{
  projections?: WorkspaceProjectionAccess;
  checkpoints?: ProjectionCheckpointStore;
}>;
