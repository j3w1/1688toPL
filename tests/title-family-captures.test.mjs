import test from 'node:test'
import assert from 'node:assert/strict'
import { planProductFamilies } from '../src/product-families.js'
import { barcodeValue, createPreparation } from '../src/packing-model.js'
import { titleFamilyCaptureCases } from './fixtures/title-family-captures.mjs'

for (const example of titleFamilyCaptureCases) {
  test(`automatic title-family acceptance: ${example.name}`, () => {
    const source = structuredClone(example.snapshot)
    const before = structuredClone(source)
    const familyPlan = planProductFamilies(source)
    assert.deepEqual(familyPlan.issues, [])
    assert.deepEqual(
      familyPlan.families.map(({ entryIds }) => entryIds.length),
      example.counts
    )
    const draft = createPreparation(source, '2026-10', undefined, undefined, {
      familyPlan,
    })
    assert.equal(draft.groups.length, example.counts.length)
    const byEntry = new Map()
    draft.groups.forEach((group, index) => {
      group.baseCode = `CE261001${String(index + 1).padStart(2, '0')}`
      for (const variant of group.variants) {
        assert.equal(variant.needsSizeMapping, false)
        const code = barcodeValue(group, variant)
        for (const entryId of variant.entryIds) {
          assert.equal(byEntry.has(entryId), false)
          byEntry.set(entryId, {
            code,
            ending: variant.variantSuffix + variant.sizeSuffix,
          })
        }
      }
    })
    assert.equal(byEntry.size, source.items.length)
    assert.equal(
      new Set([...byEntry.values()].map(({ code }) => code)).size,
      source.items.length,
      'The distinct synthetic source options must receive distinct full codes'
    )
    for (const item of source.items)
      assert.match(byEntry.get(item.entryId).code, /^CE261001\d{2}[A-Z0-9]*$/)
    if (example.endings)
      assert.deepEqual(
        source.items.map(({ entryId }) => byEntry.get(entryId).ending),
        example.endings
      )
    assert.deepEqual(source, before)
  })
}

test('synthetic capture shapes cover 65 source rows and 25 title families', () => {
  assert.deepEqual(
    titleFamilyCaptureCases.map(({ snapshot }) => snapshot.items.length),
    [11, 2, 4, 31, 17]
  )
  assert.equal(
    titleFamilyCaptureCases.reduce((sum, e) => sum + e.counts.length, 0),
    25
  )
})

test('family titles normalize Unicode and whitespace without deleting meaningful title words', () => {
  const source = structuredClone(titleFamilyCaptureCases[2].snapshot)
  source.items[0].title = 'Ｓｙｎｔｈｅｔｉｃ\u3000glass   vase'
  source.items[1].title = '\tSynthetic glass vase\n'
  source.items[2].title = 'Synthetic glass vase with handle'
  source.items[3].title = 'Synthetic glass vase with lid'
  const plan = planProductFamilies(source)
  assert.deepEqual(plan.issues, [])
  assert.deepEqual(
    plan.families.map(({ entryIds }) => entryIds),
    [['1', '2'], ['3'], ['4']]
  )
})

test('missing title evidence cannot silently join unrelated source rows into a blank family', () => {
  const source = structuredClone(titleFamilyCaptureCases[1].snapshot)
  for (const item of source.items) {
    delete item.title
    item.description = '颜色: 红色\n货号: DEMO'
  }
  const plan = planProductFamilies(source)
  assert.deepEqual(
    plan.families.map(({ entryIds }) => entryIds),
    [['1'], ['2']]
  )
  assert.deepEqual(
    plan.issues.map(({ code, entryIds }) => ({ code, entryIds })),
    [
      { code: 'PRODUCT_TITLE_REQUIRED', entryIds: ['1'] },
      { code: 'PRODUCT_TITLE_REQUIRED', entryIds: ['2'] },
    ]
  )
})
