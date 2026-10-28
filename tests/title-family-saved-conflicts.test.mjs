import test from 'node:test'
import assert from 'node:assert/strict'
import { allocatePreparation, createPreparation } from '../src/packing-model.js'
import { planPurchaseCodeReview } from '../src/purchase-codes.js'

function item(entryId, productNumber, size) {
  return {
    entryId,
    title: 'Synthetic same-title product',
    description: 'Synthetic same-title product',
    productNumber,
    quantity: '1',
    price: '2.00',
    discount: '0.00',
    skuProperties: [
      { label: 'color', value: 'red' },
      ...(size ? [{ label: 'size', value: size }] : []),
    ],
  }
}
function source(items) {
  return {
    accountId: 'local',
    orderId: '101',
    sellerName: 'Synthetic supplier',
    sellerMemberLogin: 'synthetic-supplier',
    purchasedAt: '2026-10-01',
    observedAt: '2026-10-01T01:00:00.000Z',
    items,
  }
}
function prepare(snapshot) {
  return allocatePreparation(createPreparation(snapshot, '2026-10'), [], [])
    .preparation
}
function review(snapshot, preparation, entryId) {
  return planPurchaseCodeReview(
    { records: [{ snapshot }], preparations: [preparation] },
    { entryRefs: [{ accountId: 'local', orderId: '101', entryId }] }
  )
}
function assertRetainedAssignments(source, preparation) {
  const result = review(source, preparation, '1')
  assert.deepEqual(result.issues, [])
  assert.equal(result.changes[0].before, result.changes[0].after)
  assert.deepEqual(result.plan.preparations[0].groups, preparation.groups)
}

test('a refreshed repeated option cannot arbitrarily inherit the last of two saved barcode mappings', () => {
  const original = source([item('1', 'MODEL01'), item('2', 'MODEL02')]),
    preparation = prepare(original),
    refreshed = {
      ...original,
      observedAt: '2026-10-29T00:00:00.000Z',
      items: [item('1', 'MODEL'), item('2', 'MODEL'), item('3', 'MODEL')],
    },
    before = structuredClone(preparation),
    result = review(refreshed, preparation, '3')
  assert.deepEqual(
    preparation.groups[0].variants.map(({ variantSuffix }) => variantSuffix),
    ['A', 'B']
  )
  assert.ok(
    result.issues.some(({ code }) => code === 'PURCHASE_GROUP_REVIEW_REQUIRED')
  )
  assert.equal(
    result.changes.some(({ entryId }) => entryId === '3'),
    false
  )
  assertRetainedAssignments(refreshed, preparation)
  assert.deepEqual(preparation, before)
})

test('a new size cannot arbitrarily choose between conflicting saved style letters', () => {
  const original = source([item('1', 'MODEL', 'S'), item('2', 'MODEL', 'L')]),
    preparation = prepare(original)
  preparation.groups[0].variants[0].variantSuffix = 'A'
  preparation.groups[0].variants[1].variantSuffix = 'B'
  const refreshed = {
      ...original,
      observedAt: '2026-10-29T00:00:00.000Z',
      items: [...original.items, item('3', 'MODEL', 'M')],
    },
    before = structuredClone(preparation),
    result = review(refreshed, preparation, '3')
  assert.deepEqual(
    preparation.groups[0].variants.map(
      ({ variantSuffix, sizeSuffix }) => variantSuffix + sizeSuffix
    ),
    ['AS', 'BL']
  )
  assert.ok(
    result.issues.some(({ code }) => code === 'PURCHASE_GROUP_REVIEW_REQUIRED')
  )
  assert.equal(
    result.changes.some(({ entryId }) => entryId === '3'),
    false
  )
  assertRetainedAssignments(refreshed, preparation)
  assert.deepEqual(preparation, before)
})
