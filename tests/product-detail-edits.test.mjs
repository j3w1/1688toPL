import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyProductDetails,
  productDetailsSummary,
} from '../src/product-detail-edits.js'

function preparation() {
  return {
    accountId: 'local',
    orderId: '1001',
    revision: 7,
    month: '2026-10',
    groups: [
      {
        id: 'first',
        baseCode: 'CE26100101',
        title: 'Source group one',
        spanishName: 'SUGGESTED',
        category: '建议',
        naming: {
          spanishName: { source: 'automatic', value: 'SUGGESTED' },
          category: { source: 'automatic', value: '建议' },
        },
        variants: [
          {
            id: 'a',
            entryIds: ['1', '2'],
            variantSuffix: 'A',
            sizeSuffix: '',
            material: 'Glass',
            materialSource: 'suggested',
            materialOverrides: { 2: { value: '', source: 'manual' } },
          },
          {
            id: 'b',
            entryIds: ['3'],
            variantSuffix: 'B',
            sizeSuffix: 'S',
            spanishName: '',
            material: 'Wood',
            materialSource: 'manual',
          },
        ],
      },
      {
        id: 'second',
        baseCode: 'CE26100102',
        title: 'Source group two',
        spanishName: 'LEGACY CUSTOM',
        category: '',
        naming: { category: { source: 'manual', value: '' } },
        variants: [
          {
            id: 'c',
            entryIds: ['4'],
            variantSuffix: '',
            sizeSuffix: '',
            material: '',
            materialSource: 'suggested',
          },
        ],
      },
    ],
  }
}

test('bulk product details replace suggestions while retaining legacy custom names, manual overrides and deliberate blanks', () => {
  const before = preparation(),
    snapshot = structuredClone(before)
  const result = applyProductDetails(before, {
    scope: { kind: 'order' },
    fields: {
      spanishName: ' platos nuevos ',
      category: '盘',
      material: 'Ceramic',
    },
  })
  assert.deepEqual(before, snapshot)
  const [first, second] = result.preparation.groups
  assert.equal(first.spanishName, 'PLATOS NUEVOS')
  assert.deepEqual(first.naming.spanishName, {
    source: 'manual',
    value: 'PLATOS NUEVOS',
  })
  assert.equal(first.category, '盘')
  assert.equal(first.variants[1].spanishName, '')
  assert.equal(first.variants[0].material, 'Ceramic')
  assert.deepEqual(first.variants[0].materialOverrides['2'], {
    value: '',
    source: 'manual',
  })
  assert.equal(first.variants[1].material, 'Wood')
  assert.equal(second.spanishName, 'LEGACY CUSTOM')
  assert.equal(second.category, '')
  assert.equal(second.variants[0].material, 'Ceramic')
  assert.equal(result.changedCount, 4)
  assert.equal(result.skippedCount, 5)
})

test('group replace-all authors only selected fields and clears that group’s Spanish exceptions while leaving other groups and codes intact', () => {
  const before = preparation()
  const result = applyProductDetails(before, {
    scope: { kind: 'group', groupId: 'first' },
    fields: { spanishName: 'Vasos', material: '' },
    replaceCustom: true,
  })
  const group = result.preparation.groups[0]
  assert.equal(group.spanishName, 'VASOS')
  assert.equal(Object.hasOwn(group.variants[1], 'spanishName'), false)
  assert.equal(group.category, '建议')
  assert.equal(group.variants[0].material, '')
  assert.equal(group.variants[0].materialSource, 'manual')
  assert.equal(group.variants[0].materialOverrides, undefined)
  assert.equal(group.variants[1].material, '')
  assert.deepEqual(result.preparation.groups[1], before.groups[1])
  assert.deepEqual(
    group.variants.map(({ id, entryIds, variantSuffix, sizeSuffix }) => ({
      id,
      entryIds,
      variantSuffix,
      sizeSuffix,
    })),
    before.groups[0].variants.map(
      ({ id, entryIds, variantSuffix, sizeSuffix }) => ({
        id,
        entryIds,
        variantSuffix,
        sizeSuffix,
      })
    )
  )
  assert.equal(result.preparation.revision, before.revision)
  assert.equal(result.preparation.groups[0].baseCode, before.groups[0].baseCode)
})

test('variant detail authoring updates one barcode identity and all separately accounted members without changing siblings', () => {
  const before = preparation()
  const result = applyProductDetails(before, {
    scope: { kind: 'variant', groupId: 'first', variantId: 'a' },
    fields: { spanishName: '', material: 'Ceramic' },
  })
  const variant = result.preparation.groups[0].variants[0]
  assert.equal(variant.spanishName, '')
  assert.equal(variant.material, 'Ceramic')
  assert.equal(variant.materialSource, 'manual')
  assert.equal(variant.materialOverrides, undefined)
  assert.deepEqual(variant.entryIds, ['1', '2'])
  assert.deepEqual(
    result.preparation.groups[0].variants[1],
    before.groups[0].variants[1]
  )
  assert.equal(result.preparation.groups[0].spanishName, 'SUGGESTED')
  assert.throws(
    () =>
      applyProductDetails(before, {
        scope: { kind: 'variant', groupId: 'first', variantId: 'a' },
        fields: { category: '盘' },
      }),
    /shared by the CE product group/
  )
})

test('effective summaries expose mixed values and source-row counts, and invalid scopes cannot fall back to a wider edit', () => {
  const before = preparation()
  const summary = productDetailsSummary(before, { scope: { kind: 'order' } })
  assert.equal(summary.groupCount, 2)
  assert.equal(summary.variantCount, 3)
  assert.equal(summary.rowCount, 4)
  assert.equal(summary.mixedMaterial, true)
  assert.equal(summary.mixedSpanishName, true)
  assert.equal(summary.mixedCategory, true)
  const subset = productDetailsSummary(before, {
    scope: { kind: 'variant', groupId: 'first', variantId: 'a' },
  })
  assert.equal(subset.rowCount, 2)
  assert.equal(subset.category, '建议')
  assert.throws(
    () =>
      applyProductDetails(before, {
        scope: { kind: 'group', groupId: 'gone' },
        fields: { material: 'Glass' },
      }),
    /no longer available/
  )
  assert.throws(
    () =>
      applyProductDetails(before, {
        scope: { kind: 'variant', groupId: 'first', variantId: 'gone' },
        fields: { material: 'Glass' },
      }),
    /no longer available/
  )
  assert.throws(
    () =>
      applyProductDetails(before, {
        scope: { kind: 'order' },
        fields: { baseCode: 'CE26100901' },
      }),
    /supported product details/
  )
  assert.deepEqual(
    applyProductDetails(before, { scope: { kind: 'order' }, fields: {} })
      .preparation,
    before
  )
})

test('an explicit blank group name remains authored across a later keep-custom operation', () => {
  const cleared = applyProductDetails(preparation(), {
    scope: { kind: 'group', groupId: 'first' },
    fields: { spanishName: '', category: '' },
    replaceCustom: true,
  }).preparation
  const later = applyProductDetails(cleared, {
    scope: { kind: 'order' },
    fields: { spanishName: 'Overwrite', category: '盘' },
  }).preparation
  assert.equal(later.groups[0].spanishName, '')
  assert.equal(later.groups[0].category, '')
  assert.deepEqual(later.groups[0].naming.spanishName, {
    source: 'manual',
    value: '',
  })
})
