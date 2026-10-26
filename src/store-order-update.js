import {
  activePackingState,
  allocatePreparation,
  barcodeValue,
  createPreparation,
  mergeVariantMaterials,
  refreshPreparationMaterials,
  validatePreparation,
  validatePreparationSuffixEdits,
} from './packing-model.js'
import {
  historicalCodeReservations,
  physicalMarkReservations,
  purchaseMonthForCodes,
  supplierCodeIdentityEquivalences,
} from './purchase-codes.js'
import { reconciliationRevisions } from './container-model.js'
import { orderKey, stableValue } from './inventory-model.js'
import { validateCartonBatch, cartonDecimal } from './carton-batches.js'
import { repeatProductStoreIdentity } from './repeat-products.js'
import { centsToMoney, lineGrossCents, normalizePrice } from './money.js'
import { createMaterialSuggester } from './material-vocabulary.js'
import {
  createNameSuggester,
  refreshPreparationNames,
} from './product-vocabulary.js'

const clone = (value) => structuredClone(value)
const numericFields = [
  'boxes',
  'perbox',
  'quantity',
  'price',
  'amount',
  'kg',
  'cbm',
  'sourceCbm',
  'len',
  'wid',
  'ht',
]
const comparisonFields = [
  'group',
  'description',
  'title',
  'skuProperties',
  'productNumber',
  'photos',
  'variants',
  'allocations',
  ...numericFields,
]
const canonical = (value) =>
  value == null || value === '' ? '' : cartonDecimal(value)
const declarationKey = (items) =>
  stableValue(
    [
      ...new Set(
        items.map((item) =>
          stableValue([item.sourceVariant || '', item.sourceSize || ''])
        )
      ),
    ].sort()
  )
const memberKey = (variant) => stableValue([...variant.entryIds].sort())
const groupIds = (group) =>
  group.variants.flatMap((variant) => variant.entryIds)
const sameSet = (a, b) =>
  stableValue([...a].sort()) === stableValue([...b].sort())

function sourceRows(snapshot, preparation) {
  return snapshot.spreadsheet.rows.map((source) => {
    const items = snapshot.items.filter((item) => item.sourceRow === source.row)
    return {
      ...clone(source),
      description: items[0]?.description || items[0]?.title || '',
      title: items[0]?.title || '',
      skuProperties: [
        ...new Map(
          items.flatMap((item) =>
            (item.skuProperties || []).map((property) => [
              stableValue(property),
              clone(property),
            ])
          )
        ).values(),
      ],
      productNumber: items[0]?.productNumber || '',
      photos: [...new Set(items.flatMap((item) => item.photos || []))],
      variants: items.map((item) => ({
        variant: item.sourceVariant || '',
        size: item.sourceSize || '',
      })),
      allocations: items.map((item) => ({
        variant: item.sourceVariant || '',
        size: item.sourceSize || '',
        quantity: item.quantity,
        amount: centsToMoney(lineGrossCents(item.price, item.quantity)),
      })),
      entryIds: items.map((item) => item.entryId),
      codes: [
        ...new Set(
          (preparation?.groups || []).flatMap((group) =>
            group.variants
              .filter((variant) =>
                items.some((item) => variant.entryIds.includes(item.entryId))
              )
              .flatMap((variant) => {
                try {
                  return [barcodeValue(group, variant)]
                } catch {
                  return []
                }
              })
          )
        ),
      ],
      items,
    }
  })
}

function rowDto(row) {
  if (!row) return null
  const { items, ...dto } = row
  return clone(dto)
}

function matchingScore(incoming, previous) {
  const group = incoming.group === previous.group,
    declaration =
      declarationKey(incoming.items) === declarationKey(previous.items),
    article =
      incoming.productNumber &&
      incoming.productNumber === previous.productNumber,
    description = incoming.description === previous.description,
    photos = incoming.photos.length && sameSet(incoming.photos, previous.photos)
  if (!(article || description || photos)) return 0
  // A source group is the primary family key; supported content permits a
  // reviewed group move but a generic description/photo alone does not.
  if (!group && !article && !(description && photos)) return 0
  return (
    (group ? 8 : 0) +
    (declaration ? 4 : 0) +
    (article ? 12 : 0) +
    (description ? 6 : 0) +
    (photos ? 3 : 0)
  )
}

function totals(snapshot) {
  return {
    products: snapshot.spreadsheet.rows.length,
    groups: new Set(snapshot.spreadsheet.rows.map((row) => row.group)).size,
    pieces: snapshot.items
      .reduce((n, item) => n + BigInt(item.quantity), 0n)
      .toString(),
    cartons: snapshot.spreadsheet.rows.reduce(
      (n, row) => n + Number(row.boxes),
      0
    ),
    total: snapshot.spreadsheet.total,
  }
}

