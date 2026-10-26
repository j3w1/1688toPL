const text = (value) =>
  String(value ?? '')
    .normalize('NFKC')
    .trim()
const article = (value) =>
  text(value)
    .toUpperCase()
    .replace(/\s*([-_])\s*/g, '$1')
const identifierLabel =
  /^(?:货号|款号|商品编号|产品编号|编号|型号|model|item\s*(?:no\.?|number))$/i

export function productArticleIdentity(item) {
  if (text(item.productNumber)) return article(item.productNumber)
  const values = [
    ...new Set(
      (item.skuProperties ?? [])
        .filter((property) => identifierLabel.test(text(property.label)))
        .map((property) => article(property.value))
        .filter(Boolean)
    ),
  ]
  return values.length === 1 ? values[0] : ''
}

/** A repeated source article/model identifier is not another style attribute. */
export function productFamilyStyleProperties(item, properties) {
  const identity = productArticleIdentity(item)
  return properties.filter(
    (property) =>
      !identifierLabel.test(text(property.label)) ||
      article(property.value) !== identity
  )
}

/** Exact, presentation-independent evidence for reviewed source family membership. */
export function productFamilySourceKey(snapshot) {
  return JSON.stringify([
    1,
    snapshot.accountId || 'local',
    snapshot.orderId,
    snapshot.items.map((item) => [
      item.entryId,
      productArticleIdentity(item),
      text(item.title || item.description),
      (item.skuProperties ?? []).map((property) => [
        text(property.label),
        text(property.value),
      ]),
    ]),
  ])
}

/** Snapshot ownership/freshness is checked by the repository. */
export function validateProductFamilies(input) {
  if (
    !input ||
    input.version !== 1 ||
    typeof input.sourceKey !== 'string' ||
    !input.sourceKey ||
    !Array.isArray(input.families) ||
    !input.families.length
  )
    throw new Error('Reviewed product families are invalid')
  const seen = new Set()
  return {
    version: 1,
    sourceKey: input.sourceKey,
    families: input.families.map((family) => {
      if (
        !['family', 'standalone'].includes(family?.kind) ||
        !Array.isArray(family.entryIds) ||
        !family.entryIds.length ||
        (family.kind === 'family' && family.entryIds.length < 2)
      )
        throw new Error('Reviewed product family membership is invalid')
      const entryIds = family.entryIds.map((entryId) => {
        if (
          typeof entryId !== 'string' ||
          !/^[1-9]\d*$/.test(entryId) ||
          seen.has(entryId)
        )
          throw new Error(
            'Reviewed product family source identities are invalid'
          )
        seen.add(entryId)
        return entryId
      })
      return { entryIds, kind: family.kind }
    }),
  }
}

