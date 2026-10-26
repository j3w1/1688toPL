import {
  createSizeClassifier,
  sizeSourceProperties,
} from './size-vocabulary.js'

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
const modes = ['none', 'variants', 'sizes', 'variants-and-sizes']
const modelArticle = (value) =>
  /^[A-Z0-9]+(?:[-_][A-Z0-9]+)*$/.test(value) &&
  /[A-Z]/.test(value) &&
  /\d|[-_]/.test(value)
const articleStem = (value) =>
  /^(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)([A-Z0-9]*[A-Z])[-_]\d{1,3}$/.exec(
    value
  )?.[1] ??
  /^([A-Z0-9]*[A-Z]\d+)\d{2}$/.exec(value)?.[1] ??
  /^(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)([A-Z0-9]*[A-Z])\d{2}$/.exec(value)?.[1]
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Strip only source-proven identifiers and explicitly labelled packaging facts. */
export function extractFamilyProduct(item, classifier) {
  const identity = productArticleIdentity(item)
  const clean = (value) => {
    let result = text(value)
      .replace(/[（(][^()（）]*(?:包装|外箱|箱规)[^()（）]*[)）]/g, '')
      .replace(
        /(?:包装尺寸|外箱尺寸|箱规)\s*[:：]?\s*[\d.\s*x×厘米公分cm]+/gi,
        ''
      )
    if (identity && modelArticle(identity))
      result = result.replace(
        new RegExp(`(?<![A-Z0-9])${escape(identity)}(?![A-Z0-9])`, 'gi'),
        ''
      )
    return result.trim()
  }
  const properties = sizeSourceProperties(item).flatMap((property) => {
    if (
      identifierLabel.test(text(property.label)) ||
      /包装|外箱|箱规/.test(property.label)
    )
      return []
    const value = clean(property.value)
    if (
      !value ||
      /^(?:如图(?:所示)?|看图(?:片)?|见图|as\s*(?:shown|pictured))$/i.test(
        value
      )
    )
      return []
    return [{ ...property, value }]
  })
  const extracted = classifier.extract({
    ...item,
    skuProperties: properties,
    // The original description remains untouched. Avoid re-reading removed
    // packaging/identifier facts through the classifier's legacy fallback.
    description: item.title || '',
  })
  extracted.variantProperties = productFamilyStyleProperties(
    item,
    extracted.variantProperties
  )
    .map((property) => ({
      label:
        /^(?:颜色|色号|款式|尺寸(?:说明)?|规格(?:说明)?|color|variant|style|size)$/i.test(
          property.label
        )
          ? 'style'
          : text(property.label).toLowerCase(),
      value: clean(property.value)
        .toLowerCase()
        .replace(/[()（）]/g, '')
        .trim(),
    }))
    .filter(
      (property) =>
        property.value && !/^(?:如图(?:所示)?|看图|见图)$/.test(property.value)
    )
  return extracted
}

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
function familySourceKey(snapshot, legacy) {
  return JSON.stringify([
    1,
    snapshot.accountId || 'local',
    snapshot.orderId,
    snapshot.items.map((item) => [
      item.entryId,
      productArticleIdentity(item),
      text(item.title || item.description),
      (legacy || item.skuProperties?.length
        ? (item.skuProperties ?? [])
        : sizeSourceProperties(item)
      ).map((property) => [text(property.label), text(property.value)]),
    ]),
  ])
}

export function productFamilySourceKey(snapshot) {
  return familySourceKey(snapshot, false)
}

/** Read older portable evidence; only the complete key may authorize new reuse. */
export function productFamilySourceMatches(snapshot, key) {
  return (
    productFamilySourceKey(snapshot) === key ||
    familySourceKey(snapshot, true) === key
  )
}

