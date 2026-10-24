import {
  activePackingState,
  allocatePreparation,
  barcodeValue,
  CodeConflictError,
  createPreparation,
  validatePreparation,
  validatePreparationSuffixEdits,
  refreshPreparationMaterials,
} from './packing-model.js'
import { createMaterialSuggester } from './material-vocabulary.js'
import {
  historicalCodeReservations,
  physicalMarkReservations,
  planPurchaseCodeReview,
  purchaseMonthForCodes,
  supplierCodeIdentityEquivalences,
} from './purchase-codes.js'

const members = (variant) => JSON.stringify([...variant.entryIds].sort())
const groupMembers = (group) =>
  members({ entryIds: group.variants.flatMap((variant) => variant.entryIds) })
const fieldNames = {
  code: 'baseCode',
  variant: 'variantSuffix',
  size: 'sizeSuffix',
}

/** Preview only: the returned assignments occupy no library codes. */
export function reviewStoreImportCodes(
  state,
  { candidate, preparation, resetCodes = false }
) {
  const snapshot = candidate.snapshot,
    month = purchaseMonthForCodes(snapshot),
    record = { snapshot },
    records = [...state.records, record],
    issues = []
  const ownerEvidence = (owner) => {
    const source = records.find(
      (record) =>
        record.snapshot.accountId === owner.accountId &&
        record.snapshot.orderId === owner.orderId
    )?.snapshot
    const prepared =
      owner.orderId === preparation?.orderId &&
      owner.accountId === preparation.accountId
        ? preparation
        : state.preparations.find(
            (value) =>
              value.accountId === owner.accountId &&
              value.orderId === owner.orderId
          )
    const group = prepared?.groups.find((group) => group.id === owner.groupId),
      captured = owner.ownerSnapshot,
      entryIds =
        group?.variants.flatMap((variant) => variant.entryIds) ??
        captured?.entryIds ??
        [],
      sourceGroups = [
        ...new Set(
          (source?.items ?? [])
            .filter((item) => entryIds.includes(item.entryId))
            .map((item) => item.sourceGroup)
            .filter(Boolean)
        ),
      ],
      historical = (state.locks ?? []).find((lock) =>
        lock.lineages?.some((lineage) =>
          lineage.reservations?.some(
            (entry) =>
              entry.accountId === owner.accountId &&
              entry.kind === owner.kind &&
              entry.code === owner.code &&
              (entry.orderId === owner.orderId ||
                entry.members?.some(
                  (member) => member.orderId === owner.orderId
                ))
          )
        )
      )
    return {
      ...structuredClone(owner),
      ...(group?.title || captured?.groupTitle
        ? { groupTitle: group?.title || captured.groupTitle }
        : {}),
      ...(sourceGroups.length ? { sourceGroup: sourceGroups.join(', ') } : {}),
      ...(source?.sellerName || captured?.sellerName
        ? { supplierName: source?.sellerName || captured.sellerName }
        : {}),
      ...(source
        ? {
            orderReference:
              source.reference ||
              source.spreadsheet?.filename ||
              source.orderId,
            purchaseDate: source.purchasedAt,
          }
        : {}),
      ...(historical
        ? {
            historyKind: historical.kind,
            containerId: historical.firstContainerId,
            revisionId: historical.firstRevisionId,
          }
        : {}),
    }
  }
  const problem = (error, detail = {}) => {
    const source = error.packingIssue ?? error.detail ?? {},
      conflict = error.conflict && {
        ...structuredClone(error.conflict),
        owner: ownerEvidence(error.conflict.owner),
        requestedOwner: ownerEvidence(error.conflict.requestedOwner),
      },
      owner = conflict?.requestedOwner
    const issue = {
      code: error.code ?? 'STORE_IMPORT_CODES_INVALID',
      message: error.message,
      severity: 'error',
      ...source,
      ...(owner?.groupId ? { groupId: owner.groupId } : {}),
      ...(owner?.variantId ? { variantId: owner.variantId } : {}),
      ...detail,
      ...(conflict ? { conflict: structuredClone(conflict) } : {}),
    }
    if (issue.field) issue.field = fieldNames[issue.field] ?? issue.field
    if (
      !issues.some((value) => JSON.stringify(value) === JSON.stringify(issue))
    )
      issues.push(issue)
  }
  const issue = (code, message, detail) =>
    problem(Object.assign(new Error(message), { code }), detail)
  const source = createPreparation(
    snapshot,
    month,
    state.preferences?.vocabulary,
    state.preferences?.sizeVocabulary
  )
  if (!preparation) {
    const initial = planPurchaseCodeReview(
      { ...state, records },
      {
        orderRefs: [
          { accountId: snapshot.accountId, orderId: snapshot.orderId },
        ],
      }
    )
    preparation = initial.plan.preparations[0] ?? source
    for (const value of initial.issues)
      if (value.code !== 'PURCHASE_SIZE_REQUIRED')
        issues.push({ ...value, severity: 'error' })
    const materialSuggester = createMaterialSuggester(
      state.preferences?.materialVocabulary
    )
    preparation = refreshPreparationMaterials(
      preparation,
      snapshot,
      new Map(
        snapshot.items.map((item) => [item.entryId, materialSuggester(item)])
      )
    )
  }
  // Keep raw edited values in the result, including invalid codes, for correction.
  const result = { candidate, preparation, suggestedPreparation: null, issues }
  if (typeof resetCodes !== 'boolean') {
    issue('STORE_IMPORT_CODES_INVALID', 'Reset codes must be true or false.')
    return result
  }
  let shape
  try {
    shape = validatePreparation({
      ...preparation,
      groups: preparation.groups.map((group) => ({
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
      shape.accountId !== snapshot.accountId ||
      shape.orderId !== snapshot.orderId ||
      shape.sellerId !== source.sellerId ||
      shape.month !== month ||
      shape.revision !== 0 ||
      shape.accountId !== preparation.accountId ||
      shape.orderId !== preparation.orderId ||
      shape.sellerId !== preparation.sellerId ||
      shape.groups.some(
        (group, index) =>
          group.id !== preparation.groups[index].id ||
          group.variants.some(
            (variant, variantIndex) =>
              variant.id !== preparation.groups[index].variants[variantIndex].id
          )
      ) ||
      shape.defaultPacking ||
      shape.previousPacking ||
      shape.groups.some((group) => group.month && group.month !== month)
    )
      throw new Error(
        'The code review must belong to this new spreadsheet purchase.'
      )
    const expected = new Map(
      source.groups.map((group) => [groupMembers(group), group])
    )
    if (shape.groups.length !== source.groups.length)
      throw new Error(
        'Keep the source spreadsheet groups and variants together.'
      )
    for (const group of shape.groups) {
      const original = expected.get(groupMembers(group)),
        variants = new Map(
          original?.variants.map((variant) => [members(variant), variant])
        )
      if (
        !original ||
        original.variants.length !== group.variants.length ||
        group.sharedProductId ||
        group.variants.some((variant) => {
          const value = variants.get(members(variant))
          return (
            !value ||
            value.variant !== variant.variant ||
            value.size !== variant.size
          )
        })
      )
        throw Object.assign(
          new Error(
            'Keep the source spreadsheet groups and variants together.'
          ),
          {
            packingIssue: { groupId: group.id },
          }
        )
      original.id = group.id
      for (const variant of original.variants)
        variant.id = group.variants.find(
          (value) => members(value) === members(variant)
        ).id
    }
  } catch (error) {
    problem(error)
    return result
  }
  let packing, options
  try {
    options = {
      snapshot,
      historicalReservations: [
        ...historicalCodeReservations(state.locks ?? []),
        ...physicalMarkReservations(state),
      ],
      supplierIdentityEquivalences: supplierCodeIdentityEquivalences(records),
    }
    packing = activePackingState(
      state.preparations,
      state.allocations,
      state.issuedCodes,
      options
    )
    const suggested = {
      ...preparation,
      groups: preparation.groups.map((group) => {
        const original = source.groups.find((value) => value.id === group.id)
        return {
          ...group,
          baseCode: '',
          variants: group.variants.map((variant) => {
            const value = original.variants.find(
              (entry) => entry.id === variant.id
            )
            return {
              ...variant,
              variantSuffix: value.variantSuffix,
              sizeSuffix: group.sizeMode === 'none' ? '' : value.sizeSuffix,
              needsSizeMapping:
                group.sizeMode === 'none' ? false : value.needsSizeMapping,
            }
          }),
        }
      }),
    }
    result.suggestedPreparation = allocatePreparation(
      suggested,
      packing.allocations,
      packing.issuedCodes,
      options
    ).preparation
    if (resetCodes)
      preparation = result.preparation = result.suggestedPreparation
  } catch (error) {
    problem(error)
  }
  const bases = new Map(),
    barcodes = new Map()
  for (const group of preparation.groups) {
    const original = source.groups.find((value) => value.id === group.id)
    const owner = {
      accountId: preparation.accountId,
      orderId: preparation.orderId,
      sellerId: preparation.sellerId,
      month,
      groupId: group.id,
      kind: 'base',
      code: group.baseCode,
    }
    let validBase = true
    try {
      const checked = validatePreparation({
        ...preparation,
        groups: [{ ...group, variants: [] }],
      })
      if (checked.groups[0].baseCode !== group.baseCode)
        throw new Error('Enter the base code without surrounding spaces.')
      if (!group.baseCode)
        throw new Error('Enter a base code or generate the suggested codes.')
      if (bases.has(group.baseCode))
        throw new CodeConflictError(bases.get(group.baseCode), owner)
      bases.set(group.baseCode, owner)
    } catch (error) {
      validBase = false
      problem(error, { groupId: group.id, field: 'baseCode' })
    }
    let validVariants = true
    for (const variant of group.variants) {
      const detail = { groupId: group.id, variantId: variant.id }
      try {
        const one = {
          ...preparation,
          groups: [{ ...group, baseCode: '', variants: [variant] }],
        }
        const checked = validatePreparation(one)
        for (const field of ['variantSuffix', 'sizeSuffix'])
          if (checked.groups[0].variants[0][field] !== variant[field])
            throw Object.assign(
              new Error('Enter code endings without surrounding spaces.'),
              {
                packingIssue: { field },
              }
            )
        validatePreparationSuffixEdits(checked, undefined, {
          snapshot,
          sizeVocabulary: state.preferences?.sizeVocabulary,
        })
      } catch (error) {
        validVariants = false
        const invalidField =
          typeof variant.variantSuffix !== 'string' ||
          !/^[A-Z]*$/.test(variant.variantSuffix)
            ? 'variantSuffix'
            : typeof variant.sizeSuffix !== 'string' ||
                !/^[A-Z0-9]*$/.test(variant.sizeSuffix)
              ? 'sizeSuffix'
              : null
        problem(error, {
          ...detail,
          ...(invalidField ? { field: invalidField } : {}),
        })
        continue
      }
      const expected = original.variants.find(
        (value) => value.id === variant.id
      )
      if (
        variant.needsSizeMapping ||
        (group.sizeMode !== 'none' &&
          !variant.sizeSuffix &&
          (expected.needsSizeMapping || expected.sizeSuffix)) ||
        (group.sizeMode === 'none' && variant.sizeSuffix)
      )
        issue(
          'PURCHASE_SIZE_REQUIRED',
          'Resolve the source size or choose Do not add size endings.',
          {
            ...detail,
            entryId: variant.entryIds[0],
            field: 'sizeSuffix',
          }
        )
      if (!validBase || variant.needsSizeMapping) continue
      const code = barcodeValue(group, variant),
        requested = { ...owner, kind: 'barcode', code, variantId: variant.id }
      if (barcodes.has(code)) {
        validVariants = false
        problem(new CodeConflictError(barcodes.get(code), requested), {
          ...detail,
          field: 'variantSuffix',
        })
      } else barcodes.set(code, requested)
    }
    if (packing && validBase && validVariants) {
      try {
        allocatePreparation(
          { ...preparation, groups: [group] },
          packing.allocations,
          packing.issuedCodes,
          options
        )
      } catch (error) {
        problem(error, {
          groupId: group.id,
          field:
            error.conflict?.kind === 'barcode' ? 'variantSuffix' : 'baseCode',
        })
      }
    }
  }
  return result
}
