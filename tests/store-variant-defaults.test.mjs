import test from 'node:test'
import assert from 'node:assert/strict'
import { suggestStoreVariantQuantities } from '../src/store-workbook-model.js'
import { validateStoreImportReview } from '../src/store-import-dialog.js'
import { createStoreOrder } from '../src/store-order.js'
import { validateBackup } from '../src/database.js'
import { databaseBrowser } from './fixtures/database-browser.mjs'
import {
  evenVariantSplitInput,
  EVEN_SPLIT_EXPECTED,
} from './fixtures/even-variant-split.mjs'

test('eight combined rows suggest 30 identities without changing 5,400 pieces, 18 cartons or 1,074,000 cents', async () => {
  const input = evenVariantSplitInput(),
    original = structuredClone(input),
    allocations = new Map(
      input.rows.map((row) => [
        String(row.row),
        suggestStoreVariantQuantities(row),
      ])
    ),
    review = validateStoreImportReview(
      { rows: input.rows, issues: [] },
      {
        purchaseDate: input.purchaseDate,
        storeName: input.store.name,
        photosReviewed: true,
        allocations,
      }
    )
  assert.equal(review.valid, true)
  assert.deepEqual(
    review.rows.map((row) =>
      row.variantAllocations.map((entry) => entry.quantity)
    ),
    EVEN_SPLIT_EXPECTED
  )
  const built = await createStoreOrder(
    { ...input, rows: review.rows },
    { now: '2026-10-21T12:00:00.000Z', orderId: '88881' }
  )
  assert.equal(built.snapshot.items.length, 30)
  assert.equal(
    built.snapshot.items.reduce((sum, item) => sum + Number(item.quantity), 0),
    5400
  )
  assert.equal(
    built.snapshot.items.reduce(
      (sum, item) => sum + Number(item.carton?.boxes || 0),
      0
    ),
    18
  )
  assert.equal(built.snapshot.totals.payable, '10740.00')
  assert.equal(built.snapshot.spreadsheet.rows.length, 8)
  assert.deepEqual(input, original)
  assert.deepEqual(
    validateBackup({
      format: '1688-order-library',
      version: 3,
      exportedAt: '2026-10-21T12:00:00.000Z',
      orders: [
        {
          snapshot: built.snapshot,
          revision: 1,
          changedAt: '2026-10-21T12:00:00.000Z',
          lastCheckedAt: '2026-10-21T12:00:00.000Z',
          notes: '',
          tags: [],
          changedEntryIds: [],
          removedEntryIds: [],
          unitsPerCarton: built.unitsPerCarton,
        },
      ],
      history: [],
      images: built.images,
      preparations: [],
      allocations: [],
      issuedCodes: [],
    }).orders[0].snapshot,
    built.snapshot
  )
})

test('defaults use parsed variant/size identities in declaration order and preserve explicit quantities by identity', () => {
  const variants = [
    { variant: 'B', size: 'S' },
    { variant: 'A', size: 'L' },
    { variant: 'C', size: 'M' },
  ]
  assert.deepEqual(suggestStoreVariantQuantities({ quantity: 8, variants }), [
    '3',
    '3',
    '2',
  ])
  assert.deepEqual(
    suggestStoreVariantQuantities({
      quantity: 20,
      variants: variants.slice(0, 2),
    }),
    ['10', '10']
  )
  assert.deepEqual(
    suggestStoreVariantQuantities({
      quantity: 20,
      variants: variants.slice(0, 2),
      variantAllocations: [
        { ...variants[1], quantity: 13 },
        { ...variants[0], quantity: 7 },
      ],
    }),
    ['7', '13']
  )
  assert.deepEqual(
    suggestStoreVariantQuantities({ quantity: 1, variants: [] }),
    []
  )
  assert.deepEqual(
    suggestStoreVariantQuantities({
      quantity: 7,
      variants: variants.slice(0, 1),
    }),
    []
  )
  assert.deepEqual(
    suggestStoreVariantQuantities({
      quantity: Number.MAX_SAFE_INTEGER,
      variants,
    }),
    ['3002399751580331', '3002399751580330', '3002399751580330']
  )
})

