import test from 'node:test'
import assert from 'node:assert/strict'
import { createPreparation, allocatePreparation } from '../src/packing-model.js'
import {
  planProductFamilies,
  productFamilySourceKey,
} from '../src/product-families.js'
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

test('new title families do not inherit prior custom endings or depend on retained historical titles', () => {
  const original = source('101'),
    prior = prepared(original),
    refreshed = source('101', ['green', 'yellow']),
    current = source('201')
  prior.groups[0].variants[0].variantSuffix = 'X'
  prior.groups[0].variants[1].variantSuffix = 'Y'
  const before = structuredClone(prior)
  const input = { records: [{ snapshot: refreshed }], preparations: [prior] }
  for (const state of [
    input,
    { ...input, history: [{ snapshot: original }] },
  ]) {
    const plan = planProductFamilies(current, state)
    assert.deepEqual(plan.issues, [])
    assert.equal(plan.families.length, 1)
    assert.equal(plan.families[0].provenance, 'title')
    assert.deepEqual(
      plan.families[0].identities.map(({ variantSuffix }) => variantSuffix),
      ['A', 'B']
    )
  }
  assert.deepEqual(prior, before)
})

test('description-only observations recover the title line and interpret their own attributes', () => {
  const descriptionSource = (orderId, colors) => {
    const snapshot = source(orderId, colors)
    for (const item of snapshot.items) {
      item.description = `${item.title}\n颜色:${item.skuProperties[0].value}`
      delete item.title
      delete item.skuProperties
    }
    return snapshot
  }
  const original = descriptionSource('101', ['red', 'blue']),
    prior = prepared(original),
    current = descriptionSource('201', ['green', 'yellow']),
    plan = planProductFamilies(current, {
      records: [original],
      history: [original],
      preparations: [prior],
    })
  assert.deepEqual(plan.issues, [])
  assert.equal(plan.families.length, 1)
  assert.deepEqual(
    plan.families[0].identities.map(({ style, variantSuffix }) => ({
      style,
      variantSuffix,
    })),
    [
      { style: 'green', variantSuffix: 'A' },
      { style: 'yellow', variantSuffix: 'B' },
    ]
  )
  const changed = structuredClone(current)
  changed.items[0].description += '\n款式: striped'
  assert.notEqual(
    productFamilySourceKey(changed),
    productFamilySourceKey(current)
  )
})

test('a prior shared identity cannot merge different titles in a new purchase or reuse its CE base', () => {
  const original = source('101'),
    current = source('201')
  const prior = prepared(original, [
    {
      ...choice,
      mode: 'none',
      identities: choice.identities.map((identity) => ({
        ...identity,
        style: 'same product',
      })),
    },
  ])
  current.items[1].title = 'Different synthetic listing'
  const before = structuredClone(prior)
  const result = review(
    {
      records: [original, current].map((snapshot) => ({ snapshot })),
      preparations: [prior],
    },
    '201'
  )
  assert.deepEqual(result.issues, [])
  const groups = result.plan.preparations[0].groups
  assert.equal(groups.length, 2)
  assert.equal(new Set(groups.map(({ baseCode }) => baseCode)).size, 2)
  for (const group of groups) {
    assert.notEqual(group.baseCode, prior.groups[0].baseCode)
    assert.equal(group.variants.length, 1)
    assert.equal(
      group.variants[0].variantSuffix + group.variants[0].sizeSuffix,
      ''
    )
  }
  assert.deepEqual(prior, before)
})

test('selected-only preparation retains title context and later siblings reuse the same saved base', () => {
  const current = source('201'),
    records = [{ snapshot: current }]
  const first = review({ records }, '201', '2')
  assert.deepEqual(first.issues, [])
  const partial = first.plan.preparations[0],
    assigned = partial.groups[0].variants[0]
  assert.deepEqual(assigned.entryIds, ['2'])
  assert.equal(assigned.variantSuffix, 'B')
  assert.deepEqual(partial.productFamilies.families[0].entryIds, ['1', '2'])
  const before = structuredClone(partial)
  const second = review({ records, preparations: [partial] }, '201', '1')
  assert.deepEqual(second.issues, [])
  const combined = second.plan.preparations[0]
  assert.equal(combined.groups.length, 1)
  assert.equal(combined.groups[0].id, partial.groups[0].id)
  assert.equal(combined.groups[0].baseCode, partial.groups[0].baseCode)
  const byEntry = new Map(
    combined.groups[0].variants.flatMap((variant) =>
      variant.entryIds.map((id) => [id, variant])
    )
  )
  assert.equal(byEntry.get('1').variantSuffix, 'A')
  assert.deepEqual(byEntry.get('2'), assigned)
  assert.deepEqual(partial, before)
})

