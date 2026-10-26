import test from 'node:test'
import assert from 'node:assert/strict'
import { createPreparation, allocatePreparation } from '../src/packing-model.js'
import { planProductFamilies } from '../src/product-families.js'
import { planPurchaseCodeReview } from '../src/purchase-codes.js'

function source(orderId, colors = ['red', 'blue']) {
  return {
    accountId: 'local',
    orderId,
    sellerName: 'Synthetic supplier',
    sellerMemberLogin: 'synthetic-supplier',
    purchasedAt: '2026-10-05',
    observedAt: '2026-10-26T00:00:00Z',
    items: colors.map((color, index) => ({
      entryId: String(index + 1),
      productNumber: `MODEL22A-0${index + 1}`,
      title: 'Synthetic family',
      description: 'Synthetic family',
      quantity: '10',
      price: '2.00',
      discount: '0.00',
      skuProperties: [{ label: '颜色', value: color }],
    })),
  }
}
const choice = {
  kind: 'family',
  entryIds: ['1', '2'],
  mode: 'variants',
  identities: [
    { entryId: '1', style: 'red', size: '' },
    { entryId: '2', style: 'blue', size: '' },
  ],
}
function prepared(snapshot, choices = [choice]) {
  return allocatePreparation(
    createPreparation(snapshot, '2026-10', undefined, undefined, {
      familyChoices: choices,
    }),
    [],
    []
  ).preparation
}
function review(state, orderId, entryId) {
  return planPurchaseCodeReview(
    state,
    entryId
      ? { entryRefs: [{ accountId: 'local', orderId, entryId }] }
      : { orderRefs: [{ accountId: 'local', orderId }] }
  )
}

test('historical reviewed endings use their retained observation and skip unverifiable refreshed source', () => {
  const original = source('101'),
    prior = prepared(original),
    refreshed = source('101', ['green', 'yellow']),
    current = source('201'),
    input = { records: [{ snapshot: refreshed }], preparations: [prior] }
  const missing = planProductFamilies(current, input)
  assert.ok(
    missing.families.every((family) => family.provenance !== 'historical')
  )
  const retained = planProductFamilies(current, {
    ...input,
    history: [{ snapshot: original }],
  })
  assert.deepEqual(retained.issues, [])
  assert.equal(retained.families[0].provenance, 'historical')
  assert.deepEqual(
    retained.families[0].identities.map((identity) => identity.variantSuffix),
    ['A', 'B']
  )
  const changed = planProductFamilies(source('202', ['green', 'yellow']), {
    ...input,
    history: [{ snapshot: original }],
  })
  assert.ok(
    changed.families[0].identities.every(
      (identity) => identity.variantSuffix === undefined
    )
  )
})

test('description-derived history matches complete attributes and older portable keys cannot authorize reuse', () => {
  const descriptionSource = (orderId, colors) => {
    const snapshot = source(orderId, colors)
    for (const item of snapshot.items) {
      item.description = `${item.title}\n颜色:${item.skuProperties[0].value}`
      delete item.skuProperties
    }
    return snapshot
  }
  const original = descriptionSource('101', ['red', 'blue']),
    prior = prepared(original),
    current = descriptionSource('201', ['red', 'blue']),
    state = { records: [original], preparations: [prior] },
    matched = planProductFamilies(current, state)
  assert.deepEqual(matched.issues, [])
  assert.deepEqual(
    matched.families[0].identities.map((identity) => identity.variantSuffix),
    ['A', 'B']
  )
  const changed = planProductFamilies(
    descriptionSource('202', ['green', 'yellow']),
    state
  )
  assert.ok(
    changed.families[0].identities.every(
      (identity) => identity.variantSuffix === undefined
    )
  )
  assert.deepEqual(
    changed.families[0].identities.map((identity) => identity.style),
    ['green', 'yellow']
  )
  const legacy = structuredClone(prior),
    key = JSON.parse(legacy.productFamilies.sourceKey)
  key[3].forEach((row) => {
    row[3] = []
  })
  legacy.productFamilies.sourceKey = JSON.stringify(key)
  assert.ok(
    planProductFamilies(current, {
      records: [original],
      history: [original],
      preparations: [legacy],
    }).families.every((family) => family.provenance !== 'historical')
  )
})

