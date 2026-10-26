import {
  barcodeValue,
  refreshPreparationMaterials,
  variantMaterial,
} from './packing-model.js'
import {
  createNameSuggester,
  refreshPreparationNames,
} from './product-vocabulary.js'
import { createMaterialSuggester } from './material-vocabulary.js'

const orderKey = ({ accountId = 'local', orderId }) =>
  JSON.stringify([accountId, orderId])
const entryKey = (row) => JSON.stringify([orderKey(row), row.entryId])
const members = (preparation) =>
  new Map(
    (preparation?.groups || []).flatMap((group) =>
      group.variants.flatMap((variant) =>
        variant.entryIds.map((entryId) => [entryId, { group, variant }])
      )
    )
  )
const details = (member, entryId) => ({
  spanishName: member?.variant.spanishName ?? member?.group.spanishName ?? '',
  category: member?.group.category ?? '',
  material: member ? variantMaterial(member.variant, entryId).value : '',
})

/** Suggestions belong to the reviewed candidate, never to a passive source read. */
export function enrichProductPreparationReview(review, state) {
  const result = structuredClone(review),
    selected = new Set((result.changes || []).map(entryKey)),
    records = new Map(
      (state.records || []).map((record) => [orderKey(record.snapshot), record])
    ),
    previous = new Map(
      (state.preparations || []).map((preparation) => [
        orderKey(preparation),
        members(preparation),
      ])
    ),
    suggest = createNameSuggester(state.preferences?.vocabulary),
    suggestMaterial = createMaterialSuggester(
      state.preferences?.materialVocabulary
    )
  result.plan.preparations = result.plan.preparations.map((preparation) => {
    const record = records.get(orderKey(preparation))
    if (!record) return preparation
    // Group names/categories are shared: a selected subset cannot refresh the
    // same persisted fields for its unselected siblings.
    const complete = preparation.groups.filter((group) =>
        group.variants.every((variant) =>
          variant.entryIds.every((entryId) =>
            selected.has(entryKey({ ...preparation, entryId }))
          )
        )
      ),
      named = new Map(
        refreshPreparationNames({ ...preparation, groups: complete }, suggest, {
          replaceAutomatic: false,
        }).groups.map((group) => [group.id, group])
      )
    const items = record.snapshot.items.filter((item) =>
      selected.has(entryKey({ ...preparation, entryId: item.entryId }))
    )
    return refreshPreparationMaterials(
      {
        ...preparation,
        groups: preparation.groups.map((group) => named.get(group.id) || group),
      },
      {
        ...record.snapshot,
        items,
      },
      new Map(items.map((item) => [item.entryId, suggestMaterial(item)]))
    )
  })
  const proposed = new Map(
    result.plan.preparations.map((preparation) => [
      orderKey(preparation),
      members(preparation),
    ])
  )
  result.changes = (result.changes || []).map((change) => {
    const member = proposed.get(orderKey(change))?.get(change.entryId)
    return {
      ...change,
      beforeDetails: details(
        previous.get(orderKey(change))?.get(change.entryId),
        change.entryId
      ),
      afterDetails: details(member, change.entryId),
      detailSources: {
        spanishName:
          member?.variant.spanishName !== undefined
            ? 'manual'
            : member?.group.naming?.spanishName?.source || 'automatic',
        category: member?.group.naming?.category?.source || 'automatic',
        material: member
          ? variantMaterial(member.variant, change.entryId).source
          : 'suggested',
      },
    }
  })
  return result
}

const identity = (member, entryId) =>
  member && {
    groupId: member.group.id,
    variantId: member.variant.id,
    baseCode: member.group.baseCode,
    variantSuffix: member.variant.variantSuffix,
    sizeSuffix: member.variant.sizeSuffix,
    needsSizeMapping: member.variant.needsSizeMapping,
    details: details(member, entryId),
    naming: member.group.naming,
    variantName: member.variant.spanishName,
    material: variantMaterial(member.variant, entryId),
  }

/** Enforce the selected-products boundary again inside the assignment transaction. */
export function assertProductPreparationSelection(plan, state) {
  const refs = plan.selection?.entryRefs
  // Keep the existing programmatic whole-order review contract.
  if (!refs?.length) return
  const selected = new Set(refs.map(entryKey)),
    proposed = new Map(
      plan.preparations.map((preparation) => [
        orderKey(preparation),
        preparation,
      ])
    ),
    previous = new Map(
      (state.preparations || []).map((preparation) => [
        orderKey(preparation),
        preparation,
      ])
    )
  for (const [key, preparation] of proposed) {
    const before = members(previous.get(key)),
      after = members(preparation)
    for (const entryId of new Set([...before.keys(), ...after.keys()])) {
      if (selected.has(entryKey({ ...preparation, entryId }))) continue
      if (
        JSON.stringify(identity(before.get(entryId), entryId)) !==
        JSON.stringify(identity(after.get(entryId), entryId))
      )
        throw new Error(
          'Preparation would change an unselected product. Go back and select every affected product.'
        )
    }
  }
  for (const ref of refs) {
    const member = members(proposed.get(orderKey(ref))).get(ref.entryId)
    if (!member || !member.group.baseCode || member.variant.needsSizeMapping)
      throw new Error('Review a resolved barcode for every selected product.')
    barcodeValue(member.group, member.variant)
  }
}
