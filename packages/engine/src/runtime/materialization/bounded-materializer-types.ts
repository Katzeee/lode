export type MaterializedShard = Readonly<{
  key: string;
  generationId: string;
  value: unknown;
}>;

export type BoundedMaterializerOptions = Readonly<{
  capacity?: number;
}>;
