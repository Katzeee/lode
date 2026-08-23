import { spawnSync } from "node:child_process";
import { rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createReviewReadModel, type ReviewReadModel } from "../../src/domain/review/index.js";
import {
  CURRENT_PROJECTION_VERSIONS,
  rebuildGeneration,
  type ProjectionGeneration,
} from "../../src/domain/reconcile/index.js";
import type { DocumentStore, DocumentUpdate, LoadedDocumentBytes } from "../../src/subsystems/persistence/index.js";
import { InMemoryDocumentStore } from "../../src/subsystems/persistence/index.js";
import { SqliteDocumentStore } from "../../src/subsystems/persistence/sqlite-document-store.js";
import { SqliteWorkspaceStore } from "../../src/subsystems/persistence/sqlite-workspace-store.js";
import { BoundedProjectionStore } from "../../src/subsystems/workspace/projection/materialization/index.js";
import { MATERIALIZED_DATASETS } from "../../src/subsystems/workspace/projection/materialization/materialized-datasets.js";
import { loadMaterializedProjection } from "../../src/subsystems/workspace/projection/materialization/materialized-projection-loader.js";
import { projectionMaterializedEntries } from "../../src/subsystems/workspace/projection/materialization/projection-materialized-dataset.js";
import { reviewReadModelEntries } from "../../src/subsystems/workspace/projection/materialization/materialized-review-read-model.js";
import type { MaterializedDatasetEntry } from "../../src/subsystems/workspace/projection/materialization/store/materialized-dataset.js";
import { materializedDatasetRootKey } from "../../src/subsystems/workspace/projection/materialization/store/materialized-dataset.js";
import { Facts } from "../support/reconcile/reconcile-test-helpers.js";

const WORKSPACE_ID = "workspace";
const MONOLITH_ID = "spike/projection-monolith";
const CHUNK_SIZE = Number(process.env.LODE_SPIKE_CHUNK_SIZE ?? 256);
const mebibyte = 1024 * 1024;

type Route =
  | "rebuild"
  | "current-publish"
  | "current-restore"
  | "current-page"
  | "monolith-publish"
  | "monolith-restore"
  | "monolith-page"
  | "chunked-publish"
  | "chunked-restore"
  | "chunked-page";
type Backend = "memory" | "sqlite";

type Measurement = Readonly<{
  route: Route;
  backend: Backend;
  nodes: number;
  facts: number;
  elapsedMs: number;
  heapDeltaMiB: number;
  retainedHeapMiB: number;
  rssDeltaMiB: number;
  documents: number;
  writtenMiB: number;
  readDocuments: number;
  readMiB: number;
  sqliteMiB: number | null;
}>;

type StoredEntry = Readonly<{
  dataset: string;
  partition: string;
  section: string;
  identity: string;
  value: unknown;
}>;

type ChunkDescriptor = Readonly<{
  id: string;
  root: string;
  minIdentity: string;
  maxIdentity: string;
  count: number;
}>;

type ChunkManifest = Readonly<{
  format: "projection-chunks-spike-v1";
  identity: ProjectionGeneration["identity"];
  chunks: readonly ChunkDescriptor[];
}>;

class MeasuringDocumentStore implements DocumentStore {
  readonly ids = new Set<string>();
  writtenBytes = 0;
  readDocuments = 0;
  readBytes = 0;
  peakHeap = process.memoryUsage().heapUsed;
  peakRss = process.memoryUsage().rss;

  constructor(private readonly delegate: DocumentStore) {}

  async load(id: string): Promise<LoadedDocumentBytes | null> {
    const loaded = await this.delegate.load(id);
    this.readDocuments += 1;
    this.readBytes +=
      (loaded?.snapshot?.byteLength ?? 0) +
      (loaded?.updates.reduce((total, update) => total + update.byteLength, 0) ?? 0);
    this.sample();
    return loaded;
  }

  async listIds(query?: Readonly<{ prefix?: string; after?: string; limit?: number }>): Promise<string[]> {
    const ids = await this.delegate.listIds(query);
    this.sample();
    return ids;
  }

  async appendUpdate(id: string, bytes: Uint8Array): Promise<number> {
    const sequence = await this.delegate.appendUpdate(id, bytes);
    this.ids.add(id);
    this.writtenBytes += bytes.byteLength;
    this.sample();
    return sequence;
  }