function fieldChanges(before, after) {
  return comparisonFields.flatMap((field) => {
    let a = before?.[field] ?? null,
      b = after?.[field] ?? null
    if (
      field === 'allocations' &&
      (a?.length || 0) <= 1 &&
      (b?.length || 0) <= 1
    )
      return []
    if (numericFields.includes(field)) {
      if (canonical(a) === canonical(b)) return []
    } else if (stableValue(a) === stableValue(b)) return []
    return [{ field, before: clone(a), after: clone(b) }]
  })
}

function comparePrices(left, right) {
  const [a, af = ''] = normalizePrice(left).split('.'),
    [b, bf = ''] = normalizePrice(right).split('.'),
    scale = Math.max(af.length, bf.length),
    x = BigInt(a + af.padEnd(scale, '0')),
    y = BigInt(b + bf.padEnd(scale, '0'))
  return x < y ? -1 : x > y ? 1 : 0
}

function prunePreparation(preparation, ids) {
  if (!preparation) return null
  const result = clone(preparation)
  result.groups = result.groups
    .map((group) => ({
      ...group,
      variants: group.variants
        .map((variant) => ({
          ...variant,
          entryIds: variant.entryIds.filter((id) => ids.has(id)),
          ...(variant.materialOverrides
            ? {
                materialOverrides: Object.fromEntries(
                  Object.entries(variant.materialOverrides).filter(([id]) =>
                    ids.has(id)
                  )
                ),
              }
            : {}),
        }))
        .filter((variant) => variant.entryIds.length),
    }))
    .filter((group) => group.variants.length)
  // Portable 1688 family evidence describes an earlier source snapshot and is
  // neither needed nor authoritative for spreadsheet group declarations.
  delete result.productFamilies
  delete result.restoreScopes
  return result
}

function comparablePreparationGroups(preparation) {
  if (!preparation) return []
  let groups
  try {
    groups = validatePreparation(preparation).groups
  } catch {
    // Invalid unfinished input remains visible and distinct; comparison must
    // never normalize it into an accepted assignment.
    return preparation.groups
  }
  for (const group of groups)
    for (const variant of group.variants) {
      if (!variant.material && variant.materialSource !== 'manual') {
        delete variant.material
        delete variant.materialSource
        if (variant.materialOverrides) {
          const overrides = Object.entries(variant.materialOverrides).filter(
            ([, value]) => value.value || value.source === 'manual'
          )
          if (overrides.length)
            variant.materialOverrides = Object.fromEntries(overrides)
          else delete variant.materialOverrides
        }
      }
    }
  return groups
}

function rebaseDraftPreparation({
  preparation,
  baseline,
  draftCandidate,
  next,
}) {
  if (!preparation || !draftCandidate) return null
  const previous = draftCandidate.snapshot,
    snapshot = next.snapshot
  if (
    orderKey(previous) !== orderKey(snapshot) ||
    previous.store?.key !== snapshot.store.key
  )
    throw new Error(
      'Keep the reviewed workbook groups and product identities together.'
    )
  const idMap = new Map()
  for (const item of previous.items) {
    const matches = snapshot.items.filter(
      (value) =>
        value.sourceRow === item.sourceRow &&
        value.sourceGroup === item.sourceGroup &&
        (value.sourceVariant || '') === (item.sourceVariant || '') &&
        (value.sourceSize || '') === (item.sourceSize || '')
    )
    if (matches.length !== 1)
      throw new Error(
        'Keep the reviewed workbook groups and product identities together.'
      )
    idMap.set(item.entryId, matches[0].entryId)
  }
  if (
    idMap.size !== snapshot.items.length ||
    new Set(idMap.values()).size !== idMap.size
  )
    throw new Error(
      'Keep the reviewed workbook groups and product identities together.'
    )
  if (![...idMap].some(([before, after]) => before !== after)) return null
  const allIds = preparation.groups.flatMap(groupIds)
  if (
    allIds.length !== idMap.size ||
    !sameSet(allIds, idMap.keys()) ||
    orderKey(preparation) !== orderKey(snapshot) ||
    !baseline ||
    baseline.groups.length !== preparation.groups.length
  )
    throw new Error(
      'Keep the reviewed workbook groups and product identities together.'
    )
  // The old suggestion distinguishes an intentional edit from an automatically
  // allocated temporary code belonging to an unresolved mapping. Only edits are
  // carried onto the newly resolved saved identity.
  for (const group of preparation.groups) {
    const original = baseline.groups.find((value) => value.id === group.id)
    if (
      !original ||
      !sameSet(groupIds(original), groupIds(group)) ||
      original.variants.length !== group.variants.length ||
      group.variants.some(
        (variant) =>
          !original.variants.some(
            (value) =>
              value.id === variant.id && memberKey(value) === memberKey(variant)
          )
      )
    )
      throw new Error(
        'Keep the reviewed workbook groups and product identities together.'
      )
  }
  const mappedPreparation = clone(preparation)
  for (const group of mappedPreparation.groups)
    for (const variant of group.variants)
      variant.entryIds = variant.entryIds.map((id) => idMap.get(id))
  const applyFields = (destination, edited, suggested, fields) => {
    for (const field of fields) {
      if (stableValue(edited[field]) === stableValue(suggested[field])) continue
      if (edited[field] === undefined) delete destination[field]
      else if (field === 'materialOverrides')
        destination[field] = Object.fromEntries(
          Object.entries(edited[field]).map(([id, value]) => [
            idMap.get(id),
            clone(value),
          ])
        )
      else destination[field] = clone(edited[field])
    }
  }
  return {
    mappedPreparation,
    apply(suggestion) {
      const result = clone(suggestion)
      for (const group of preparation.groups) {
        const mapped = mappedPreparation.groups.find(
            (value) => value.id === group.id
          ),
          destination = result.groups.find((value) =>
            sameSet(groupIds(value), groupIds(mapped))
          ),
          original = baseline.groups.find((value) => value.id === group.id)
        if (!destination)
          throw new Error(
            'Keep the reviewed workbook groups and product identities together.'
          )
        applyFields(destination, group, original, [
          'baseCode',
          'spanishName',
          'category',
          'naming',
          'sizeMode',
        ])
        for (const variant of group.variants) {
          const mappedVariant = mapped.variants.find(
              (value) => value.id === variant.id
            ),
            target = destination.variants.find((value) =>
              sameSet(value.entryIds, mappedVariant.entryIds)
            ),
            source = original.variants.find((value) => value.id === variant.id)
          if (!target)
            throw new Error(
              'Keep the reviewed workbook groups and product identities together.'
            )
          applyFields(target, variant, source, [
            'variantSuffix',
            'sizeSuffix',
            'needsSizeMapping',
            'spanishName',
            'naming',
            'material',
            'materialSource',
            'materialOverrides',
          ])
        }
      }
      return result
    },
  }
}

