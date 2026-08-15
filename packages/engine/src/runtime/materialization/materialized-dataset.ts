export type MaterializedDatasetRoot = Readonly<{
  dataset: string;
  partition: string;
  section: string;
}>;

export type MaterializedDatasetEntry<Value = unknown> = MaterializedDatasetRoot &
  Readonly<{
    identity: string;
    value: Value;
  }>;

export type MaterializedDataset<Value = unknown> = Readonly<{
  root: MaterializedDatasetRoot;
  isValue(identity: string, value: unknown): value is Value;
}>;

export type MaterializedDatasetCatalog<Identity> = Readonly<{
  roots: readonly MaterializedDatasetRoot[];
  isGenerationIdentity(value: unknown, generationId: string): value is Identity;
  isRoot(root: MaterializedDatasetRoot): boolean;
  isValue(root: MaterializedDatasetRoot, identity: string, value: unknown): boolean;
}>;

export function materializedDatasetCatalog<Identity>(
  datasets: readonly MaterializedDataset[],
  isGenerationIdentity: (value: unknown, generationId: string) => value is Identity,
): MaterializedDatasetCatalog<Identity> {
  const roots = datasets.map((dataset) => dataset.root);
  const datasetsByRoot = new Map<string, MaterializedDataset>();
  for (const dataset of datasets) {
    const key = materializedDatasetRootKey(dataset.root);
    if (datasetsByRoot.has(key)) {
      throw new Error(`Materialized dataset root is declared twice: ${key}`);
    }
    datasetsByRoot.set(key, dataset);
  }
  return {
    roots,
    isGenerationIdentity,
    isRoot: (root) => datasetsByRoot.has(materializedDatasetRootKey(root)),
    isValue: (root, identity, value) =>
      datasetsByRoot.get(materializedDatasetRootKey(root))?.isValue(identity, value) ?? false,
  };
}

export function defineMaterializedDataset<Value>(
  root: MaterializedDatasetRoot,
  isValue: (identity: string, value: unknown) => value is Value,
): MaterializedDataset<Value> {
  return { root, isValue };
}

export function materializedDatasetEntry<Value>(
  dataset: MaterializedDataset<Value>,
  identity: string,
  value: NoInfer<Value>,
): MaterializedDatasetEntry<Value> {
  return { ...dataset.root, identity, value };
}

export function materializedDatasetRootKey(root: MaterializedDatasetRoot): string {
  return `${root.dataset}/${root.partition}/${root.section}`;
}

export function sameMaterializedDatasetRoot(left: MaterializedDatasetRoot, right: MaterializedDatasetRoot): boolean {
  return left.dataset === right.dataset && left.partition === right.partition && left.section === right.section;
}