  async appendUpdates(updates: readonly DocumentUpdate[]): Promise<readonly number[]> {
    const sequences = await this.delegate.appendUpdates(updates);
    for (const { id, bytes } of updates) {
      this.ids.add(id);
      this.writtenBytes += bytes.byteLength;
    }
    this.sample();
    return sequences;
  }

  async writeSnapshot(id: string, bytes: Uint8Array): Promise<void> {
    await this.delegate.writeSnapshot(id, bytes);
    this.ids.add(id);
    this.writtenBytes += bytes.byteLength;
    this.sample();
  }

  async delete(id: string): Promise<void> {
    await this.delegate.delete(id);
    this.ids.delete(id);
    this.sample();
  }

  sample(): void {
    const memory = process.memoryUsage();
    this.peakHeap = Math.max(this.peakHeap, memory.heapUsed);
    this.peakRss = Math.max(this.peakRss, memory.rss);
  }

  resetActivity(): void {
    this.writtenBytes = 0;
    this.readDocuments = 0;
    this.readBytes = 0;
  }

  startMeasurement(memory: NodeJS.MemoryUsage): void {
    this.peakHeap = memory.heapUsed;
    this.peakRss = memory.rss;
  }
}

if (process.argv[2] === "--worker") {
  const route = process.argv[3] as Route;
  const backend = process.argv[4] as Backend;
  const nodes = Number(process.argv[5]);
  const result = await measure(route, backend, nodes);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} else {
  runCoordinator();
}

function runCoordinator(): void {
  const quick = process.argv.includes("--quick");
  const scales = quick ? [100] : [1_000, 5_000, 15_000];
  const routes: readonly Route[] = [
    "rebuild",
    "current-publish",
    "current-restore",
    "current-page",
    "monolith-publish",
    "monolith-restore",
    "monolith-page",
    "chunked-publish",
    "chunked-restore",
    "chunked-page",
  ];
  const rows: Measurement[] = [];
  for (const nodes of scales) {
    for (const route of routes) {
      rows.push(runWorker(route, "memory", nodes, quick ? 1 : 3));
    }
    if (!quick && nodes <= 5_000) {
      for (const route of routes.filter((candidate) => candidate !== "rebuild")) {
        rows.push(runWorker(route, "sqlite", nodes, 3));
      }
    }
  }
  console.table(
    rows.map((row) => ({
      nodes: row.nodes,
      backend: row.backend,
      route: row.route,
      ms: row.elapsedMs,
      heapMiB: row.heapDeltaMiB,
      retainedMiB: row.retainedHeapMiB,
      rssMiB: row.rssDeltaMiB,
      docs: row.documents,
      writtenMiB: row.writtenMiB,
      reads: row.readDocuments,
      readMiB: row.readMiB,
      sqliteMiB: row.sqliteMiB,
    })),
  );
  process.stdout.write(`RESULTS_JSON=${JSON.stringify(rows)}\n`);
}

function runWorker(route: Route, backend: Backend, nodes: number, repetitions: number): Measurement {
  const results: Measurement[] = [];
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    const child = spawnSync(
      process.execPath,
      [
        "--expose-gc",
        "--import",
        "tsx",
        resolve(import.meta.dirname, "projection-storage.benchmark.ts"),
        "--worker",
        route,
        backend,
        String(nodes),
      ],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    if (child.status !== 0) {
      throw new Error(`Benchmark worker failed (${route}, ${backend}, ${nodes}):\n${child.stderr}\n${child.stdout}`);
    }
    const line = child.stdout.trim().split(/\r?\n/).at(-1);
    if (!line) {
      throw new Error("Benchmark worker produced no result");
    }
    results.push(JSON.parse(line) as Measurement);
  }
  return results.toSorted((left, right) => left.elapsedMs - right.elapsedMs)[Math.floor(results.length / 2)]!;
}

