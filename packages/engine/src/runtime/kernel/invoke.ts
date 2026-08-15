export async function invoke(operation: () => void | Promise<void> | undefined, errors: Error[]): Promise<void> {
  try {
    await operation();
  } catch (error) {
    errors.push(toError(error));
  }
}

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
