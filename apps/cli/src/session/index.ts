import type { DesktopClient } from "@lode/desktop-client";
import type {
  EngineApplicationContract,
  ProjectionPage,
  ProjectionPageSection,
  ProjectionPerspective,
  ProjectionSections,
} from "@lode/sdk";
import { engineQueryFailure } from "../outcome/index.js";

/**
 * Desktop session adapter: owns the DesktopClient lifecycle and exposes the
 * narrow CLI-owned host ports families depend on. Command families never see
 * a transport, and this adapter never learns CLI vocabulary.
 */

export type WorkspaceHostPort = Readonly<{
  list(): Promise<readonly Readonly<{ workspaceId: string; label: string }>[]>;
  create(workspaceId: string, name: string): Promise<void>;
}>;

export type ReplicaHostPort = Readonly<{
  run(workspaceId: string, remoteEndpoint: string): Promise<Readonly<{ pulled: number; pushed: number }>>;
}>;

export type DesktopSession = Readonly<{
  application: EngineApplicationContract;
  workspaces: WorkspaceHostPort;
  replicas: ReplicaHostPort;
  /** Reads one whole projection section by following its bounded pages. */
  readProjection<S extends ProjectionPageSection>(
    workspaceId: string,
    perspective: ProjectionPerspective,
    section: S,
  ): Promise<ProjectionSections[S]>;
  close(): void;
}>;

export function openSession(client: DesktopClient): DesktopSession {
  return {
    application: client,
    workspaces: {
      list: () => client.listWorkspaces(),
      create: (workspaceId, name) => client.createWorkspace(workspaceId, name),
    },
    replicas: {
      run: (workspaceId, remoteEndpoint) => client.syncWorkspace(workspaceId, remoteEndpoint),
    },
    readProjection: (workspaceId, perspective, section) =>
      readProjectionSection(client, workspaceId, perspective, section),
    close: () => client.close(),
  };
}

/**
 * ponytail: target resolution and read-before-write composition need whole
 * sections; page size 100 keeps each call bounded. A server-side filtered
 * read is the upgrade path if workspaces grow large.
 */
async function readProjectionSection<S extends ProjectionPageSection>(
  application: EngineApplicationContract,
  workspaceId: string,
  perspective: ProjectionPerspective,
  section: S,
): Promise<ProjectionSections[S]> {
  let merged: unknown = undefined;
  let after: string | undefined;
  do {
    const result = await application.query({
      kind: "projection",
      workspaceId,
      perspective,
      section,
      after,
      limit: 100,
    });
    if (result.status !== "ok") {
      throw engineQueryFailure(result.error);
    }
    const page = result.value as unknown as ProjectionPage<S>;
    const record = page as unknown as Record<string, unknown>;
    const payload = record[section];
    if (Array.isArray(payload)) {
      const accumulated = Array.isArray(merged) ? (merged as readonly unknown[]) : [];
      merged = accumulated.concat(payload as readonly unknown[]);
    } else {
      const accumulated = (merged ?? {}) as Record<string, unknown>;
      const entries = (payload ?? {}) as Record<string, unknown>;
      merged = { ...accumulated, ...entries };
    }
    after = page.next ?? undefined;
  } while (after !== undefined);
  return merged as ProjectionSections[S];
}
