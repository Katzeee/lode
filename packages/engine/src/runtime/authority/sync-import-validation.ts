import {
  canonicalJson,
  parseAuthorityRecords,
  type AuthorityRecord,
} from "../../domain/fact/index.js";
import type { LoroDoc } from "loro-crdt";
import { syncProjectionFacts } from "./fact-sync-projection.js";
import type { AuthorityAdmissionPolicy } from "./fact-store.js";

export type SyncImportValidation =
  | Readonly<{ kind: "ready"; records: readonly AuthorityRecord[] }>
  | Readonly<{ kind: "fault"; reason: string; records: readonly AuthorityRecord[] }>;

export function validateStagedSyncImport(
  workspaceId: string,
  authorityRecords: readonly unknown[],
  stagedSync: LoroDoc,
  admit: AuthorityAdmissionPolicy,
): SyncImportValidation {
  try {
    const parsedAuthority = parseAuthorityRecords(authorityRecords);
    const authorityFacts = parsedAuthority
      .filter((record) => record.recordKind === "fact")
      .map((record) => record.fact);
    const imported = syncProjectionFacts(stagedSync);
    const importedCanonicals = new Set(imported.map((fact) => canonicalJson(fact)));
    if (authorityFacts.some((fact) => !importedCanonicals.has(canonicalJson(fact)))) {
      return fault("Imported Fact update removes immutable authority content", []);
    }
    const authorityCanonicals = new Set(authorityFacts.map((fact) => canonicalJson(fact)));
    const novel = imported
      .filter((fact) => !authorityCanonicals.has(canonicalJson(fact)))
      .map((fact): AuthorityRecord => ({ recordKind: "fact", fact }));
    const candidate = admit(workspaceId, [...authorityRecords, ...novel]);
    if (candidate.kind === "fault") {
      return fault(candidate.fault ?? "Imported Fact update conflicts", novel);
    }
    const existingIds = new Set(authorityFacts.map((fact) => fact.id));
    return {
      kind: "ready",
      records: novel.filter(
        (record) => record.recordKind === "fact" && !existingIds.has(record.fact.id),
      ),
    };
  } catch (error) {
    return fault(error instanceof Error ? error.message : String(error), []);
  }
}

function fault(reason: string, records: readonly AuthorityRecord[]): SyncImportValidation {
  return { kind: "fault", reason, records };
}