/** Snapshot ownership/freshness is checked by the repository. */
export function validateProductFamilies(input) {
  if (
    !input ||
    ![1, 2].includes(input.version) ||
    typeof input.sourceKey !== 'string' ||
    !input.sourceKey ||
    !Array.isArray(input.families) ||
    !input.families.length
  )
    throw new Error('Reviewed product families are invalid')
  const seen = new Set()
  return {
    version: input.version,
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
      if (family.mode !== undefined && !modes.includes(family.mode))
        throw new Error('Reviewed product family coding mode is invalid')
      if (family.identities !== undefined && !Array.isArray(family.identities))
        throw new Error('Reviewed product family identities are invalid')
      const identities = family.identities?.map((identity) => {
        if (
          !identity ||
          typeof identity !== 'object' ||
          !entryIds.includes(identity.entryId) ||
          typeof identity.style !== 'string' ||
          identity.style.length > 1000 ||
          typeof identity.size !== 'string' ||
          identity.size.length > 1000 ||
          (identity.variantSuffix !== undefined &&
            (typeof identity.variantSuffix !== 'string' ||
              !/^[A-Z]*$/.test(identity.variantSuffix))) ||
          (identity.sizeSuffix !== undefined &&
            (typeof identity.sizeSuffix !== 'string' ||
              !/^[A-Z0-9]*$/.test(identity.sizeSuffix)))
        )
          throw new Error('Reviewed product family identities are invalid')
        return {
          entryId: identity.entryId,
          style: identity.style,
          size: identity.size,
          ...(identity.variantSuffix !== undefined
            ? { variantSuffix: identity.variantSuffix }
            : {}),
          ...(identity.sizeSuffix !== undefined
            ? { sizeSuffix: identity.sizeSuffix }
            : {}),
        }
      })
      if (
        identities &&
        new Set(identities.map((identity) => identity.entryId)).size !==
          identities.length
      )
        throw new Error('Reviewed product family identities are duplicated')
      return {
        entryIds,
        kind: family.kind,
        ...(family.mode !== undefined ? { mode: family.mode } : {}),
        ...(identities ? { identities } : {}),
      }
    }),
  }
}