test('conflicting other-purchase conventions do not block current title families', () => {
  const original = source('101'),
    current = source('201'),
    prior = prepared(original)
  const conflicting = structuredClone(prior)
  conflicting.orderId = '102'
  conflicting.groups[0].variants[0].variantSuffix = 'Z'
  const separated = structuredClone(prior)
  separated.orderId = '103'
  separated.groups = separated.groups.flatMap((group) =>
    group.variants.map((variant) => ({
      ...group,
      id: variant.id,
      variants: [variant],
    }))
  )
  const state = {
    records: [original, source('102'), source('103')],
    preparations: [prior, conflicting, separated],
  }
  const before = structuredClone(state)
  const plan = planProductFamilies(current, state)
  assert.deepEqual(plan.issues, [])
  assert.deepEqual(
    plan.families.map(({ entryIds }) => entryIds),
    [['1', '2']]
  )
  assert.deepEqual(
    plan.families[0].identities.map(({ variantSuffix }) => variantSuffix),
    ['A', 'B']
  )
  assert.deepEqual(state, before)
})

test('account and purchase scope family evidence; supplier changes do not borrow a saved base', () => {
  const original = source('101'),
    prior = prepared(original),
    current = source('201')
  const foreign = { ...source('101'), accountId: 'foreign' }
  assert.notEqual(
    productFamilySourceKey(foreign),
    productFamilySourceKey(original)
  )
  assert.notEqual(
    productFamilySourceKey(current),
    productFamilySourceKey(original)
  )
  const foreignPreparation = { ...structuredClone(prior), accountId: 'foreign' }
  const plan = planProductFamilies(current, {
    records: [foreign],
    preparations: [foreignPreparation],
  })
  assert.deepEqual(plan.issues, [])
  assert.equal(plan.families[0].provenance, 'title')
  current.sellerName = 'Other synthetic supplier'
  current.sellerMemberLogin = 'other-synthetic-supplier'
  const result = review(
    {
      records: [original, current].map((snapshot) => ({ snapshot })),
      preparations: [prior],
    },
    '201'
  )
  assert.deepEqual(result.issues, [])
  assert.notEqual(
    result.plan.preparations[0].groups[0].baseCode,
    prior.groups[0].baseCode
  )
})

test('current saved membership and custom endings remain authoritative after source titles diverge', () => {
  const original = source('101', ['55cm', '65cm']),
    prior = prepared(original, [
      {
        ...choice,
        mode: 'sizes',
        identities: [
          { entryId: '1', style: '', size: '55cm' },
          { entryId: '2', style: '', size: '65cm' },
        ],
      },
    ])
  prior.groups[0].variants[0].sizeSuffix = 'M'
  prior.groups[0].variants[1].sizeSuffix = 'XL'
  const refreshed = structuredClone(original)
  refreshed.items[1].title = 'Changed synthetic listing title'
  const before = structuredClone(prior)
  const plan = planProductFamilies(refreshed, { preparation: prior })
  assert.deepEqual(plan.issues, [])
  assert.equal(plan.families.length, 1)
  assert.equal(plan.families[0].provenance, 'existing')
  assert.deepEqual(plan.families[0].entryIds, ['1', '2'])
  assert.deepEqual(
    plan.families[0].identities.map(({ size, sizeSuffix }) => ({
      size,
      sizeSuffix,
    })),
    [
      { size: '55cm', sizeSuffix: 'M' },
      { size: '65cm', sizeSuffix: 'XL' },
    ]
  )
  assert.deepEqual(prior, before)
})