async function measure(route: Route, backend: Backend, nodes: number): Promise<Measurement> {
  const snapshot = fixture(nodes);
  let sqlite: SqliteWorkspaceStore | null = null;
  let sqlitePath: string | null = null;
  const createDocuments = async () => {
    if (backend === "memory") {
      return new MeasuringDocumentStore(new InMemoryDocumentStore());
    }
    sqlitePath = resolve(tmpdir(), `lode-projection-spike-${process.pid}-${route}-${nodes}.sqlite`);
    rmSync(sqlitePath, { force: true });
    sqlite = await SqliteWorkspaceStore.open(sqlitePath);
    return new MeasuringDocumentStore(new SqliteDocumentStore(sqlite));
  };

  let documents: MeasuringDocumentStore | null = null;
  let operation: () => Promise<unknown> | unknown;
  if (route === "rebuild") {
    operation = () => {
      const generation = rebuildGeneration(WORKSPACE_ID, snapshot, CURRENT_PROJECTION_VERSIONS);
      return { generation, review: createReviewReadModel(snapshot, generation) };
    };
  } else {
    documents = await createDocuments();
    operation = await prepareStorageRoute(route, documents, snapshot);
  }

  forceGc();
  const baseline = process.memoryUsage();
  documents?.startMeasurement(baseline);
  const started = performance.now();
  const value = await operation();
  const elapsedMs = performance.now() - started;
  keepAlive(value);
  documents?.sample();
  const completed = process.memoryUsage();
  const peakHeap = Math.max(completed.heapUsed, documents?.peakHeap ?? completed.heapUsed);
  const peakRss = Math.max(completed.rss, documents?.peakRss ?? completed.rss);
  forceGc();
  const retained = process.memoryUsage();

  if (sqlite) {
    await sqlite.close();
  }
  const sqliteMiB = sqlitePath && statExists(sqlitePath) ? round(statSync(sqlitePath).size / mebibyte) : null;
  if (sqlitePath) {
    rmSync(sqlitePath, { force: true });
  }
  return {
    route,
    backend,
    nodes,
    facts: snapshot.facts.length,
    elapsedMs: round(elapsedMs),
    heapDeltaMiB: round((peakHeap - baseline.heapUsed) / mebibyte),
    retainedHeapMiB: round((retained.heapUsed - baseline.heapUsed) / mebibyte),
    rssDeltaMiB: round((peakRss - baseline.rss) / mebibyte),
    documents: documents?.ids.size ?? 0,
    writtenMiB: round((documents?.writtenBytes ?? 0) / mebibyte),
    readDocuments: documents?.readDocuments ?? 0,
    readMiB: round((documents?.readBytes ?? 0) / mebibyte),
    sqliteMiB,
  };
}

async function prepareStorageRoute(
  route: Exclude<Route, "rebuild">,
  documents: MeasuringDocumentStore,
  snapshot: ReturnType<Facts["snapshot"]>,
): Promise<() => Promise<unknown>> {
  if (route === "current-publish") {
    const generation = rebuildGeneration(WORKSPACE_ID, snapshot, CURRENT_PROJECTION_VERSIONS);
    const review = createReviewReadModel(snapshot, generation);
    const store = new BoundedProjectionStore(documents);
    return () => store.publish(generation, review);
  }
  if (route === "monolith-publish") {
    const generation = rebuildGeneration(WORKSPACE_ID, snapshot, CURRENT_PROJECTION_VERSIONS);
    const review = createReviewReadModel(snapshot, generation);
    return () => writeMonolith(documents, generation, review);
  }
  if (route === "chunked-publish") {
    const generation = rebuildGeneration(WORKSPACE_ID, snapshot, CURRENT_PROJECTION_VERSIONS);
    const review = createReviewReadModel(snapshot, generation);
    return () => writeChunks(documents, generation, review);
  }
  if (route === "current-restore") {
    const generationId = await seedCurrent(documents, snapshot);
    const store = new BoundedProjectionStore(documents);
    documents.resetActivity();
    return () => store.restore(generationId);
  }
  if (route === "current-page") {
    const generationId = await seedCurrent(documents, snapshot);
    const store = new BoundedProjectionStore(documents);
    documents.resetActivity();
    return () => store.page(generationId, "origin", "nodes", null, 100);
  }
  if (route === "monolith-restore") {
    await seedMonolith(documents, snapshot);
    documents.resetActivity();
    return () => readMonolith(documents);
  }
  if (route === "monolith-page") {
    await seedMonolith(documents, snapshot);
    documents.resetActivity();
    return async () => Object.entries((await readMonolith(documents)).origin.nodes).slice(0, 100);
  }
  const generationId = await seedChunks(documents, snapshot);
  documents.resetActivity();
  return route === "chunked-restore"
    ? () => readChunks(documents, generationId)
    : () => readChunkPage(documents, generationId, "projection/origin/nodes", null, 100);
}

