import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertProductPreparationSelection,
  enrichProductPreparationReview,
} from '../src/product-preparation-review.js'

const ref = (entryId) => ({ accountId: 'local', orderId: '1001', entryId })
function fixture(ids = ['1', '2']) {
  const preparation = {
      accountId: 'local',
      orderId: '1001',
      groups: ids.map((entryId) => ({
        id: `group-${entryId}`,
        title: '合成玻璃罐',
        baseCode: `CE2610010${entryId}`,
        spanishName: '',
        category: '',
        variants: [
          {
            id: `variant-${entryId}`,
            entryIds: [entryId],
            variantSuffix: '',
            sizeSuffix: '',
            needsSizeMapping: false,
          },
        ],
      })),
    },
    record = {
      snapshot: {
        accountId: 'local',
        orderId: '1001',
        items: ids.map((entryId) => ({
          entryId,
          title: '合成玻璃罐',
          description: '玻璃罐',
          skuProperties: [{ label: '材质', value: '玻璃' }],
        })),
      },
    }
  return {
    preparation,
    record,
    state: {
      records: [record],
      preparations: [],
      preferences: {
        vocabulary: [
          { match: '玻璃罐', spanishName: 'FRASCO', category: '玻璃罐' },
        ],
      },
    },
    review: {
      plan: {
        preparations: [preparation],
        selection: { entryRefs: [ref('1')] },
      },
      changes: [ref('1')],
      issues: [],
    },
  }
}

test('review fills local product suggestions only for selected rows without changing source or reserving codes', () => {
  const { state, review } = fixture(),
    before = structuredClone({ state, review }),
    enriched = enrichProductPreparationReview(review, state),
    [selected, unselected] = enriched.plan.preparations[0].groups
  assert.equal(selected.spanishName, 'FRASCO')
  assert.equal(selected.category, '玻璃罐')
  assert.equal(selected.variants[0].material, '玻璃')
  assert.equal(selected.variants[0].materialSource, 'suggested')
  assert.deepEqual(unselected, before.review.plan.preparations[0].groups[1])
  assert.deepEqual(enriched.changes[0].beforeDetails, {
    spanishName: '',
    category: '',
    material: '',
  })
  assert.deepEqual(enriched.changes[0].afterDetails, {
    spanishName: 'FRASCO',
    category: '玻璃罐',
    material: '玻璃',
  })
  assert.deepEqual({ state, review }, before)
})

test('review retains manual text and deliberate blanks and reports persisted before details', () => {
  const { state, review, preparation } = fixture(['1']),
    group = preparation.groups[0]
  group.spanishName = 'MI NOMBRE'
  group.naming = {
    spanishName: { source: 'manual', value: 'MI NOMBRE' },
    category: { source: 'manual', value: '' },
  }
  group.variants[0].material = ''
  group.variants[0].materialSource = 'manual'
  state.preparations = [structuredClone(preparation)]
  const result = enrichProductPreparationReview(review, state)
  assert.deepEqual(result.plan.preparations, [preparation])
  assert.deepEqual(result.changes[0].beforeDetails, {
    spanishName: 'MI NOMBRE',
    category: '',
    material: '',
  })
  assert.deepEqual(
    result.changes[0].afterDetails,
    result.changes[0].beforeDetails
  )
  assert.deepEqual(result.changes[0].detailSources, {
    spanishName: 'manual',
    category: 'manual',
    material: 'manual',
  })
})

test('review uses the repository material vocabulary instead of another library module configuration', () => {
  const { state, review } = fixture(['1'])
  state.preferences.materialVocabulary = [
    {
      id: 'synthetic-composite',
      aliases: ['玻璃'],
      parent: '',
      zh: '合成复合材料',
      en: 'Synthetic composite',
      es: 'Compuesto sintético',
    },
  ]
  const custom = enrichProductPreparationReview(review, state)
  assert.equal(custom.changes[0].afterDetails.material, '合成复合材料')
  delete state.preferences.materialVocabulary
  assert.equal(
    enrichProductPreparationReview(review, state).changes[0].afterDetails
      .material,
    '玻璃'
  )
})

test('shared group suggestions cannot alter an unchecked sibling, including per-row material authorship', () => {
  const { state, review, preparation } = fixture(),
    group = preparation.groups[0],
    sibling = preparation.groups.pop().variants[0]
  group.variants.push(sibling)
  state.preparations = [structuredClone(preparation)]
  const result = enrichProductPreparationReview(review, state),
    after = result.plan.preparations[0].groups[0]
  assert.equal(after.spanishName, '')
  assert.equal(after.category, '')
  assert.equal(after.variants[0].material, '玻璃')
  assert.deepEqual(after.variants[1], sibling)
  assert.doesNotThrow(() =>
    assertProductPreparationSelection(result.plan, state)
  )
  after.category = '未经选择'
  assert.throws(
    () => assertProductPreparationSelection(result.plan, state),
    /unselected product/
  )
})

test('final selected boundary rejects new unchecked membership, recoding and unresolved selections', () => {
  const { state, review, preparation } = fixture()
  state.preparations = [structuredClone(preparation)]
  assert.doesNotThrow(() =>
    assertProductPreparationSelection(review.plan, state)
  )
  preparation.groups[1].variants[0].sizeSuffix = 'S'
  assert.throws(
    () => assertProductPreparationSelection(review.plan, state),
    /unselected product/
  )
  preparation.groups[1].variants[0].sizeSuffix = ''
  preparation.groups[0].variants[0].needsSizeMapping = true
  assert.throws(
    () => assertProductPreparationSelection(review.plan, state),
    /resolved barcode/
  )
  preparation.groups[0].variants[0].needsSizeMapping = false
  preparation.groups.push({
    ...structuredClone(preparation.groups[1]),
    id: 'foreign',
    variants: [
      {
        ...structuredClone(preparation.groups[1].variants[0]),
        id: 'foreign',
        entryIds: ['3'],
      },
    ],
  })
  assert.throws(
    () => assertProductPreparationSelection(review.plan, state),
    /unselected product/
  )
})

test('final selected boundary permits a selected sibling joining an existing identity while preserving the unchecked owner', () => {
  const { state, review, preparation } = fixture(['1'])
  state.preparations = [structuredClone(preparation)]
  review.plan.selection.entryRefs = [ref('2')]
  preparation.groups[0].variants[0].entryIds.push('2')
  assert.doesNotThrow(() =>
    assertProductPreparationSelection(review.plan, state)
  )
})
