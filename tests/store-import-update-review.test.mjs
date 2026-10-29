import test from 'node:test'
import assert from 'node:assert/strict'
import {
  storeUpdateRowsForFilter,
  storeUpdatePriceDifference,
  storeUpdatePhysicalFields,
  storeUpdateCartonChanges,
  storeUpdateReviewIssues,
  storeUpdateIssueContext,
} from '../src/store-import-update-review.js'

test('carton changes count stable identities, additions and retirements for each matched row', () => {
  const row = { before: { entryIds: ['1'] }, after: { entryIds: ['1'] } },
    review = {
      cartonBatchChanges: [
        {
          before: {
            count: 3,
            entitlementIndices: [2, 5, 8],
            contents: [{ entryId: '1' }],
          },
          after: {
            count: 2,
            entitlementIndices: [2, 5],
            contents: [{ entryId: '1' }],
          },
        },
        {
          before: { count: 1, contents: [{ entryId: '2' }] },
          after: {
            count: 3,
            entitlementIndices: [0, 6, 7],
            contents: [{ entryId: '2' }],
          },
        },
      ],
    }
  assert.deepEqual(storeUpdateCartonChanges(review, row), [
    { before: 3, after: 2, added: 0, retired: 1 },
  ])
  assert.deepEqual(storeUpdateCartonChanges(review), [
    { before: 3, after: 2, added: 0, retired: 1 },
    { before: 1, after: 3, added: 2, retired: 0 },
  ])
})

test('repeated blockers collapse without hiding other rows or batches, and resolve the source group', () => {
  const issue = {
      code: 'STORE_UPDATE_CARTON_CONFLICT',
      message: 'Review received cartons.',
      severity: 'error',
      incomingRow: 12,
      batchId: 'batch-a',
    },
    review = {
      issues: [
        issue,
        { ...issue },
        { ...issue, incomingRow: 13, batchId: 'batch-b' },
      ],
      rowChanges: [
        { incomingRow: 12, after: { group: '42', entryIds: ['1'] } },
        { incomingRow: 13, after: { group: '46', entryIds: ['2'] } },
      ],
      preparation: {
        groups: [
          { id: 'group-a', variants: [{ entryIds: ['1'] }] },
          { id: 'group-b', variants: [{ entryIds: ['2'] }] },
        ],
      },
    }
  const result = storeUpdateReviewIssues(review)
  assert.equal(result.length, 2)
  assert.deepEqual(
    result.map(({ sourceGroup, groupId }) => ({ sourceGroup, groupId })),
    [
      { sourceGroup: '42', groupId: 'group-a' },
      { sourceGroup: '46', groupId: 'group-b' },
    ]
  )
  assert.equal(issue.sourceGroup, undefined)
})

test('a blocked row removal retains its source context even when no batch replacement is allowed', () => {
  const review = {
    issues: [
      {
        code: 'STORE_UPDATE_CARTON_DECISIONS',
        message: 'Review receiving decisions.',
        batchId: 'removed',
        entryIds: ['2'],
        severity: 'error',
      },
    ],
    cartonBatchChanges: [],
    rowChanges: [
      {
        incomingRow: 12,
        previousRow: 4,
        after: { group: '1', entryIds: ['1'] },
      },
      {
        incomingRow: null,
        previousRow: 5,
        before: { group: '2', entryIds: ['2'] },
      },
    ],
  }
  const [issue] = storeUpdateReviewIssues(review)
  assert.equal(issue.sourceGroup, '2')
  assert.equal(issue.previousRow, 5)
  assert.equal(issue.incomingRow, null)
  assert.equal(
    String(storeUpdateIssueContext(issue)),
    ' · Group 2 · Saved row 5'
  )
})

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