async function seedCurrent(
  documents: MeasuringDocumentStore,
  snapshot: ReturnType<Facts["snapshot"]>,
): Promise<string> {
  const generation = rebuildGeneration(WORKSPACE_ID, snapshot, CURRENT_PROJECTION_VERSIONS);
  const store = new BoundedProjectionStore(documents);
  await store.publish(generation, createReviewReadModel(snapshot, generation));
  return generation.identity.generationId;
}

async function seedMonolith(documents: MeasuringDocumentStore, snapshot: ReturnType<Facts["snapshot"]>): Promise<void> {
  const generation = rebuildGeneration(WORKSPACE_ID, snapshot, CURRENT_PROJECTION_VERSIONS);
  await writeMonolith(documents, generation, createReviewReadModel(snapshot, generation));
}

async function seedChunks(documents: MeasuringDocumentStore, snapshot: ReturnType<Facts["snapshot"]>): Promise<string> {
  const generation = rebuildGeneration(WORKSPACE_ID, snapshot, CURRENT_PROJECTION_VERSIONS);
  await writeChunks(documents, generation, createReviewReadModel(snapshot, generation));
  return generation.identity.generationId;
}

async function writeMonolith(
  documents: DocumentStore,
  generation: ProjectionGeneration,
  review: ReviewReadModel,
): Promise<void> {
  await documents.writeSnapshot(MONOLITH_ID, encode({ format: "projection-monolith-spike-v1", generation, review }));
}

async function readMonolith(documents: DocumentStore): Promise<ProjectionGeneration> {
  const stored = await documents.load(MONOLITH_ID);
  if (!stored?.snapshot || stored.updates.length !== 0) {
    throw new Error("Monolithic checkpoint is absent");
  }
  const parsed = JSON.parse(new TextDecoder().decode(stored.snapshot)) as {
    generation: ProjectionGeneration;
    review: ReviewReadModel;
  };
  validateEntries(parsed.generation, parsed.review);
  return parsed.generation;
}

async function writeChunks(
  documents: DocumentStore,
  generation: ProjectionGeneration,
  review: ReviewReadModel,
): Promise<void> {
  const grouped = Map.groupBy(allEntries(generation, review), (entry) => materializedDatasetRootKey(entry));
  const chunks: ChunkDescriptor[] = [];
  let ordinal = 0;
  for (const [root, entries] of [...grouped].sort(([left], [right]) => left.localeCompare(right))) {
    const sorted = entries.toSorted((left, right) => left.identity.localeCompare(right.identity));
    for (let index = 0; index < sorted.length; index += CHUNK_SIZE) {
      const selected = sorted.slice(index, index + CHUNK_SIZE);
      const id = `spike/projection-chunks/${generation.identity.generationId}/${ordinal++}`;
      await documents.writeSnapshot(id, encode(selected));
      chunks.push({
        id,
        root,
        minIdentity: selected[0]?.identity ?? "",
        maxIdentity: selected.at(-1)?.identity ?? "",
        count: selected.length,
      });
    }
  }
  const manifest: ChunkManifest = {
    format: "projection-chunks-spike-v1",
    identity: generation.identity,
    chunks,
  };
  await documents.writeSnapshot(chunkManifestId(generation.identity.generationId), encode(manifest));
}

