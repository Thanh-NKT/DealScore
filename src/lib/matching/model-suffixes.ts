/** Words that change the model when they follow it ("S24 Ultra" ≠ "S24"). Shared by draftKey() and the matcher. */
export const MODEL_SUFFIXES: ReadonlySet<string> = new Set([
  "pro", "max", "ultra", "plus", "mini", "lite", "air", "se", "fe", "neo", "prime",
]);
