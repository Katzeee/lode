export function shuffle<T>(values: readonly T[], seed: number): T[] {
  const result = [...values];
  let state = seed >>> 0;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const target = state % (index + 1);
    const sourceValue = result[index];
    const targetValue = result[target];
    if (sourceValue === undefined || targetValue === undefined) {
      throw new Error("Generated shuffle index is outside its bounded input");
    }
    result[index] = targetValue;
    result[target] = sourceValue;
  }
  return result;
}