/**
 * Pure full-replacement review. `mappings` maps incoming source row numbers to
 * existing source row numbers or the explicit string `new`; row positions do
 * not establish identity. Keep sourceCandidate when reopening this draft.
 */
export function planStoreOrderUpdate(
  state,
  {
    candidate,
    sourceCandidate = candidate,
    target,
    mappings = {},
    preparation,
    draftCandidate,
    previousSuggestedPreparation,
    resetCodes = false,
    identityChangesConfirmed = false,
  }
) {
  const previous = state.records.find(
    (record) => orderKey(record) === orderKey(target)
  )
  if (!previous || previous.snapshot.sourceType !== 'spreadsheet')
    throw new Error('Choose an existing spreadsheet purchase to update.')
  const old = previous.snapshot,
    raw = sourceCandidate.snapshot
  if (raw.accountId !== old.accountId || raw.store?.key !== old.store.key)
    throw new Error('The workbook must match this account and store identity.')
  const key = orderKey(old),
    previousPreparation = state.preparations.find(
      (value) => orderKey(value) === key
    ),
    beforeRows = sourceRows(old, previousPreparation),
    incomingRows = sourceRows(raw),
    issues = [],
    resolved = {},
    claimed = new Set(),
    matches = new Map(),
    issue = (code, message, detail = {}) =>
      issues.push({ code, message, severity: 'error', ...detail })
  for (const row of incomingRows) {
    const choice = mappings[String(row.row)]
    if (choice === undefined) continue
    if (choice === 'new') {
      resolved[row.row] = 'new'
      continue
    }
    const previousRow = beforeRows.find((value) => value.row === Number(choice))
    if (!previousRow || claimed.has(previousRow.row)) {
      issue(
        'STORE_UPDATE_MAPPING_INVALID',
        'Choose each existing source row only once.',
        { incomingRow: row.row, row: row.row }
      )
      continue
    }
    matches.set(row.row, previousRow)
    claimed.add(previousRow.row)
    resolved[row.row] = previousRow.row
  }
  const suggestions = new Map()
  for (const row of incomingRows) {
    if (resolved[row.row] !== undefined) continue
    const scored = beforeRows
      .filter((value) => !claimed.has(value.row))
      .map((value) => ({ value, score: matchingScore(row, value) }))
      .filter(({ score }) => score > 0)
    const best = Math.max(0, ...scored.map(({ score }) => score))
    suggestions.set(
      row.row,
      scored.filter(({ score }) => score === best).map(({ value }) => value)
    )
  }
  for (const row of incomingRows) {
    if (resolved[row.row] !== undefined) continue
    const candidates = suggestions.get(row.row) || []
    const unique =
      candidates.length === 1 &&
      [...suggestions.values()].filter((values) =>
        values.some((value) => value.row === candidates[0].row)
      ).length === 1
    if (unique) {
      matches.set(row.row, candidates[0])
      claimed.add(candidates[0].row)
      resolved[row.row] = candidates[0].row
    } else if (
      !candidates.length &&
      !beforeRows.some((value) => value.group === row.group)
    ) {
      resolved[row.row] = 'new'
    } else {
      const choices = (
        candidates.length
          ? candidates
          : beforeRows.filter((value) => value.group === row.group)
      ).map((value) => ({
        row: value.row,
        group: value.group,
        description: value.description,
      }))
      issue(
        'STORE_UPDATE_MAPPING_REQUIRED',
        'Match this workbook row to an existing product or mark it as new.',
        {
          incomingRow: row.row,
          row: row.row,
          choices,
        }
      )
    }
  }
  let nextId = old.items.reduce(
    (max, item) => (BigInt(item.entryId) > max ? BigInt(item.entryId) : max),
    0n
  )
  // Include old history so a removed identity is never reused on a later update.
  for (const entry of state.history || []) {
    const snapshot = entry.snapshot || entry
    if (orderKey(snapshot) !== key) continue
    for (const item of snapshot.items || [])
      if (/^\d+$/.test(item.entryId) && BigInt(item.entryId) > nextId)
        nextId = BigInt(item.entryId)
  }
  const next = clone(sourceCandidate),
    idMap = new Map(),
    identityChanges = []
  next.snapshot.accountId = old.accountId
  next.snapshot.orderId = old.orderId
  next.snapshot.purchasedAt = old.purchasedAt
  next.snapshot.store = clone(old.store)
  next.snapshot.sellerName = old.sellerName
  next.snapshot.sellerMemberLogin = old.sellerMemberLogin
  for (const row of incomingRows) {
    const matched = matches.get(row.row),
      used = new Set()
    for (const item of row.items) {
      const identities = (matched?.items || []).filter(
        (value) =>
          !used.has(value.entryId) &&
          (value.sourceVariant || '') === (item.sourceVariant || '') &&
          (value.sourceSize || '') === (item.sourceSize || '')
      )
      // Explicit row matching can also retain a sole identity whose declaration
      // changed, but the code correction requires its own acknowledgment.
      const oldItem =
        identities.length === 1
          ? identities[0]
          : matched?.items.length === 1 && row.items.length === 1
            ? matched.items[0]
            : null
      const entryId = oldItem ? oldItem.entryId : String(++nextId)
      if (oldItem) {
        used.add(oldItem.entryId)
        if (
          oldItem.sourceGroup !== item.sourceGroup ||
          (oldItem.sourceVariant || '') !== (item.sourceVariant || '') ||
          (oldItem.sourceSize || '') !== (item.sourceSize || '')
        )
          identityChanges.push({
            entryId,
            incomingRow: row.row,
            before: {
              group: oldItem.sourceGroup,
              variant: oldItem.sourceVariant || '',
              size: oldItem.sourceSize || '',
            },
            after: {
              group: item.sourceGroup,
              variant: item.sourceVariant || '',
              size: item.sourceSize || '',
            },
          })
      }
      idMap.set(item.entryId, entryId)
    }
  }
  next.snapshot.items = next.snapshot.items.map((item) => ({
    ...item,
    entryId: idMap.get(item.entryId),
  }))
  next.unitsPerCarton = Object.fromEntries(
    Object.entries(next.unitsPerCarton).map(([id, value]) => [
      idMap.get(id),
      value,
    ])
  )
  const afterRows = sourceRows(next.snapshot),
    selectedIds = new Set(next.snapshot.items.map((item) => item.entryId)),
    retained = prunePreparation(previousPreparation, selectedIds),
    month = purchaseMonthForCodes(next.snapshot),
    sourcePreparation = createPreparation(
      next.snapshot,
      month,
      state.preferences?.vocabulary,
      state.preferences?.sizeVocabulary
    ),
    usedGroups = new Set(),
    usedVariants = new Set()
  let edited = preparation && clone(preparation),
    rebase = null
  try {
    rebase = rebaseDraftPreparation({
      preparation: edited,
      baseline: previousSuggestedPreparation,
      draftCandidate,
      next,
    })
    if (rebase) edited = null
  } catch (error) {
    issue('STORE_UPDATE_CODES_INVALID', error.message)
  }
  const draftMembership = rebase?.mappedPreparation || edited
  sourcePreparation.revision = previousPreparation?.revision || 0
  sourcePreparation.updatedAt =
    previousPreparation?.updatedAt || sourcePreparation.updatedAt
  sourcePreparation.sellerId =
    previousPreparation?.sellerId || sourcePreparation.sellerId
  sourcePreparation.groups = sourcePreparation.groups.map((sourceGroup) => {
    const ids = groupIds(sourceGroup),
      previousGroups = (retained?.groups || []).filter((group) =>
        groupIds(group).some((id) => ids.includes(id))
      ),
      available = previousGroups.filter((group) => !usedGroups.has(group.id)),
      fromOld = available.length === 1 ? available[0] : null,
      fromDraft = draftMembership?.groups.find((group) =>
        sameSet(groupIds(group), ids)
      ),
      base = fromOld || fromDraft
    if (previousGroups.length > 1 || (previousGroups.length && !fromOld))
      identityChanges.push({
        entryIds: ids,
        incomingRow: next.snapshot.items.find((item) =>
          ids.includes(item.entryId)
        )?.sourceRow,
        before: 'Existing preparation groups',
        after: 'Workbook product group',
      })
    if (fromOld) usedGroups.add(fromOld.id)
    const group = {
      ...(base ? clone(base) : sourceGroup),
      id: base?.id || sourceGroup.id,
      title: sourceGroup.title,
      variants: sourceGroup.variants.map((sourceVariant) => {
        const olds = previousGroups
          .flatMap((group) => group.variants)
          .filter((variant) =>
            variant.entryIds.some((id) => sourceVariant.entryIds.includes(id))
          )
        const oldVariant =
            olds.length === 1 && !usedVariants.has(olds[0].id) ? olds[0] : null,
          draftVariant = fromDraft?.variants.find((variant) =>
            sameSet(variant.entryIds, sourceVariant.entryIds)
          ),
          variant = clone(oldVariant || draftVariant || sourceVariant),
          changedIdentity = identityChanges.some((change) =>
            sourceVariant.entryIds.includes(change.entryId)
          )
        if (olds.length > 1)
          identityChanges.push({
            entryIds: sourceVariant.entryIds,
            before: 'Existing variant identities',
            after: 'Workbook variant identity',
          })
        if (oldVariant) usedVariants.add(oldVariant.id)
        variant.entryIds = [...sourceVariant.entryIds]
        if (olds.length) {
          if (
            [variant, ...olds].some((value) =>
              ['material', 'materialSource', 'materialOverrides'].some(
                (field) => Object.hasOwn(value, field)
              )
            )
          )
            mergeVariantMaterials(variant, olds)
          const names = [
            ...new Set(
              olds
                .filter((value) => value.spanishName !== undefined)
                .map((value) => value.spanishName)
            ),
          ]
          if (names.length === 1) variant.spanishName = names[0]
          if (names.length > 1 && draftVariant?.spanishName === undefined)
            issue(
              'STORE_UPDATE_DETAILS_REVIEW_REQUIRED',
              'Choose the product details to keep when workbook groups merge.',
              {
                groupId: base?.id || sourceGroup.id,
                variantId: variant.id,
                field: 'spanishName',
                values: names,
              }
            )
        }
        if (changedIdentity && identityChangesConfirmed) {
          variant.variant = sourceVariant.variant
          variant.size = sourceVariant.size
          variant.variantSuffix = sourceVariant.variantSuffix
          variant.sizeSuffix = sourceVariant.sizeSuffix
          variant.needsSizeMapping = sourceVariant.needsSizeMapping
        }
        return variant
      }),
    }
    for (const field of ['spanishName', 'category']) {
      const authors = previousGroups.filter(
          (value) =>
            value.naming?.[field]?.source === 'manual' ||
            (!value.naming?.[field] && value[field])
        ),
        values = [...new Set(authors.map((value) => value[field]))]
      if (values.length === 1) {
        group[field] = values[0]
        group.naming = {
          ...group.naming,
          [field]: { source: 'manual', value: values[0] },
        }
      } else if (values.length > 1) {
        const choice =
          fromDraft?.naming?.[field]?.source === 'manual'
            ? fromDraft[field]
            : undefined
        if (choice !== undefined) {
          group[field] = choice
          group.naming = {
            ...group.naming,
            [field]: { source: 'manual', value: choice },
          }
        } else {
          group[field] = sourceGroup[field]
          group.naming = {
            ...group.naming,
            [field]: clone(sourceGroup.naming[field]),
          }
          issue(
            'STORE_UPDATE_DETAILS_REVIEW_REQUIRED',
            'Choose the product details to keep when workbook groups merge.',
            {
              groupId: group.id,
              field,
              values,
            }
          )
        }
      }
    }
    // A merged/split workbook family cannot silently retain a shared base.
    if (!fromOld && !fromDraft) group.baseCode = ''
    if (
      identityChangesConfirmed &&
      identityChanges.some((change) =>
        (change.entryIds || [change.entryId]).some((id) => ids.includes(id))
      )
    )
      delete group.sizeMode
    return group
  })
  if (identityChanges.length && !identityChangesConfirmed)
    issue(
      'STORE_UPDATE_IDENTITY_REVIEW_REQUIRED',
      'Review and confirm the changed workbook grouping or variant declarations before updating.',
      { identityChanges: clone(identityChanges) }
    )
  const suggestMaterial = createMaterialSuggester(
      state.preferences?.materialVocabulary
    ),
    materialSuggestions = refreshPreparationMaterials(
      refreshPreparationNames(
        sourcePreparation,
        createNameSuggester(state.preferences?.vocabulary)
      ),
      next.snapshot,
      new Map(
        next.snapshot.items.map((item) => [item.entryId, suggestMaterial(item)])
      )
    )
  let suggestedPreparation = materialSuggestions
  const records = state.records.map((record) =>
    orderKey(record) === key ? { ...record, snapshot: next.snapshot } : record
  )
  try {
    const options = {
        snapshot: next.snapshot,
        historicalReservations: [
          ...historicalCodeReservations(state.locks || []),
          ...physicalMarkReservations(state),
        ],
        supplierIdentityEquivalences: supplierCodeIdentityEquivalences(records),
      },
      packing = activePackingState(
        state.preparations,
        state.allocations || [],
        state.issuedCodes || [],
        options
      )
    suggestedPreparation = allocatePreparation(
      materialSuggestions,
      packing.allocations,
      packing.issuedCodes,
      options
    ).preparation
    if (rebase) edited = rebase.apply(suggestedPreparation)
    if (edited && !resetCodes) {
      const expected = new Map(
        suggestedPreparation.groups.map((group) => [
          memberKey({ entryIds: groupIds(group) }),
          group,
        ])
      )
      const shape = validatePreparation({
        ...edited,
        groups: edited.groups.map((group) => ({
          ...group,
          baseCode: '',
          variants: group.variants.map((variant) => ({
            ...variant,
            variantSuffix: '',
            sizeSuffix: '',
          })),
        })),
      })
      if (
        shape.accountId !== old.accountId ||
        shape.orderId !== old.orderId ||
        shape.revision !== (previousPreparation?.revision || 0) ||
        shape.sellerId !== sourcePreparation.sellerId ||
        shape.month !== month ||
        shape.groups.length !== suggestedPreparation.groups.length ||
        shape.groups.some((group) => {
          const source = expected.get(memberKey({ entryIds: groupIds(group) }))
          return (
            !source ||
            source.id !== group.id ||
            source.variants.length !== group.variants.length ||
            group.variants.some(
              (variant) =>
                !source.variants.some(
                  (value) =>
                    value.id === variant.id &&
                    memberKey(value) === memberKey(variant)
                )
            )
          )
        })
      )
        throw new Error(
          'Keep the reviewed workbook groups and product identities together.'
        )
      const checked = validatePreparation(edited)
      for (let gi = 0; gi < checked.groups.length; gi++) {
        if (!edited.groups[gi].baseCode)
          throw Object.assign(
            new Error('Enter a base code or generate the suggested codes.'),
            {
              packingIssue: {
                groupId: edited.groups[gi].id,
                field: 'baseCode',
              },
            }
          )
        if (checked.groups[gi].baseCode !== edited.groups[gi].baseCode)
          throw Object.assign(
            new Error('Enter the base code without surrounding spaces.'),
            {
              packingIssue: {
                groupId: edited.groups[gi].id,
                field: 'baseCode',
              },
            }
          )
        for (let vi = 0; vi < checked.groups[gi].variants.length; vi++)
          for (const field of ['variantSuffix', 'sizeSuffix'])
            if (
              checked.groups[gi].variants[vi][field] !==
              edited.groups[gi].variants[vi][field]
            )
              throw Object.assign(
                new Error('Enter code endings without surrounding spaces.'),
                {
                  packingIssue: {
                    groupId: edited.groups[gi].id,
                    variantId: edited.groups[gi].variants[vi].id,
                    field,
                  },
                }
              )
      }
      validatePreparationSuffixEdits(edited, previousPreparation, {
        snapshot: next.snapshot,
        sizeVocabulary: state.preferences?.sizeVocabulary,
      })
      const assigned = allocatePreparation(
        edited,
        packing.allocations,
        packing.issuedCodes,
        options
      )
      for (let gi = 0; gi < edited.groups.length; gi++) {
        const shown = edited.groups[gi],
          allocated = assigned.preparation.groups[gi]
        if (
          shown.baseCode !== allocated.baseCode ||
          shown.variants.some(
            (variant, vi) =>
              !variant.needsSizeMapping &&
              barcodeValue(shown, variant) !==
                barcodeValue(allocated, allocated.variants[vi])
          )
        )
          throw Object.assign(
            new Error('Enter a base code or generate the suggested codes.'),
            {
              packingIssue: { groupId: shown.id, field: 'baseCode' },
            }
          )
      }
    }
  } catch (error) {
    issue(error.code || 'STORE_UPDATE_CODES_INVALID', error.message, {
      ...(error.detail || {}),
      ...(error.packingIssue || {}),
      ...(error.conflict ? { conflict: clone(error.conflict) } : {}),
    })
  }
  // Reset only code components. Scoped authored details in the current draft
  // survive even when that draft has invalid unfinished code edits.
  if (edited && resetCodes)
    suggestedPreparation = {
      ...suggestedPreparation,
      groups: suggestedPreparation.groups.map((group) => {
        const current = edited.groups.find((value) => value.id === group.id)
        if (!current) return group
        return {
          ...group,
          ...Object.fromEntries(
            ['spanishName', 'category', 'naming']
              .filter((field) => current[field] !== undefined)
              .map((field) => [field, clone(current[field])])
          ),
          variants: group.variants.map((variant) => {
            const value = current.variants.find(
              (entry) => entry.id === variant.id
            )
            if (!value) return variant
            return {
              ...variant,
              ...Object.fromEntries(
                [
                  'spanishName',
                  'naming',
                  'material',
                  'materialSource',
                  'materialOverrides',
                ]
                  .filter((field) => value[field] !== undefined)
                  .map((field) => [field, clone(value[field])])
              ),
            }
          }),
        }
      }),
    }
  const finalPreparation = edited && !resetCodes ? edited : suggestedPreparation
  for (const group of finalPreparation.groups)
    for (const variant of group.variants)
      if (variant.needsSizeMapping)
        issue(
          'PURCHASE_SIZE_REQUIRED',
          'Resolve the source size before assigning a barcode.',
          { groupId: group.id, variantId: variant.id, field: 'sizeSuffix' }
        )
  const finalRows = sourceRows(next.snapshot, finalPreparation),
    rowChanges = []
  for (const row of finalRows) {
    const before = matches.get(row.row),
      fields = fieldChanges(before, row),
      status =
        resolved[row.row] === undefined
          ? 'unresolved'
          : !before
            ? 'added'
            : fields.length
              ? 'changed'
              : 'unchanged',
      priceStatus = !before
        ? 'new'
        : comparePrices(before.price, row.price) === 0
          ? 'unchanged'
          : comparePrices(before.price, row.price) < 0
            ? 'increased'
            : 'decreased',
      mappingIssue = issues.find(
        (value) =>
          value.code === 'STORE_UPDATE_MAPPING_REQUIRED' &&
          value.incomingRow === row.row
      )
    rowChanges.push({
      incomingRow: row.row,
      previousRow: before?.row ?? null,
      before: rowDto(before),
      after: rowDto(row),
      fields,
      status,
      priceStatus,
      entryIds: row.entryIds,
      ...(mappingIssue ? { choices: clone(mappingIssue.choices) } : {}),
    })
  }
  for (const row of beforeRows)
    if (!claimed.has(row.row))
      rowChanges.push({
        incomingRow: null,
        previousRow: row.row,
        before: rowDto(row),
        after: null,
        status: 'removed',
        priceStatus: 'removed',
        fields: fieldChanges(row, null),
        entryIds: row.entryIds,
      })
  const cartonBatchChanges = planBatches(
    state,
    next,
    finalRows,
    matches,
    issues
  )
  const summary = {
    before: totals(old),
    after: totals(next.snapshot),
    added: rowChanges.filter((row) => row.status === 'added').length,
    removed: rowChanges.filter((row) => row.status === 'removed').length,
    changed: rowChanges.filter((row) => row.status === 'changed').length,
    unchanged: rowChanges.filter((row) => row.status === 'unchanged').length,
    priceChanges: rowChanges.filter((row) =>
      ['increased', 'decreased'].includes(row.priceStatus)
    ).length,
    unchangedPrices: rowChanges.filter((row) => row.priceStatus === 'unchanged')
      .length,
    measurementsAdded: rowChanges.filter(
      (row) =>
        row.before &&
        row.fields.some(
          (value) =>
            ['kg', 'cbm', 'len', 'wid', 'ht'].includes(value.field) &&
            value.before == null &&
            value.after != null
        )
    ).length,
  }
  const sourceMetadataChanges = ['filename', 'sheetName'].flatMap((field) =>
    old.spreadsheet[field] === next.snapshot.spreadsheet[field]
      ? []
      : [
          {
            field,
            before: old.spreadsheet[field],
            after: next.snapshot.spreadsheet[field],
          },
        ]
  )
  summary.hasChanges = !!(
    summary.added ||
    summary.removed ||
    summary.changed ||
    cartonBatchChanges.length ||
    sourceMetadataChanges.length ||
    finalRows.some((row) => matches.get(row.row)?.row !== row.row) ||
    stableValue(comparablePreparationGroups(finalPreparation)) !==
      stableValue(comparablePreparationGroups(previousPreparation))
  )
  return {
    target: { accountId: old.accountId, orderId: old.orderId },
    sourceCandidate: clone(sourceCandidate),
    candidate: next,
    preparation: finalPreparation,
    suggestedPreparation,
    mappings: resolved,
    rowChanges,
    summary,
    hasChanges: summary.hasChanges,
    issues,
    identityChanges,
    identityChangesConfirmed,
    sourceMetadataChanges,
    expectedRevisions: reconciliationRevisions(state, target),
    cartonBatchChanges,
  }
}