/** Source facts identify families; a common marketing title alone does not. */
export function planProductFamilies(
  snapshot,
  {
    choices = [],
    preparation,
    records = [],
    preparations = [],
    history = [],
    sizeVocabulary,
  } = {}
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
      ? validateProductFamilies({ version: 2, sourceKey, families: reviewed })
      : null
  for (const family of evidence?.families ?? [])
    if (family.entryIds.some((entryId) => !byId.has(entryId)))
      throw new Error(
        'Reviewed product families refer to missing source products'
      )

  const root = (item) => articleStem(item.article),
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
          ? `article:${JSON.stringify([item.article, item.title])}`
          : `source:${item.entryId}`
    if (!groups.has(key))
      groups.set(key, {
        entryIds: [],
        provenance: grouped
          ? 'article-family'
          : item.article && modelArticle(item.article)
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
      families.push({
        ...family,
        entryIds: [...entryIds],
        provenance: 'reviewed',
        ...(family.identities
          ? {
              identities: family.identities.filter((identity) =>
                entryIds.includes(identity.entryId)
              ),
            }
          : {}),
      })
  }

  // Historical conventions are read from actual retained purchases, never a
  // bundled supplier catalogue or a previous purchase's CE reservation.
  const supplier = (value) =>
    value.sellerUnavailable ? '' : text(value.sellerMemberLogin)
  const sources = new Map(
    records.map((record) => {
      const value = record.snapshot ?? record
      return [
        JSON.stringify([value.accountId || 'local', value.orderId]),
        value,
      ]
    })
  )
  const observations = [...records, ...history].map(
    (record) => record.snapshot ?? record
  )
  const references = new Set(),
    byMember = new Map()
  const memberKey = (member) =>
    JSON.stringify([member.article, member.title, member.properties])
  const mergeMember = (reference, member) => {
    const key = memberKey(member),
      previous = reference.members.get(key)
    if (
      previous?.variantSuffix !== undefined &&
      member.variantSuffix !== undefined &&
      (previous.variantSuffix !== member.variantSuffix ||
        previous.sizeSuffix !== member.sizeSuffix)
    )
      reference.conflict = true
    const identity =
        !previous ||
        (member.reviewed && !previous.reviewed) ||
        (previous.style === undefined && member.style !== undefined)
          ? member
          : previous,
      ending = previous?.variantSuffix !== undefined ? previous : member
    reference.members.set(key, {
      ...identity,
      ...(ending.variantSuffix !== undefined
        ? { variantSuffix: ending.variantSuffix, sizeSuffix: ending.sizeSuffix }
        : {}),
    })
  }
  for (const prior of preparations) {
    const orderKey = JSON.stringify([
        prior.accountId || 'local',
        prior.orderId,
      ]),
      original = prior.productFamilies
        ? observations.find(
            (value) =>
              JSON.stringify([value.accountId || 'local', value.orderId]) ===
                orderKey &&
              productFamilySourceKey(value) === prior.productFamilies.sourceKey
          )
        : sources.get(orderKey)
    if (
      !original ||
      original.orderId === snapshot.orderId ||
      (original.accountId || 'local') !== accountId ||
      !supplier(snapshot) ||
      supplier(original) !== supplier(snapshot) ||
      original.sourceType === 'spreadsheet'
    )
      continue
    for (const group of prior.groups) {
      const assigned = new Map(
          group.variants.flatMap((variant) =>
            variant.entryIds.map((entryId) => [entryId, variant])
          )
        ),
        context = (prior.productFamilies?.families ?? []).filter((family) =>
          family.entryIds.some((entryId) => assigned.has(entryId))
        ),
        entryIds = new Set([
          ...assigned.keys(),
          ...context.flatMap((family) =>
            family.kind === 'family' ? family.entryIds : []
          ),
        ]),
        observedMode = group.variants.some((variant) => variant.variantSuffix)
          ? group.variants.some((variant) => variant.sizeSuffix)
            ? 'variants-and-sizes'
            : 'variants'
          : group.variants.some((variant) => variant.sizeSuffix)
            ? 'sizes'
            : 'none',
        declaredModes = new Set(
          context.map((family) => family.mode).filter(Boolean)
        ),
        reference = {
          members: new Map(),
          modes: declaredModes.size ? declaredModes : new Set([observedMode]),
          groups: new Map([[orderKey, new Set([group.id])]]),
          conflict: false,
        }
      for (const entryId of entryIds) {
        const item = original.items.find((item) => item.entryId === entryId)
        if (!item) continue
        const variant = assigned.get(entryId),
          reviewed = context
            .flatMap((family) => family.identities ?? [])
            .find((identity) => identity.entryId === entryId)
        mergeMember(reference, {
          article: productArticleIdentity(item),
          title: text(item.title || item.description),
          properties: JSON.stringify(
            sizeSourceProperties(item).map(({ label, value }) => [
              text(label),
              text(value),
            ])
          ),
          ...(reviewed || variant
            ? {
                style: reviewed?.style ?? variant.variant,
                size: reviewed?.size ?? variant.size,
              }
            : {}),
          ...(variant
            ? {
                variantSuffix: variant.variantSuffix,
                sizeSuffix: variant.sizeSuffix,
              }
            : reviewed?.variantSuffix !== undefined ||
                reviewed?.sizeSuffix !== undefined
              ? {
                  variantSuffix: reviewed.variantSuffix,
                  sizeSuffix: reviewed.sizeSuffix,
                }
              : {}),
          reviewed: Boolean(reviewed),
        })
      }
      // Partial preparations carry only selected assignments. Merge overlapping
      // evidence while retaining explicit separation in every earlier purchase.
      const overlapping = new Set(
        [...reference.members.keys()]
          .map((key) => byMember.get(key))
          .filter(Boolean)
      )
      for (const previous of overlapping) {
        reference.conflict ||= previous.conflict
        for (const mode of previous.modes) reference.modes.add(mode)
        for (const member of previous.members.values())
          mergeMember(reference, member)
        for (const [order, groups] of previous.groups) {
          const combined = reference.groups.get(order) ?? new Set()
          for (const id of groups) combined.add(id)
          reference.groups.set(order, combined)
        }
        references.delete(previous)
      }
      reference.conflict ||=
        reference.modes.size > 1 ||
        [...reference.groups.values()].some((groups) => groups.size > 1)
      references.add(reference)
      for (const key of reference.members.keys()) byMember.set(key, reference)
    }
  }
  const classifier = createSizeClassifier(sizeVocabulary),
    historical = new Map(),
    historicalIssues = []
  for (const item of source) {
    if (reviewedIds.has(item.entryId) || !item.article) continue
    const matches = [...references].filter((reference) =>
      [...reference.members.values()].some(
        (member) =>
          member.article === item.article && member.title === item.title
      )
    )
    if (matches.length > 1 || matches[0]?.conflict) {
      historicalIssues.push(item.entryId)
      continue
    }
    if (!matches.length) continue
    const reference = matches[0]
    const group = historical.get(reference) ?? {
      entryIds: [],
      provenance: 'historical',
      mode: [...reference.modes][0],
      identities: [],
    }
    const row = snapshot.items.find((row) => row.entryId === item.entryId),
      properties = JSON.stringify(
        sizeSourceProperties(row).map(({ label, value }) => [
          text(label),
          text(value),
        ])
      ),
      member = reference.members.get(memberKey({ ...item, properties }))
    group.entryIds.push(item.entryId)
    if (member?.style !== undefined) {
      group.identities.push({
        entryId: item.entryId,
        style: member.style,
        size: member.size,
        ...(member.variantSuffix !== undefined
          ? { variantSuffix: member.variantSuffix }
          : {}),
        ...(member.sizeSuffix !== undefined
          ? { sizeSuffix: member.sizeSuffix }
          : {}),
      })
    }
    historical.set(reference, group)
  }
  const historyIds = new Set(
    [...historical.values()].flatMap((family) => family.entryIds)
  )
  for (const family of families)
    family.entryIds = family.entryIds.filter((id) => !historyIds.has(id))
  families.push(...historical.values())
  for (let i = families.length - 1; i >= 0; i--)
    if (!families[i].entryIds.length) families.splice(i, 1)

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
      ...(matching.length === 1 ? matching[0] : {}),
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
    const differentArticles =
      new Set(cohort.map((item) => item.article)).size > 1
    if (
      cohort.length < 2 ||
      !cohort.some(
        (item) =>
          (!modelArticle(item.article) || (differentArticles && !root(item))) &&
          !historyIds.has(item.entryId) &&
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
  if (historicalIssues.length)
    issues.push({
      code: 'PRODUCT_FAMILY_REVIEW_REQUIRED',
      message:
        'Previous product families disagree. Review the family membership and endings.',
      accountId,
      orderId,
      entryIds: historicalIssues,
    })
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
      identities: family.entryIds.map((entryId) => {
        const existing = family.identities?.find(
          (identity) => identity.entryId === entryId
        )
        if (existing) return existing
        const extracted = extractFamilyProduct(
          snapshot.items.find((item) => item.entryId === entryId),
          classifier
        )
        return {
          entryId,
          style: extracted.variantProperties
            .map((property) => property.value)
            .join(' / '),
          size: extracted.size,
          suggested: true,
        }
      }),
    })),
    issues,
    evidence: historyIds.size
      ? validateProductFamilies({
          version: 2,
          sourceKey,
          families: families.map((family) => ({
            ...family,
            kind: family.entryIds.length > 1 ? 'family' : 'standalone',
          })),
        })
      : evidence,
  }
}
