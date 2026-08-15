import { canonicalDigest, type Admission, type AuthorityRecord } from "../../domain/fact/index.js";
import type { SyncBytes } from "../../sync/syncable.js";
import { AuthorityFaultError } from "./errors.js";
import type { LoroFactReplica } from "./loro-fact-replica.js";

export async function importAuthorityUpdate(
  bytes: SyncBytes,
  context: Readonly<{
    admission: Admission;
    records: readonly unknown[];
    replica: LoroFactReplica;
    append(records: readonly AuthorityRecord[]): Promise<void>;
  }>,
): Promise<void> {
  if (context.admission.kind === "fault") {
    throw new AuthorityFaultError(context.admission.fault ?? "Authority admission fault");
  }
  const validation = context.replica.prepareImport(bytes, context.records);
  if (validation.kind === "fault") {
    const durableRecords =
      validation.records.length > 0
        ? validation.records
        : [
            {
              recordKind: "quarantine" as const,
              reason: validation.reason,
              updateDigest: canonicalDigest([...bytes]),
            },
          ];
    await context.append(durableRecords);
    throw new AuthorityFaultError(validation.reason);
  }
  if (validation.records.length > 0) {
    await context.append(validation.records);
  }
  await validation.accept();
}