test('historical reviewed identity equivalence retains a shared barcode and a fresh purchase base', () => {
  const original = source('101'),
    current = source('201'),
    identical = {
      ...choice,
      mode: 'none',
      identities: choice.identities.map((identity) => ({
        ...identity,
        style: 'same product',
      })),
    },
    prior = prepared(original, [identical]),
    result = review(
      {
        records: [original, current].map((snapshot) => ({ snapshot })),
        preparations: [prior],
      },
      '201'
    )
  assert.deepEqual(result.issues, [])
  const group = result.plan.preparations[0].groups[0]
  assert.deepEqual(
    group.variants.map((variant) => variant.entryIds),
    [['1', '2']]
  )
  assert.notEqual(group.baseCode, prior.groups[0].baseCode)
  assert.equal(
    group.variants[0].variantSuffix + group.variants[0].sizeSuffix,
    ''
  )
})

test('consistent complete and selected-only historical assignments share family context', () => {
  const original = source('101'),
    second = source('102'),
    current = source('201'),
    prior = prepared(original),
    records = [original, second, current].map((snapshot) => ({ snapshot })),
    selected = review({ records, preparations: [prior] }, '102', '1')
  assert.deepEqual(selected.issues, [])
  const partial = selected.plan.preparations[0]
  assert.deepEqual(
    partial.groups[0].variants.flatMap((variant) => variant.entryIds),
    ['1']
  )
  assert.deepEqual(partial.productFamilies.families[0].entryIds, ['1', '2'])
  const combined = review({ records, preparations: [prior, partial] }, '201')
  assert.deepEqual(combined.issues, [])
  assert.equal(combined.plan.preparations[0].groups.length, 1)
  assert.deepEqual(
    combined.plan.preparations[0].groups[0].variants.map(
      (variant) => variant.variantSuffix
    ),
    ['A', 'B']
  )
})

test('consistent partial legacy references merge but conflicting endings and group separation still require review', () => {
  const original = source('101'),
    second = source('102'),
    current = source('201'),
    prior = prepared(original, []),
    partial = structuredClone(prior),
    records = [original, second]
  partial.orderId = '102'
  partial.groups[0].variants = partial.groups[0].variants.slice(0, 1)
  assert.deepEqual(
    planProductFamilies(current, { records, preparations: [prior, partial] })
      .issues,
    []
  )
  const conflicting = structuredClone(partial)
  conflicting.groups[0].variants[0].variantSuffix = 'Z'
  assert.ok(
    planProductFamilies(current, {
      records,
      preparations: [prior, conflicting],
    }).issues.some((issue) => /disagree/.test(issue.message))
  )
  const separated = structuredClone(prior)
  separated.orderId = '102'
  separated.groups = separated.groups.flatMap((group) =>
    group.variants.map((variant) => ({
      ...group,
      id: variant.id,
      variants: [variant],
    }))
  )
  assert.ok(
    planProductFamilies(current, {
      records,
      preparations: [prior, separated],
    }).issues.some((issue) => /disagree/.test(issue.message))
  )
})

test('historical saved variants preserve reviewed physical sizes instead of replacing them with endings', () => {
  const original = source('101', ['55cm', '65cm']),
    current = source('201', ['55cm', '65cm']),
    prior = prepared(original, [
      {
        ...choice,
        mode: 'sizes',
        identities: [
          { entryId: '1', style: '', size: '55cm' },
          { entryId: '2', style: '', size: '65cm' },
        ],
      },
    ]),
    result = review(
      {
        records: [original, current].map((snapshot) => ({ snapshot })),
        preparations: [prior],
      },
      '201',
      '2'
    )
  assert.deepEqual(result.issues, [])
  const variant = result.plan.preparations[0].groups[0].variants[0]
  assert.equal(variant.size, '65cm')
  assert.equal(variant.sizeSuffix, 'L')
})
