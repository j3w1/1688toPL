import { setVariantMaterial, variantMaterial } from './packing-model.js'

const fields = new Set(['spanishName', 'category', 'material'])
const manualName = (group, field) => {
  const provenance = group.naming?.[field]
  return provenance
    ? provenance.source === 'manual' || provenance.value !== group[field]
    : Boolean(group[field])
}

function targets(preparation, scope) {
  if (
    !preparation?.groups ||
    !['order', 'group', 'variant'].includes(scope?.kind)
  )
    throw new Error('Choose an order, group or variant to edit.')
  const groups =
    scope.kind === 'order'
      ? preparation.groups
      : preparation.groups.filter((group) => group.id === scope.groupId)
  if (!groups.length)
    throw new Error('This product group is no longer available.')
  const selected = groups.map((group) => ({
    group,
    variants:
      scope.kind === 'variant'
        ? group.variants.filter((variant) => variant.id === scope.variantId)
        : group.variants,
  }))
  if (scope.kind === 'variant' && !selected[0].variants.length)
    throw new Error('This variant is no longer available.')
  return selected
}

const common = (values) => {
  const unique = [...new Set(values)]
  return {
    value: unique.length === 1 ? unique[0] : '',
    mixed: unique.length > 1,
  }
}

/** Read-only effective values. No order/group material default is persisted. */
export function productDetailsSummary(
  preparation,
  { scope = { kind: 'order' } } = {}
) {
  const selected = targets(preparation, scope),
    variants = selected.flatMap(({ variants }) => variants),
    names = selected.flatMap(({ group, variants }) =>
      variants.map((variant) => variant.spanishName ?? group.spanishName ?? '')
    ),
    categories = selected.map(({ group }) => group.category || ''),
    materials = variants.flatMap((variant) =>
      variant.entryIds.map((id) => variantMaterial(variant, id))
    ),
    spanishName = common(names),
    category = common(categories),
    material = common(materials.map((entry) => entry.value))
  return {
    groupCount: selected.length,
    variantCount: variants.length,
    rowCount: variants.reduce(
      (sum, variant) => sum + variant.entryIds.length,
      0
    ),
    spanishName: spanishName.value,
    category: category.value,
    material: material.value,
    mixedSpanishName: spanishName.mixed,
    mixedCategory: category.mixed,
    mixedMaterial: material.mixed,
    customCount:
      selected.reduce(
        (sum, { group, variants }) =>
          sum +
          Number(manualName(group, 'spanishName')) +
          Number(manualName(group, 'category')) +
          variants.filter((variant) => variant.spanishName !== undefined)
            .length,
        0
      ) + materials.filter((entry) => entry.source === 'manual').length,
  }
}

/** Author only selected fields in one preparation draft; persistence stays with the caller. */
export function applyProductDetails(
  preparation,
  { scope, fields: changes, replaceCustom = false }
) {
  if (
    !changes ||
    typeof changes !== 'object' ||
    Array.isArray(changes) ||
    Object.keys(changes).some((key) => !fields.has(key))
  )
    throw new Error('Choose supported product details to apply.')
  if (scope?.kind === 'variant' && Object.hasOwn(changes, 'category'))
    throw new Error('Chinese category is shared by the CE product group.')
  const values = Object.fromEntries(
      Object.entries(changes).map(([field, value]) => {
        if (typeof value !== 'string')
          throw new Error('Product details must be text.')
        return [
          field,
          field === 'spanishName' ? value.trim().toUpperCase() : value.trim(),
        ]
      })
    ),
    result = structuredClone(preparation),
    selected = targets(result, scope)
  let changedCount = 0,
    skippedCount = 0
  const alter = (before, apply, after) => {
    apply()
    if (JSON.stringify(before) !== JSON.stringify(after())) changedCount++
  }
  for (const { group, variants } of selected) {
    for (const field of ['spanishName', 'category']) {
      if (!Object.hasOwn(values, field)) continue
      if (scope.kind === 'variant') {
        const variant = variants[0]
        alter(
          variant.spanishName,
          () => {
            variant.spanishName = values[field]
          },
          () => variant.spanishName
        )
        continue
      }
      if (!replaceCustom && manualName(group, field)) skippedCount++
      else
        alter(
          { value: group[field], provenance: group.naming?.[field] },
          () => {
            group[field] = values[field]
            group.naming = {
              ...group.naming,
              [field]: { source: 'manual', value: values[field] },
            }
          },
          () => ({ value: group[field], provenance: group.naming[field] })
        )
      if (field === 'spanishName')
        for (const variant of variants) {
          if (variant.spanishName === undefined) continue
          if (replaceCustom) {
            delete variant.spanishName
            changedCount++
          } else skippedCount++
        }
    }
    if (Object.hasOwn(values, 'material'))
      for (const variant of variants) {
        const ids = []
        for (const id of variant.entryIds) {
          const before = variantMaterial(variant, id)
          if (
            scope.kind !== 'variant' &&
            !replaceCustom &&
            before.source === 'manual'
          )
            skippedCount++
          else {
            ids.push(id)
            if (before.value !== values.material || before.source !== 'manual')
              changedCount++
          }
        }
        if (ids.length) setVariantMaterial(variant, values.material, ids)
      }
  }
  return { preparation: result, changedCount, skippedCount }
}
