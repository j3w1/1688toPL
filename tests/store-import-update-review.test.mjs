import test from 'node:test'
import assert from 'node:assert/strict'
import {
  storeUpdateRowsForFilter,
  storeUpdatePriceDifference,
  storeUpdatePhysicalFields,
} from '../src/store-import-update-review.js'

test('price deltas retain exact fractional cents and sign without binary rounding', () => {
  assert.equal(storeUpdatePriceDifference('1.10', '2.80'), '+1.70')
  assert.equal(storeUpdatePriceDifference('2.80', '1.10'), '-1.70')
  assert.equal(storeUpdatePriceDifference('0.000001', '0.000003'), '+0.000002')
  assert.equal(storeUpdatePriceDifference('0', '0.10'), '+0.10')
})

test('physical-only replacements expose confirmed measurements and individual exceptions separately from source values', () => {
  const row = { before: { entryIds: ['1'] } }
  const review = {
    cartonBatchChanges: [
      {
        before: {
          contents: [{ entryId: '1' }],
          count: 5,
          weight: '26.00',
          weightBasis: 'batch',
          suppliedCbm: '0.08',
          volumeBasis: 'batch',
          unitMeasurements: { 1: { weight: '27' } },
        },
        after: {
          count: 5,
          weight: '21.5',
          weightBasis: 'carton',
          suppliedCbm: '',
          volumeBasis: 'carton',
          unitMeasurements: {},
        },
      },
    ],
  }
  assert.deepEqual(storeUpdatePhysicalFields(review, row), [
    { field: 'Weight · kg', before: '26.00', after: '21.5' },
    { field: 'Volume · m³', before: '0.08', after: '' },
    { field: 'Weight basis', before: 'batch', after: 'carton' },
    { field: 'Volume basis', before: 'batch', after: 'carton' },
    { field: 'Individual-carton measurement overrides', before: 1, after: 0 },
  ])
})

test('spreadsheet comparison filters distinguish price changes from quantity changes and never alter the full replacement', () => {
  const rows = [
    { status: 'changed', priceStatus: 'unchanged', incomingRow: 2 },
    { status: 'changed', priceStatus: 'increased', incomingRow: 3 },
    { status: 'changed', priceStatus: 'decreased', incomingRow: 4 },
    { status: 'added', priceStatus: 'new', incomingRow: 5 },
    { status: 'removed', priceStatus: 'removed', previousRow: 7 },
    { status: 'unresolved', priceStatus: 'unchanged', incomingRow: 8 },
    { status: 'unchanged', priceStatus: 'unchanged', incomingRow: 9 },
  ]
  const before = structuredClone(rows)
  assert.deepEqual(
    storeUpdateRowsForFilter(rows, 'prices').map((row) => row.incomingRow),
    [3, 4]
  )
  assert.equal(storeUpdateRowsForFilter(rows, 'added').length, 1)
  assert.equal(storeUpdateRowsForFilter(rows, 'removed').length, 1)
  assert.equal(storeUpdateRowsForFilter(rows, 'changes').length, 6)
  assert.equal(storeUpdateRowsForFilter(rows, 'all'), rows)
  assert.deepEqual(rows, before)
})
