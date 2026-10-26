import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mergePackingPreparation,
  selectPackingPreparation,
} from '../src/packing-backup.js'
import {
  createPreparation,
  allocatePreparation,
  validatePreparation,
} from '../src/packing-model.js'

test('version 2 decisions keep unchecked context through scoped restore and reject conflicting modes/identities', () => {
  const snapshot = {
    accountId: 'local',
    orderId: '101',
    sellerName: 'synthetic supplier',
    items: [
      {
        entryId: '1',
        title: 'Synthetic hat',
        description: 'Synthetic hat',
        productNumber: 'HAT01401',
        skuProperties: [{ label: '颜色', value: '红色短款' }],
      },
      {
        entryId: '2',
        title: 'Synthetic hat',
        description: 'Synthetic hat',
        productNumber: 'HAT01402',
        skuProperties: [{ label: '颜色', value: '粉色长款' }],
      },
    ],
  }
  const original = allocatePreparation(
    createPreparation(snapshot, '2026-10', undefined, undefined, {
      familyChoices: [
        {
          kind: 'family',
          entryIds: ['1', '2'],
          mode: 'variants-and-sizes',
          identities: [
            { entryId: '1', style: 'red', size: 'S' },
            { entryId: '2', style: 'pink', size: 'L' },
          ],
        },
      ],
    }),
    [],
    []
  ).preparation
  original.revision = 1
  const first = selectPackingPreparation(original, ['1']),
    second = selectPackingPreparation(original, ['2'])
  assert.deepEqual(first.productFamilies, original.productFamilies)
  const merged = mergePackingPreparation(first, second, ['2'])
  assert.deepEqual(
    validatePreparation(merged).productFamilies,
    original.productFamilies
  )
  assert.deepEqual(
    mergePackingPreparation(merged, second, ['2']).productFamilies,
    original.productFamilies
  )
  for (const change of [
    (family) => {
      family.mode = 'variants'
    },
    (family) => {
      family.identities[0].style = 'different'
    },
  ]) {
    const incoming = structuredClone(second)
    change(incoming.productFamilies.families[0])
    assert.throws(
      () => mergePackingPreparation(first, incoming, ['2']),
      /families disagree/
    )
  }
})
