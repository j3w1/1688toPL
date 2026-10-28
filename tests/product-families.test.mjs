import test from 'node:test'
import assert from 'node:assert/strict'
import {
  planProductFamilies,
  productFamilySourceKey,
  validateProductFamilies,
} from '../src/product-families.js'

function snapshot(articles = ['7128F-02', '7128K-01', '7128K-02']) {
  return {
    accountId: 'local',
    orderId: '101',
    observedAt: '2026-10-26T00:00:00Z',
    items: articles.map((productNumber, index) => ({
      entryId: String(index + 1),
      title: 'Synthetic generic decorative listing',
      description: 'Synthetic source description',
      productNumber,
      quantity: '10',
      price: '2.00',
      skuProperties: [{ label: '尺寸', value: '如图所示' }],
    })),
  }
}
const choice = (entryIds, kind = 'family') => ({
  accountId: 'local',
  orderId: '101',
  entryIds,
  kind,
})

test('source title groups the horse and elephant articles into one new family', () => {
  const source = snapshot(),
    before = structuredClone(source),
    plan = planProductFamilies(source)
  assert.deepEqual(plan.issues, [])
  assert.deepEqual(
    plan.families.map(({ entryIds, kind }) => ({ entryIds, kind })),
    [{ entryIds: ['1', '2', '3'], kind: 'family' }]
  )
  assert.equal(plan.families[0].provenance, 'title')
  assert.deepEqual(
    plan.families[0].identities.map((i) => i.variantSuffix),
    ['A', 'B', 'C']
  )
  assert.equal(plan.evidence.version, 2)
  assert.deepEqual(source, before)
})

test('numeric and unrelated model articles are options within a title, not family keys', () => {
  for (const articles of [
    ['100-01', '100-02'],
    ['SKU-01', 'SKU-02'],
    ['A123-01', 'A123-02'],
    ['7128F-02', '7128K-01'],
  ]) {
    const plan = planProductFamilies(snapshot(articles))
    assert.deepEqual(
      plan.families.map((f) => f.entryIds),
      [['1', '2']]
    )
    assert.deepEqual(plan.issues, [])
  }
})

test('exact repeated articles or explicit model attributes supply family evidence without an invented offer ID', () => {
  const repeated = planProductFamilies(snapshot(['7128K-01', '7128K-01']))
  assert.deepEqual(
    repeated.families.map((family) => family.entryIds),
    [['1', '2']]
  )
  const source = snapshot(['', ''])
  source.items.forEach((item, index) =>
    item.skuProperties.push({ label: '型号', value: `7128K-0${index + 1}` })
  )
  assert.deepEqual(
    planProductFamilies(source).families.map((family) => family.entryIds),
    [['1', '2']]
  )
})

test('title cohorts are automatic while portable explicit membership remains readable', () => {
  const source = snapshot(['', '']),
    unresolved = planProductFamilies(source)
  assert.deepEqual(
    unresolved.families.map((family) => family.entryIds),
    [['1', '2']]
  )
  assert.deepEqual(unresolved.issues, [])
  const joined = planProductFamilies(source, { choices: [choice(['1', '2'])] }),
    separate = planProductFamilies(source, {
      choices: [choice(['1', '2'], 'standalone')],
    })
  assert.deepEqual(joined.issues, [])
  assert.deepEqual(
    joined.families.map((family) => family.entryIds),
    [['1', '2']]
  )
  assert.deepEqual(separate.issues, [])
  assert.deepEqual(
    separate.families.map((family) => family.entryIds),
    [['1'], ['2']]
  )
  assert.equal(joined.evidence.sourceKey, productFamilySourceKey(source))
})

test('reviewed membership is reused only for exact source evidence while unrelated presentation and financial changes do not expire it', () => {
  const source = snapshot(['', '']),
    reviewed = planProductFamilies(source, { choices: [choice(['1', '2'])] }),
    preparation = { groups: [], productFamilies: reviewed.evidence },
    changedPresentation = structuredClone(source)
  changedPresentation.observedAt = '2026-10-27T00:00:00Z'
  changedPresentation.items[0].thumbnail = 'synthetic-photo'
  changedPresentation.items[0].price = '9.25'
  assert.equal(productFamilySourceKey(changedPresentation), reviewed.sourceKey)
  assert.deepEqual(
    planProductFamilies(changedPresentation, { preparation }).issues,
    []
  )
  const changedIdentity = structuredClone(source)
  changedIdentity.items[0].skuProperties.push({
    label: '款式',
    value: 'Different source style',
  })
  assert.notEqual(productFamilySourceKey(changedIdentity), reviewed.sourceKey)
  assert.deepEqual(
    planProductFamilies(changedIdentity, { preparation }).issues,
    []
  )
  assert.deepEqual(
    planProductFamilies(changedIdentity, {
      preparation,
    }).families[0].identities.map((i) => i.variantSuffix),
    ['A', 'B']
  )
})

test('existing prepared membership wins over reviewed source separation and prevents automatic recoding', () => {
  const source = snapshot(['7128K-01', '7128K-02']),
    preparation = {
      groups: [{ id: 'existing', variants: [{ entryIds: ['1', '2'] }] }],
    },
    plan = planProductFamilies(source, {
      preparation,
      choices: [choice(['1', '2'], 'standalone')],
    })
  assert.deepEqual(
    plan.families.map((family) => family.entryIds),
    [['1', '2']]
  )
  assert.equal(plan.families[0].provenance, 'existing')
})

test('review choices are account/order scoped and reject unknown or overlapping source membership', () => {
  const source = snapshot(['', ''])
  for (const patch of [{ accountId: 'foreign' }, { orderId: '102' }])
    assert.deepEqual(
      planProductFamilies(source, {
        choices: [{ ...choice(['1', '2'], 'standalone'), ...patch }],
      }).families.map((f) => f.entryIds),
      [['1', '2']]
    )
  assert.throws(
    () => planProductFamilies(source, { choices: [choice(['1', '9'])] }),
    /missing source/
  )
  assert.throws(
    () =>
      planProductFamilies(source, {
        choices: [choice(['1', '2']), choice(['2'], 'standalone')],
      }),
    /source identities/
  )
})

test('portable reviewed evidence rejects malformed versions, kinds and source identities', () => {
  const sourceKey = productFamilySourceKey(snapshot())
  for (const input of [
    { version: 3, sourceKey, families: [choice(['1', '2'])] },
    { version: 1, sourceKey: '', families: [choice(['1', '2'])] },
    { version: 1, sourceKey, families: [{ entryIds: ['1'], kind: 'family' }] },
    {
      version: 1,
      sourceKey,
      families: [{ entryIds: ['1', '1'], kind: 'family' }],
    },
    {
      version: 1,
      sourceKey,
      families: [{ entryIds: ['invalid'], kind: 'standalone' }],
    },
  ])
    assert.throws(() => validateProductFamilies(input), /product famil/)
})