/** Source facts identify families; a common marketing title alone does not. */
export function planProductFamilies(
  snapshot,
  { choices = [], preparation } = {}
) {
  const sourceKey = productFamilySourceKey(snapshot),
    source = snapshot.items.map((item, index) => ({
      entryId: item.entryId,
      index,
      title: text(item.title || item.description),
      article: productArticleIdentity(item),
    })),
    byId = new Map(source.map((item) => [item.entryId, item])),
    orderId = snapshot.orderId,
    accountId = snapshot.accountId || 'local',
    selectedChoices = choices.filter(
      (choice) =>
        (!choice.orderId || choice.orderId === orderId) &&
        (!choice.accountId || choice.accountId === accountId)
    ),
    saved =
      preparation?.productFamilies?.sourceKey === sourceKey
        ? preparation.productFamilies.families
        : [],
    reviewed = [
      ...saved.filter(
        (family) =>
          !selectedChoices.some((choice) =>
            choice.entryIds?.some((entryId) =>
              family.entryIds.includes(entryId)
            )
          )
      ),
      ...selectedChoices,
    ],
    evidence = reviewed.length
      ? validateProductFamilies({ version: 1, sourceKey, families: reviewed })
      : null
  for (const family of evidence?.families ?? [])
    if (family.entryIds.some((entryId) => !byId.has(entryId)))
      throw new Error(
        'Reviewed product families refer to missing source products'
      )

  // Only a bounded alphanumeric model stem ending in a letter can establish
  // sibling numbered articles. Bare numeric and arbitrary hyphenated IDs do not.
  const root = (item) =>
      /^(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)([A-Z0-9]*[A-Z])[-_]\d{1,3}$/.exec(
        item.article
      )?.[1],
    siblings = new Map()
  for (const item of source) {
    const stem = root(item)
    if (!stem) continue
    const key = JSON.stringify([stem, item.title]),
      values = siblings.get(key) ?? new Set()
    values.add(item.article)
    siblings.set(key, values)
  }
  const groups = new Map()
  for (const item of source) {
    const stem = root(item),
      siblingKey = JSON.stringify([stem, item.title]),
      grouped = stem && siblings.get(siblingKey)?.size > 1,
      key = grouped
        ? `model:${siblingKey}`
        : item.article
          ? `article:${item.article}`
          : `source:${item.entryId}`
    if (!groups.has(key))
      groups.set(key, {
        entryIds: [],
        provenance: grouped
          ? 'article-family'
          : item.article
            ? 'article'
            : 'source',
        ...(grouped ? { articleFamily: stem } : {}),
      })
    groups.get(key).entryIds.push(item.entryId)
  }
  const reviewedIds = new Set(
      (evidence?.families ?? []).flatMap((family) => family.entryIds)
    ),
    families = [...groups.values()]
      .map((family) => ({
        ...family,
        entryIds: family.entryIds.filter(
          (entryId) => !reviewedIds.has(entryId)
        ),
      }))
      .filter((family) => family.entryIds.length)
  for (const family of evidence?.families ?? []) {
    for (const entryIds of family.kind === 'standalone'
      ? family.entryIds.map((entryId) => [entryId])
      : [family.entryIds])
      families.push({ entryIds: [...entryIds], provenance: 'reviewed' })
  }

  // Already authored membership is authoritative. This never recodes a saved
  // family; the code planner separately rejects ambiguous multi-group appends.
  const preparedIds = new Set()
  for (const group of preparation?.groups ?? []) {
    const ids = new Set(
      group.variants
        .flatMap((variant) => variant.entryIds)
        .filter((entryId) => byId.has(entryId))
    )
    for (const entryId of ids) preparedIds.add(entryId)
    const matching = families.filter((family) =>
      family.entryIds.some((entryId) => ids.has(entryId))
    )
    if (!matching.length) continue
    const merged = {
      entryIds: [...new Set(matching.flatMap((family) => family.entryIds))],
      provenance: 'existing',
    }
    for (const family of matching) families.splice(families.indexOf(family), 1)
    families.push(merged)
  }
  const titles = new Map()
  for (const item of source) {
    const cohort = titles.get(item.title) ?? []
    cohort.push(item)
    titles.set(item.title, cohort)
  }
  const issues = []
  for (const cohort of titles.values()) {
    if (
      cohort.length < 2 ||
      !cohort.some(
        (item) =>
          !item.article &&
          !reviewedIds.has(item.entryId) &&
          !preparedIds.has(item.entryId)
      )
    )
      continue
    issues.push({
      code: 'PRODUCT_FAMILY_REVIEW_REQUIRED',
      message:
        'These products share a title, but their product-family identity needs your review.',
      accountId,
      orderId,
      entryIds: cohort.map((item) => item.entryId),
    })
  }
  families.sort(
    (left, right) =>
      Math.min(...left.entryIds.map((entryId) => byId.get(entryId).index)) -
      Math.min(...right.entryIds.map((entryId) => byId.get(entryId).index))
  )
  return {
    accountId,
    orderId,
    sourceKey,
    families: families.map((family) => ({
      ...family,
      id: `family:${[...family.entryIds].sort().join(':')}`,
      kind: family.entryIds.length > 1 ? 'family' : 'standalone',
    })),
    issues,
    evidence,
  }
}