async function readChunks(documents: DocumentStore, generationId: string): Promise<ProjectionGeneration> {
  const manifest = await readChunkManifest(documents, generationId);
  const entries: StoredEntry[] = [];
  for (const descriptor of manifest.chunks) {
    const stored = await documents.load(descriptor.id);
    if (!stored?.snapshot || stored.updates.length !== 0) {
      throw new Error("Checkpoint chunk is absent");
    }
    const chunk = JSON.parse(new TextDecoder().decode(stored.snapshot)) as StoredEntry[];
    entries.push(...chunk);
  }
  validateStoredEntries(entries);
  const projectionEntries = (perspective: "origin" | "review") =>
    entries
      .filter(
        (entry) =>
          entry.dataset === "projection" &&
          entry.partition === perspective &&
          !entry.section.endsWith("ByNode") &&
          !entry.section.endsWith("ByOwner") &&
          !entry.section.endsWith("BySupertag") &&
          !entry.section.endsWith("ByTemplate") &&
          !entry.section.endsWith("ByOccurrence") &&
          entry.section !== "nodeIdsByFieldDefinition" &&
          entry.section !== "supertagInstanceMemberships",
      )
      .map((entry) => ({
        descriptor: { ...entry, documentId: "spike", key: "spike", contentDigest: "spike" },
        value: entry.value,
      }));
  const planCaches = entries.find(
    (entry) => entry.dataset === "projection" && entry.partition === "generation" && entry.section === "planCaches",
  )?.value as ProjectionGeneration["planCaches"] | undefined;
  if (!planCaches) {
    throw new Error("Chunked plan cache is absent");
  }
  return {
    identity: manifest.identity,
    origin: loadMaterializedProjection("origin", manifest.identity, projectionEntries("origin")),
    review: loadMaterializedProjection("review", manifest.identity, projectionEntries("review")),
    planCaches,
  };
}

async function readChunkPage(
  documents: DocumentStore,
  generationId: string,
  root: string,
  after: string | null,
  limit: number,
): Promise<readonly StoredEntry[]> {
  const manifest = await readChunkManifest(documents, generationId);
  const descriptors = manifest.chunks.filter(
    (descriptor) => descriptor.root === root && (after === null || descriptor.maxIdentity > after),
  );
  const entries: StoredEntry[] = [];
  for (const descriptor of descriptors) {
    const stored = await documents.load(descriptor.id);
    if (!stored?.snapshot || stored.updates.length !== 0) {
      throw new Error("Checkpoint chunk is absent");
    }
    const chunk = JSON.parse(new TextDecoder().decode(stored.snapshot)) as StoredEntry[];
    for (const entry of chunk) {
      if (after === null || entry.identity > after) {
        entries.push(entry);
        if (entries.length === limit) {
          validateStoredEntries(entries);
          return entries;
        }
      }
    }
  }
  validateStoredEntries(entries);
  return entries;
}

async function readChunkManifest(documents: DocumentStore, generationId: string): Promise<ChunkManifest> {
  const storedManifest = await documents.load(chunkManifestId(generationId));
  if (!storedManifest?.snapshot || storedManifest.updates.length !== 0) {
    throw new Error("Chunk manifest is absent");
  }
  return JSON.parse(new TextDecoder().decode(storedManifest.snapshot)) as ChunkManifest;
}

function chunkManifestId(generationId: string): string {
  return `spike/projection-chunks/manifest/${generationId}`;
}

function validateEntries(generation: ProjectionGeneration, review: ReviewReadModel): void {
  validateStoredEntries(allEntries(generation, review));
}

function validateStoredEntries(entries: readonly StoredEntry[]): void {
  for (const entry of entries) {
    if (!MATERIALIZED_DATASETS.isRoot(entry) || !MATERIALIZED_DATASETS.isValue(entry, entry.identity, entry.value)) {
      throw new Error("Checkpoint entry violates its dataset contract");
    }
  }
}

function allEntries(generation: ProjectionGeneration, review: ReviewReadModel): readonly MaterializedDatasetEntry[] {
  return [...projectionMaterializedEntries(generation), ...reviewReadModelEntries(review)];
}

function fixture(nodes: number): ReturnType<Facts["snapshot"]> {
  const facts = new Facts();
  for (let index = 0; index < nodes; index += 1) {
    const parentIndex = Math.floor((index - 1) / 10);
    facts.addPlaced(
      `node-${index.toString().padStart(8, "0")}`,
      index === 0 ? WORKSPACE_ID : `node-${parentIndex.toString().padStart(8, "0")}`,
    );
  }
  return facts.snapshot();
}

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function forceGc(): void {
  globalThis.gc?.();
  globalThis.gc?.();
}

function keepAlive(value: unknown): void {
  void value;
}

function statExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
