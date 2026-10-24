/** Construct explicit old archive evidence in synthetic fixtures, never production state. */
export function legacyPackingCheckpoint(
  preparation,
  { includeDefaults = false } = {}
) {
  const checkpoint = {
    month: preparation.month,
    sellerId: preparation.sellerId,
    updatedAt: preparation.updatedAt,
    groups: structuredClone(preparation.groups),
    ...(preparation.restoreScopes !== undefined
      ? { restoreScopes: structuredClone(preparation.restoreScopes) }
      : {}),
  }
  if (includeDefaults && preparation.defaultPacking)
    checkpoint.defaults = legacyPackingCheckpoint(preparation.defaultPacking)
  return checkpoint
}