test('missing, fractional, unsafe and insufficient totals never invent pieces; explicit invalid allocations are not repaired', () => {
  const variants = [{ variant: 'A' }, { variant: 'B' }, { variant: 'C' }]
  for (const quantity of [
    undefined,
    '',
    0,
    -1,
    2,
    2.5,
    '1e2',
    '9007199254740993',
  ])
    assert.deepEqual(suggestStoreVariantQuantities({ quantity, variants }), [
      '',
      '',
      '',
    ])
  assert.deepEqual(
    suggestStoreVariantQuantities({
      quantity: 9,
      variants,
      variantAllocations: [],
    }),
    ['', '', '']
  )
  assert.deepEqual(
    suggestStoreVariantQuantities({
      quantity: 9,
      variants,
      variantAllocations: [{ variant: 'A', quantity: 0 }],
    }),
    ['0', '', '']
  )
  const row = { ...evenVariantSplitInput().rows[0], quantity: 2 },
    result = validateStoreImportReview(
      { rows: [row], issues: [] },
      {
        purchaseDate: '2026-10-20',
        storeName: 'Synthetic',
        photosReviewed: true,
        allocations: new Map(),
      }
    )
  assert.equal(result.valid, false)
  assert.match(result.issues[0].message, /positive whole-piece/)
  assert.equal(result.rows[0].variantAllocations, undefined)
})

test('draft suggestions never relax repository validation for missing allocations or fractional-cent contradictions', async () => {
  const input = evenVariantSplitInput()
  await assert.rejects(
    createStoreOrder(input),
    /variant quantities must add up/
  )
  const row = {
    ...input.rows[0],
    quantity: 2,
    boxes: 1,
    perbox: 2,
    price: '0.335',
    amount: '0.67',
    variants: [{ variant: 'A' }, { variant: 'B' }],
  }
  row.variantAllocations = row.variants.map((variant, index) => ({
    ...variant,
    quantity: Number(suggestStoreVariantQuantities(row)[index]),
  }))
  await assert.rejects(
    createStoreOrder({ ...input, rows: [row], total: '0.67' }),
    /fractional-cent rounding/
  )
})

test('confirmed even splits persist across native reopening and full backup restoration with one source carton set', async () => {
  const browser = await databaseBrowser()
  try {
    const input = evenVariantSplitInput()
    input.rows = input.rows.map((row) => ({
      ...row,
      variantAllocations: row.variants.map((variant, index) => ({
        ...variant,
        quantity: Number(suggestStoreVariantQuantities(row)[index]),
      })),
    }))
    const result = await browser.page.evaluate(async (input) => {
      const db = await modules.openDatabase({ name: 'even-splits' }),
        review = await db.reviewStoreOrderImport(input)
      await db.importStoreOrder({ ...review, intentId: 'even-split-native' })
      const before = await db.exportBackup({})
      db.close()
      const reopened = await modules.openDatabase({ name: 'even-splits' }),
        saved = await reopened.exportBackup({}),
        restored = await modules.openDatabase({ name: 'even-splits-restored' })
      await restored.restoreBackup(before)
      const after = await restored.exportBackup({})
      reopened.close()
      restored.close()
      return { before, saved, after }
    }, input)
    for (const value of [result.saved, result.after]) {
      assert.equal(value.orders.length, 1)
      assert.deepEqual(
        value.orders[0].snapshot.items.map((item) => item.quantity),
        EVEN_SPLIT_EXPECTED.flat().map(String)
      )
      assert.equal(value.orders[0].snapshot.totals.payable, '10740.00')
      assert.equal(
        value.cartonBatches.reduce((sum, batch) => sum + batch.count, 0),
        18
      )
      assert.deepEqual(value.preparations, result.before.preparations)
    }
  } finally {
    await browser.close()
  }
})
