export function requireRomanizedTitleAlias(
  rows: ReadonlyArray<Readonly<{ alias: string }>>
): string {
  const alias = rows[0];
  if (alias === undefined) {
    throw new Error("Missing perf fixture romanized_title alias.");
  }
  return alias.alias;
}
