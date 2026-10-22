import { registerPlugin } from '@capacitor/core';

import type { NativeStorageOperation } from './engine-worker/protocol.js';

type LodeDatabasePlugin = Readonly<{
  execute(
    options: Readonly<{ operation: NativeStorageOperation }>,
  ): Promise<Readonly<{ value: unknown }>>;
}>;

const database = registerPlugin<LodeDatabasePlugin>('LodeDatabase');

export async function executeStorageOperation(
  operation: NativeStorageOperation,
): Promise<unknown> {
  const result = await database.execute({ operation });
  return result.value;
}