function planBatches(state, candidate, afterRows, matches, issues) {
  const snapshot = candidate.snapshot,
    batches = (state.batches || []).filter(
      (batch) =>
        !batch.deletedAt &&
        batch.accountId === snapshot.accountId &&
        (batch.orderId === snapshot.orderId ||
          batch.contents.some((item) => item.orderId === snapshot.orderId))
    ),
    used = new Set(),
    changes = []
  for (const row of afterRows) {
    const oldRow = matches.get(row.row),
      eligible = oldRow
        ? batches.filter(
            (batch) =>
              batch.contents.length &&
              batch.contents.every(
                (item) =>
                  item.orderId === snapshot.orderId &&
                  oldRow.entryIds.includes(item.entryId)
              )
          )
        : [],
      oldBatch = eligible.find((batch) => !used.has(batch.id)),
      id =
        oldBatch?.id ||
        `spreadsheet:${snapshot.accountId}/${snapshot.orderId}/${row.entryIds.join('.')}/${snapshot.observedAt}`
    if (oldBatch) used.add(oldBatch.id)
    const contents = snapshot.items
      .filter((item) => item.sourceRow === row.row)
      .map((item) => ({
        orderId: snapshot.orderId,
        entryId: item.entryId,
        quantity: item.quantity,
      }))
    const physical = {
      count: Number(row.boxes),
      contents,
      packingBasis:
        Number(row.boxes) === 1
          ? 'exact'
          : contents.length === 1 && row.perbox
            ? 'uniform'
            : 'aggregate',
      len: row.len ?? '',
      wid: row.wid ?? '',
      ht: row.ht ?? '',
      weight: row.kg ?? '',
      weightBasis: 'carton',
      suppliedCbm: row.cbm ?? '',
      volumeBasis: 'carton',
      unresolvedContents: [],
      contentsUnknown: false,
    }
    // Existing source facts can be overwritten, but no received/loading decision
    // or physical exception is silently stretched across a new carton count.
    const unchanged =
      oldBatch &&
      !['unitContents', 'unitMeasurements'].some(
        (field) => Object.keys(oldBatch[field] || {}).length
      ) &&
      Object.entries(physical).every(([field, value]) =>
        numericFields.includes(field) ||
        ['weight', 'suppliedCbm'].includes(field)
          ? canonical(oldBatch[field]) === canonical(value)
          : stableValue(oldBatch[field]) === stableValue(value)
      )
    if (unchanged) continue
    const raw = {
      ...(oldBatch ? clone(oldBatch) : {}),
      id,
      accountId: snapshot.accountId,
      orderId: snapshot.orderId,
      storeId: repeatProductStoreIdentity(snapshot),
      groups: oldBatch?.groups || [],
      labelOrigin: oldBatch?.labelOrigin || 'internal',
      received: oldBatch?.received ?? null,
      loaded: oldBatch?.loaded ?? null,
      ...physical,
      provenance: { kind: 'supplier-source', row: row.row },
      revision: oldBatch?.revision || 0,
      updatedAt: snapshot.observedAt,
    }
    for (const field of ['unitContents', 'unitMeasurements']) delete raw[field]
    try {
      const after = validateCartonBatch(raw)
      if (
        (after.received ?? 0) > after.count ||
        (after.loaded ?? 0) > after.count
      )
        throw new Error(
          'The updated carton count conflicts with received or loaded cartons.'
        )
      changes.push({
        ...(oldBatch ? { before: clone(oldBatch) } : {}),
        after,
        expectedRevision: oldBatch?.revision || 0,
      })
    } catch (error) {
      issues.push({
        severity: 'error',
        code: 'STORE_UPDATE_CARTON_CONFLICT',
        message: error.message,
        row: row.row,
        incomingRow: row.row,
        batchId: id,
      })
    }
  }
  for (const batch of batches)
    if (!used.has(batch.id)) {
      if (batch.contents.some((item) => item.orderId !== snapshot.orderId)) {
        issues.push({
          severity: 'error',
          code: 'STORE_UPDATE_CARTON_OWNERSHIP',
          message:
            'These cartons also reference another purchase. Review their ownership before updating.',
          batchId: batch.id,
        })
        continue
      }
      if (batch.received != null || batch.loaded != null) {
        issues.push({
          severity: 'error',
          code: 'STORE_UPDATE_CARTON_DECISIONS',
          message:
            'These cartons have received or loading decisions that cannot be carried to the updated workbook. Review those decisions before updating.',
          batchId: batch.id,
        })
        continue
      }
      changes.push({
        before: clone(batch),
        after: { ...clone(batch), deletedAt: snapshot.observedAt },
        expectedRevision: batch.revision,
      })
    }
  return changes
}
