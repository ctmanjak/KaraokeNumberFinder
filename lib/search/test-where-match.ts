export type AliasMatchRecord = {
  id: string;
  normalizedAlias: string;
  chosungAlias: string | null;
};

export type AliasMatchCondition =
  | { normalizedAlias: { equals: string } }
  | { normalizedAlias: { startsWith: string } }
  | { normalizedAlias: { contains: string } }
  | { chosungAlias: { startsWith: string } };

export type AliasMatchWhere<
  TCondition extends AliasMatchCondition = AliasMatchCondition
> =
  | { id: { in: readonly string[] } }
  | { OR: readonly TCondition[] }
  | TCondition;

export function matchesAliasWhere<TCondition extends AliasMatchCondition>(
  aliasRecord: AliasMatchRecord,
  where: AliasMatchWhere<TCondition>
): boolean {
  if (isAliasIdWhere(where)) {
    return where.id.in.includes(aliasRecord.id);
  }

  if (isAliasOrWhere(where)) {
    return where.OR.some((condition) =>
      matchesAliasCondition(aliasRecord, condition)
    );
  }

  return matchesAliasCondition(aliasRecord, where);
}

export function isAliasIdWhere(
  where: AliasMatchWhere
): where is { id: { in: readonly string[] } } {
  return "id" in where;
}

export function isAliasOrWhere(
  where: AliasMatchWhere
): where is { OR: readonly AliasMatchCondition[] } {
  return "OR" in where;
}

function matchesAliasCondition(
  aliasRecord: AliasMatchRecord,
  condition: AliasMatchCondition
): boolean {
  if ("normalizedAlias" in condition) {
    if ("equals" in condition.normalizedAlias) {
      return aliasRecord.normalizedAlias === condition.normalizedAlias.equals;
    }

    if ("startsWith" in condition.normalizedAlias) {
      return aliasRecord.normalizedAlias.startsWith(
        condition.normalizedAlias.startsWith
      );
    }

    return aliasRecord.normalizedAlias.includes(
      condition.normalizedAlias.contains
    );
  }

  return (
    aliasRecord.chosungAlias?.startsWith(condition.chosungAlias.startsWith) ??
    false
  );
}
