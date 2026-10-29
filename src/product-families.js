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
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Strip only source-proven identifiers and explicitly labelled packaging facts. */
export function extractFamilyProduct(item, classifier) {
  const identity = productArticleIdentity(item)
  const clean = (value) => {
    let result = text(value)
      .replace(
        /([0-9])\s*[（(]\s*(mm|cm|m|毫米|厘米|公分|米)\s*[)）]/gi,
        '$1$2'
      )
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
        .replace(/高品质|品质|优质|质量保证/g, '')
        .toLowerCase()
        .replace(/[()（）【】\[\]]/g, ' ')
        .replace(/\s+/g, ' ')
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

/** A title is purchase-local family evidence, not a supplier-wide code identity. */
export function productFamilyTitle(item) {
  const title = text(item.title).replace(/\s+/g, ' ')
  if (title) return title
  const first =
    text(item.description)
      .split(/[\r\n]+/)
      .find((line) => line.trim())
      ?.trim() || ''
  return /^(?:颜色|色号|款式|尺寸|规格|货号|型号|材质|color|size|model|material)\s*[:：]/i.test(
    first
  )
    ? ''
    : first.replace(/\s+/g, ' ')
}

const letters = (index) => {
  let result = ''
  do {
    result = String.fromCharCode(65 + (index % 26)) + result
    index = Math.floor(index / 26) - 1
  } while (index >= 0)
  return result
}
const sizeKey = (extracted) => {
  const info = extracted.sizeInfo
  return JSON.stringify(
    info.kind === 'named'
      ? ['named', info.suffix]
      : info.kind === 'measurement'
        ? ['measurement', info.dimension, info.axes || [], info.values]
        : ['source', text(extracted.size).toLowerCase().replace(/\s+/g, ' ')]
  )
}

/** Determine complete options before choosing a coding mode or reserving codes. */
function automaticOptions(items, classifier, overrides = [], mode) {
  const rows = items.map((item) => {
    const original = extractFamilyProduct(item, classifier),
      override = overrides.find((identity) => identity.entryId === item.entryId)
    const extracted = override
      ? {
          ...original,
          size: override.size,
          sizeInfo: classifier.extract({
            skuProperties: [{ label: '尺寸', value: override.size }],
          }).sizeInfo,
        }
      : original
    return {
      item,
      extracted,
      style: override
        ? override.style
        : extracted.variantProperties
            .map((p) => p.value)
            .sort()
            .join(' / '),
      sizeKey: sizeKey(extracted),
    }
  })
  const articles = new Map()
  for (const row of rows) {
    const key = JSON.stringify([row.style, row.sizeKey]),
      values = articles.get(key) || new Set()
    if (productArticleIdentity(row.item))
      values.add(productArticleIdentity(row.item))
    articles.set(key, values)
  }
  for (const row of rows)
    if (articles.get(JSON.stringify([row.style, row.sizeKey])).size > 1)
      row.style = [row.style, productArticleIdentity(row.item)]
        .filter(Boolean)
        .join(' / ')
  const styles = [...new Set(rows.map((row) => row.style))]
  const suggestions = classifier.suggest(
    rows.map((row) => row.extracted.size),
    rows.map((row) => row.style)
  )
  const sizesByStyle = new Map(
    styles.map((style) => [
      style,
      new Set(
        rows.filter((row) => row.style === style).map((row) => row.sizeKey)
      ),
    ])
  )
  const reliableSizes = new Set(
    rows
      .filter(
        (row, index) =>
          !suggestions[index].needsSizeMapping &&
          ['named', 'measurement'].includes(row.extracted.sizeInfo.kind)
      )
      .map((row) => row.sizeKey)
  )
  const sizeFallback = rows.some(
    (row, index) =>
      suggestions[index].needsSizeMapping &&
      sizesByStyle.get(row.style).size > 1
  )
  const complete = [
    ...new Set(rows.map((row) => JSON.stringify([row.style, row.sizeKey]))),
  ]
  const identities = rows.map((row, index) => ({
    entryId: row.item.entryId,
    style: row.style,
    size: row.extracted.size,
    variantSuffix: ['none', 'sizes'].includes(mode)
      ? ''
      : sizeFallback || mode === 'variants'
        ? complete.length > 1
          ? letters(complete.indexOf(JSON.stringify([row.style, row.sizeKey])))
          : ''
        : styles.length > 1
          ? letters(styles.indexOf(row.style))
          : '',
    sizeSuffix:
      ['none', 'variants'].includes(mode) ||
      sizeFallback ||
      reliableSizes.size < 2 ||
      suggestions[index].needsSizeMapping
        ? ''
        : suggestions[index].sizeSuffix,
  }))
  const hasVariants = identities.some((identity) => identity.variantSuffix)
  const hasSizes = identities.some((identity) => identity.sizeSuffix)
  return {
    identities,
    sizeFallback,
    mode: hasVariants
      ? hasSizes
        ? 'variants-and-sizes'
        : 'variants'
      : hasSizes
        ? 'sizes'
        : 'none',
  }
}

/** Reuse saved endings for identical options, without changing existing assignments. */
function retainAssignedOptions(family, preparation, classifier) {
  const members = new Map(
    (preparation?.groups || []).flatMap((group) =>
      group.variants.flatMap((variant) =>
        variant.entryIds.map((id) => [id, variant])
      )
    )
  )
  const completeOptions = family.sizeFallback || family.mode === 'variants'
  const optionKey = (identity) =>
    JSON.stringify([
      identity.style,
      sizeKey({
        size: identity.size,
        sizeInfo: classifier.extract({
          skuProperties: [{ label: '尺寸', value: identity.size }],
        }).sizeInfo,
      }),
    ])
  const endings = new Map(),
    styles = new Map(),
    used = new Set(),
    conflictingOptions = new Set(),
    conflictingStyles = new Set(),
    conflicts = []
  for (const identity of family.identities) {
    const assigned = members.get(identity.entryId)
    if (!assigned) continue
    const option = optionKey(identity),
      previous = endings.get(option)
    if (
      previous &&
      (previous.variantSuffix !== assigned.variantSuffix ||
        previous.sizeSuffix !== assigned.sizeSuffix)
    )
      conflictingOptions.add(option)
    endings.set(option, {
      variantSuffix: assigned.variantSuffix,
      sizeSuffix: assigned.sizeSuffix,
    })
    if (!completeOptions) {
      if (
        styles.has(identity.style) &&
        styles.get(identity.style) !== assigned.variantSuffix
      )
        conflictingStyles.add(identity.style)
      styles.set(identity.style, assigned.variantSuffix)
    }
    used.add(assigned.variantSuffix)
  }
  const suggestedStyles = new Map()
  let next = 0
  for (const identity of family.identities) {
    const assigned = members.get(identity.entryId),
      retained = endings.get(optionKey(identity))
    if (
      !assigned &&
      (conflictingOptions.has(optionKey(identity)) ||
        (!retained &&
          !completeOptions &&
          conflictingStyles.has(identity.style)))
    ) {
      conflicts.push(identity.entryId)
      continue
    }
    if (assigned || retained) {
      identity.variantSuffix = (assigned || retained).variantSuffix
      identity.sizeSuffix = (assigned || retained).sizeSuffix
      continue
    }
    const key = completeOptions ? optionKey(identity) : identity.style
    if (styles.has(key)) identity.variantSuffix = styles.get(key)
    else if (identity.variantSuffix) {
      if (!suggestedStyles.has(key)) {
        while (used.has(letters(next))) next++
        const suffix = letters(next++)
        suggestedStyles.set(key, suffix)
        used.add(suffix)
      }
      identity.variantSuffix = suggestedStyles.get(key)
    }
  }
  return conflicts
}

/** New 1688 families follow source titles; saved membership remains authoritative. */
export function planProductFamilies(
  snapshot,
  { choices = [], preparation, sizeVocabulary } = {}
) {
  const accountId = snapshot.accountId || 'local',
    orderId = snapshot.orderId,
    sourceKey = productFamilySourceKey(snapshot),
    classifier = createSizeClassifier(sizeVocabulary),
    byId = new Map(
      snapshot.items.map((item, index) => [item.entryId, { item, index }])
    ),
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
            choice.entryIds?.some((id) => family.entryIds.includes(id))
          )
      ),
      ...selectedChoices,
    ],
    explicit = reviewed.length
      ? validateProductFamilies({ version: 2, sourceKey, families: reviewed })
      : null
  for (const family of explicit?.families || [])
    if (family.entryIds.some((id) => !byId.has(id)))
      throw new Error(
        'Reviewed product families refer to missing source products'
      )
  const reviewedIds = new Set(
    (explicit?.families || []).flatMap((family) => family.entryIds)
  )
  const groups = new Map(),
    issues = []
  for (const item of snapshot.items) {
    if (reviewedIds.has(item.entryId)) continue
    const title = productFamilyTitle(item)
    if (!title)
      issues.push({
        code: 'PRODUCT_TITLE_REQUIRED',
        message:
          'The source product title is missing. Refresh the order before preparing products.',
        accountId,
        orderId,
        entryIds: [item.entryId],
      })
    const key = title || `missing:${item.entryId}`
    if (!groups.has(key))
      groups.set(key, { title, entryIds: [], provenance: 'title' })
    groups.get(key).entryIds.push(item.entryId)
  }
  const families = [...groups.values()]
  for (const family of explicit?.families || [])
    for (const entryIds of family.kind === 'standalone'
      ? family.entryIds.map((id) => [id])
      : [family.entryIds])
      families.push({
        ...family,
        entryIds,
        title: productFamilyTitle(byId.get(entryIds[0]).item),
        provenance: 'reviewed',
        identities: family.identities?.filter((identity) =>
          entryIds.includes(identity.entryId)
        ),
      })
  // Existing groups may span titles after authored grouping. Keep their identity,
  // and let the append transaction detect multiple incompatible destinations.
  for (const group of preparation?.groups || []) {
    const ids = new Set(
      group.variants
        .flatMap((variant) => variant.entryIds)
        .filter((id) => byId.has(id))
    )
    const matching = families.filter((family) =>
      family.entryIds.some((id) => ids.has(id))
    )
    if (!matching.length) continue
    const merged = {
      ...(matching.length === 1 ? matching[0] : {}),
      title: matching[0].title,
      entryIds: [...new Set(matching.flatMap((family) => family.entryIds))],
      provenance: 'existing',
    }
    for (const family of matching) families.splice(families.indexOf(family), 1)
    families.push(merged)
  }
  families.sort(
    (a, b) =>
      Math.min(...a.entryIds.map((id) => byId.get(id).index)) -
      Math.min(...b.entryIds.map((id) => byId.get(id).index))
  )
  const proposals = families.map((family) => {
    const items = family.entryIds.map((id) => byId.get(id).item),
      automatic = automaticOptions(
        items,
        classifier,
        family.identities,
        family.mode
      )
    const result = {
      ...automatic,
      ...family,
      id: `family:${[...family.entryIds].sort().join(':')}`,
      kind: family.entryIds.length > 1 ? 'family' : 'standalone',
      identities: automatic.identities.map((identity) => ({
        ...identity,
        ...family.identities?.find(
          (saved) => saved.entryId === identity.entryId
        ),
      })),
    }
    const conflicts = retainAssignedOptions(result, preparation, classifier)
    if (conflicts.length)
      issues.push({
        code: 'PURCHASE_GROUP_REVIEW_REQUIRED',
        message:
          'Review this product group before assigning more source products. Existing authored groups or variants do not identify one unambiguous destination.',
        accountId,
        orderId,
        entryIds: conflicts,
      })
    return result
  })
  const evidence = proposals.length
    ? validateProductFamilies({ version: 2, sourceKey, families: proposals })
    : null
  return {
    accountId,
    orderId,
    sourceKey,
    families: proposals,
    issues,
    evidence,
  }
}
