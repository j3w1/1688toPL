import test from 'node:test'
import assert from 'node:assert/strict'
import { createStoreOrder } from '../src/store-order.js'
import { reviewStoreImportCodes } from '../src/store-import-codes.js'
import {
  allocatePreparation,
  barcodeValue,
  setGroupSizeMode,
} from '../src/packing-model.js'
import { consumptionLocksForManifest } from '../src/purchase-codes.js'
import { databaseBrowser } from './fixtures/database-browser.mjs'
import { SYNTHETIC_PHOTO } from './fixtures/container-fixture.mjs'

function input(overrides = {}) {
  return {
    filename: '1234.xlsx',
    sheetName: 'Products',
    purchaseDate: '2026-10-01',
    store: {
      key: 'market:1234',
      name: 'Synthetic market',
      number: '1234',
      kind: 'market',
    },
    total: '60.00',
    rows: [
      { group: '1', variants: [{ variant: 'A', size: 'S' }] },
      { group: '2' },
      { group: '1', variants: [{ variant: 'B', size: 'M' }] },
    ].map((row, index) => ({
      row: index + 3,
      title: 'Synthetic cup',
      description: 'Synthetic cup',
      quantity: 10,
      boxes: 1,
      perbox: 10,
      price: '2.00',
      amount: '20.00',
      photos: [SYNTHETIC_PHOTO],
      ...row,
    })),
    ...overrides,
  }
}
const empty = () => ({
  records: [],
  preparations: [],
  allocations: [],
  issuedCodes: [],
  batches: [],
  locks: [],
})
const candidate = (orderId = '1001', overrides) =>
  createStoreOrder(input(overrides), { orderId })
const codes = (preparation) =>
  preparation.groups.flatMap((group) =>
    group.variants.map((variant) => barcodeValue(group, variant))
  )

test('read-only store code suggestions follow original month and authoritative source groups, keeping identities through revalidation and reset', async () => {
  const source = await candidate(),
    state = empty(),
    before = structuredClone({ source, state })
  const initial = reviewStoreImportCodes(state, { candidate: source })
  assert.deepEqual(initial.issues, [])
  assert.equal(initial.preparation.groups.length, 2)
  assert.deepEqual(
    initial.preparation.groups[0].variants.flatMap(
      (variant) => variant.entryIds
    ),
    ['1', '3']
  )
  assert.deepEqual(codes(initial.preparation), [
    'CE26100101AS',
    'CE26100101BM',
    'CE26100102',
  ])
  const edited = structuredClone(initial.preparation)
  edited.groups[0].baseCode = 'CE26100143'
  edited.groups[0].variants[0].variantSuffix = 'C'
  edited.groups[0].variants[0].sizeSuffix = 'XS'
  const validated = reviewStoreImportCodes(state, {
    candidate: source,
    preparation: edited,
  })
  assert.deepEqual(validated.issues, [])
  assert.strictEqual(validated.candidate, source)
  assert.strictEqual(validated.preparation, edited)
  assert.equal(codes(validated.preparation)[0], 'CE26100143CXS')
  const reset = reviewStoreImportCodes(state, {
    candidate: source,
    preparation: edited,
    resetCodes: true,
  })
  assert.deepEqual(
    reset.preparation.groups.map((group) => [
      group.id,
      group.variants.map((variant) => variant.id),
    ]),
    edited.groups.map((group) => [
      group.id,
      group.variants.map((variant) => variant.id),
    ])
  )
  assert.deepEqual(codes(reset.preparation), codes(initial.preparation))
  assert.deepEqual({ source, state }, before)
})

test('all edited group and variant conflicts block while retaining raw values and owner evidence', async () => {
  const source = await candidate(),
    state = empty()
  const { preparation } = reviewStoreImportCodes(state, { candidate: source })
  preparation.groups[1].baseCode = preparation.groups[0].baseCode
  preparation.groups[0].variants[1].variantSuffix = 'A'
  preparation.groups[0].variants[1].sizeSuffix = 'S'
  const result = reviewStoreImportCodes(state, {
    candidate: source,
    preparation,
  })
  assert.strictEqual(result.preparation, preparation)
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === 'PACKING_CODE_CONFLICT' && issue.field === 'baseCode'
    )
  )
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === 'PACKING_CODE_CONFLICT' &&
        issue.field === 'variantSuffix' &&
        issue.variantId === preparation.groups[0].variants[1].id
    )
  )
  assert.ok(
    result.issues
      .filter((issue) => issue.conflict)
      .every(
        (issue) =>
          issue.conflict.owner.groupId && issue.conflict.requestedOwner.groupId
      )
  )
})

test('bad base months and suffix-field mistakes produce inline errors without changing the draft', async () => {
  const source = await candidate(),
    state = empty()
  const { preparation } = reviewStoreImportCodes(state, { candidate: source })
  preparation.groups[0].baseCode = 'CE26090101'
  preparation.groups[0].variants[0].variantSuffix = 'XL'
  preparation.groups[0].variants[1].sizeSuffix = 'B'
  const before = structuredClone(preparation)
  const result = reviewStoreImportCodes(state, {
    candidate: source,
    preparation,
  })
  assert.deepEqual(
    new Set(result.issues.map((issue) => issue.field)),
    new Set(['baseCode', 'variantSuffix', 'sizeSuffix'])
  )
  assert.deepEqual(preparation, before)
  preparation.groups[1].baseCode = ''
  assert.ok(
    reviewStoreImportCodes(state, {
      candidate: source,
      preparation,
    }).issues.some(
      (issue) =>
        issue.groupId === preparation.groups[1].id && issue.field === 'baseCode'
    )
  )
})

test('review rejects removed, regrouped, forged-source and shared-product memberships', async () => {
  const source = await candidate(),
    state = empty()
  const { preparation } = reviewStoreImportCodes(state, { candidate: source })
  for (const mutate of [
    (draft) => {
      draft.groups.pop()
    },
    (draft) => {
      draft.groups[0].variants[0].entryIds = ['999']
    },
    (draft) => {
      draft.groups[0].variants[0].size = ''
    },
    (draft) => {
      draft.orderId = '999'
    },
    (draft) => {
      draft.sellerId = 'other-store'
    },
    (draft) => {
      draft.month = '2026-09'
    },
    (draft) => {
      draft.revision = 1
    },
    (draft) => {
      draft.groups[0].id = ` ${draft.groups[0].id} `
    },
    (draft) => {
      draft.groups[0].variants[0].id = ` ${draft.groups[0].variants[0].id} `
    },
    (draft) => {
      draft.groups[0].sharedProductId = 'forged'
      draft.groups[0].sharedStoreId = 'forged'
      for (const variant of draft.groups[0].variants)
        variant.sharedVariantId = variant.id
    },
  ]) {
    const draft = structuredClone(preparation)
    mutate(draft)
    assert.ok(
      reviewStoreImportCodes(state, {
        candidate: source,
        preparation: draft,
      }).issues.some((issue) => issue.severity === 'error')
    )
  }
})

test('whitespace and malformed code values stay editable and cannot escape inline validation', async () => {
  const source = await candidate(),
    state = empty()
  const { preparation } = reviewStoreImportCodes(state, { candidate: source })
  for (const [field, value] of [
    ['baseCode', ' CE26100101 '],
    ['variantSuffix', ' A '],
    ['sizeSuffix', ' S '],
    ['variantSuffix', null],
    ['sizeSuffix', 123],
  ]) {
    const draft = structuredClone(preparation),
      group = draft.groups[0]
    ;(field === 'baseCode' ? group : group.variants[0])[field] = value
    const result = reviewStoreImportCodes(state, {
      candidate: source,
      preparation: draft,
    })
    assert.strictEqual(result.preparation, draft)
    assert.ok(result.issues.some((issue) => issue.severity === 'error'))
    assert.ok(result.issues.some((issue) => issue.field === field))
  }
})

test('unresolved source sizes block even with a forged resolved flag, while explicit no-size and mapped endings are accepted', async () => {
  const raw = input()
  raw.rows = ['10-20cm', '20-30cm'].map((size, index) => ({
    ...raw.rows[1],
    row: index + 3,
    group: '1',
    skuProperties: [{ label: 'Size', value: size }],
  }))
  raw.total = '40.00'
  const source = await createStoreOrder(raw, { orderId: '1001' }),
    state = empty()
  const initial = reviewStoreImportCodes(state, { candidate: source })
  assert.ok(
    initial.issues.some(
      (issue) =>
        issue.code === 'PURCHASE_SIZE_REQUIRED' && issue.severity === 'error'
    )
  )
  initial.preparation.groups[0].variants[0].needsSizeMapping = false
  assert.ok(
    reviewStoreImportCodes(state, initial).issues.some(
      (issue) => issue.code === 'PURCHASE_SIZE_REQUIRED'
    )
  )
  const noSize = setGroupSizeMode(
    initial.preparation,
    initial.preparation.groups[0].id,
    'none',
    { snapshot: source.snapshot }
  )
  assert.deepEqual(
    reviewStoreImportCodes(state, { candidate: source, preparation: noSize })
      .issues,
    []
  )
  assert.deepEqual(
    reviewStoreImportCodes(state, {
      candidate: source,
      preparation: noSize,
      resetCodes: true,
    }).issues,
    []
  )
  for (const [
    index,
    variant,
  ] of initial.preparation.groups[0].variants.entries()) {
    variant.sizeSuffix = index ? 'XL' : 'S'
    variant.needsSizeMapping = false
  }
  assert.deepEqual(reviewStoreImportCodes(state, initial).issues, [])
})

test('current and immutable historical assignments reserve codes, but retired checkpoints do not', async () => {
  const state = empty(),
    first = await candidate(),
    second = await candidate('1002')
  const initial = reviewStoreImportCodes(state, { candidate: first })
  const allocated = allocatePreparation(initial.preparation, [], [], {
    snapshot: first.snapshot,
  })
  state.records.push({ snapshot: first.snapshot })
  state.preparations.push({ ...allocated.preparation, revision: 1 })
  state.allocations = allocated.allocations
  state.issuedCodes = allocated.issuedCodes
  const next = reviewStoreImportCodes(state, { candidate: second })
  assert.deepEqual(
    next.preparation.groups.map((group) => group.baseCode),
    ['CE26100103', 'CE26100104']
  )
  next.preparation.groups[0].baseCode = allocated.preparation.groups[0].baseCode
  const conflict = reviewStoreImportCodes(state, {
    candidate: second,
    preparation: next.preparation,
  })
  assert.equal(
    conflict.issues.find((issue) => issue.conflict)?.conflict.owner.orderId,
    '1001'
  )
  const owner = conflict.issues.find((issue) => issue.conflict).conflict.owner
  assert.equal(owner.sourceGroup, '1')
  assert.equal(owner.groupTitle, 'Synthetic cup')
  assert.equal(owner.supplierName, 'Synthetic market')
  assert.equal(owner.orderReference, '1234.xlsx')
  state.locks = consumptionLocksForManifest(
    {
      container: { id: 'synthetic' },
      revisionId: 'synthetic/r1',
      sealedAt: new Date().toISOString(),
      draft: false,
      status: 'sealed',
      orders: [
        { record: state.records[0], preparation: state.preparations[0] },
      ],
      products: [
        {
          accountId: 'local',
          orderId: '1001',
          baseCode: allocated.preparation.groups[0].baseCode,
          barcode: codes(allocated.preparation)[0],
        },
      ],
    },
    state
  )
  state.preparations = []
  const historical = reviewStoreImportCodes(state, {
    candidate: second,
    preparation: next.preparation,
  })
  assert.equal(
    historical.issues.find((issue) => issue.conflict)?.conflict.owner.orderId,
    '1001'
  )
  const history = historical.issues.find((issue) => issue.conflict).conflict
    .owner
  assert.equal(history.historyKind, 'code-history')
  assert.equal(history.containerId, 'synthetic')
  state.locks = []
  const released = reviewStoreImportCodes(state, { candidate: second })
  assert.equal(released.preparation.groups[0].baseCode, 'CE26100101')
  const retired = structuredClone(allocated.preparation)
  retired.previousPacking = structuredClone(allocated.preparation)
  retired.groups = []
  state.preparations = [retired]
  assert.equal(
    reviewStoreImportCodes(state, { candidate: second }).preparation.groups[0]
      .baseCode,
    'CE26100101'
  )
})

test('an unused product number still respects the monthly seller namespace', async () => {
  const state = empty(),
    first = await candidate()
  const reviewed = reviewStoreImportCodes(state, { candidate: first })
  const assigned = allocatePreparation(reviewed.preparation, [], [], {
    snapshot: first.snapshot,
  })
  state.records = [{ snapshot: first.snapshot }]
  state.preparations = [assigned.preparation]
  state.allocations = assigned.allocations
  state.issuedCodes = assigned.issuedCodes
  const another = await candidate('1002', {
    store: {
      key: 'market:5678',
      name: 'Other synthetic market',
      number: '5678',
      kind: 'market',
    },
  })
  const next = reviewStoreImportCodes(state, { candidate: another })
  assert.equal(next.preparation.groups[0].baseCode, 'CE26100201')
  next.preparation.groups[0].baseCode = 'CE26100198'
  const invalid = reviewStoreImportCodes(state, next)
  assert.ok(
    invalid.issues.some(
      (issue) =>
        issue.field === 'baseCode' &&
        /monthly group belongs to another seller/.test(issue.message)
    )
  )
})

test('native atomic reviewed import preserves edits, retries once, rejects concurrent claims and rolls every store back on a late failure', async () => {
  const fixture = await databaseBrowser()
  try {
    const result = await fixture.page.evaluate(async (raw) => {
      const { openDatabase } = modules
      const db = await openDatabase({ name: 'synthetic-store-code-review' })
      const backup = () => db.exportBackup({})
      const before = await backup()
      const uncertain = structuredClone(raw)
      uncertain.rows = ['10-20cm', '20-30cm'].map((size, index) => ({
        ...raw.rows[1],
        row: index + 3,
        group: '1',
        skuProperties: [{ label: 'Size', value: size }],
      }))
      uncertain.total = '40.00'
      const unresolved = await db.reviewStoreOrderImport(uncertain)
      let blockedSize
      try {
        await db.importStoreOrder({
          candidate: unresolved.candidate,
          preparation: unresolved.preparation,
          intentId: 'synthetic-unresolved-size',
        })
      } catch (error) {
        blockedSize = error.code
      }
      const first = await db.reviewStoreOrderImport(raw)
      const reviewedEmpty = await backup()
      first.preparation.groups[0].baseCode = 'CE26100143'
      first.preparation.groups[0].variants[0].variantSuffix = 'C'
      first.preparation.groups[0].variants[0].sizeSuffix = 'XS'
      const again = await db.reviewStoreOrderImport(first)
      const request = {
        candidate: again.candidate,
        preparation: again.preparation,
        intentId: 'synthetic-import-once',
      }
      const saved = await db.importStoreOrder(request)
      const retried = await db.importStoreOrder(request)
      let reused
      try {
        const changed = structuredClone(request)
        changed.preparation.groups[0].baseCode = 'CE26100144'
        await db.importStoreOrder(changed)
      } catch (error) {
        reused = error.code
      }
      const after = await backup()
      const competingA = await db.reviewStoreOrderImport(raw)
      const competingB = await db.reviewStoreOrderImport(raw)
      const concurrent = await Promise.allSettled([
        db.importStoreOrder({ ...competingA, intentId: 'synthetic-claim-a' }),
        db.importStoreOrder({ ...competingB, intentId: 'synthetic-claim-b' }),
      ])
      const afterConcurrent = await backup()
      const late = await db.reviewStoreOrderImport(raw),
        oldPut = IDBObjectStore.prototype.put
      let lateFailure
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'preparations')
          throw new Error('Synthetic late preparation failure')
        return oldPut.apply(this, args)
      }
      try {
        await db.importStoreOrder({
          ...late,
          intentId: 'synthetic-late-failure',
        })
      } catch (error) {
        lateFailure = error.message
      } finally {
        IDBObjectStore.prototype.put = oldPut
      }
      const afterFailure = await backup()
      const retriedFailure = await db.importStoreOrder({
        ...late,
        intentId: 'synthetic-late-failure',
      })
      const legacy = await db.importStoreOrder(raw)
      const final = await backup()
      db.close()
      const reopened = await openDatabase({
        name: 'synthetic-store-code-review',
      })
      const reopenedBackup = await reopened.exportBackup({})
      reopened.close()
      const restored = await openDatabase({
        name: 'synthetic-store-code-restored',
      })
      await restored.restoreBackup(JSON.parse(JSON.stringify(after)))
      const restoredBackup = await restored.exportBackup({})
      restored.close()
      return {
        before,
        reopenedBackup,
        restoredBackup,
        blockedSize,
        reviewedEmpty,
        again,
        saved,
        retried,
        reused,
        after,
        concurrent: concurrent.map((value) => ({
          status: value.status,
          code: value.reason?.code,
          message: value.reason?.message,
        })),
        afterConcurrent,
        lateFailure,
        afterFailure,
        retriedFailure,
        legacy,
        final,
      }
    }, input())
    for (const field of [
      'orders',
      'images',
      'preparations',
      'allocations',
      'issuedCodes',
      'cartonBatches',
      'packingPreferences',
    ])
      assert.deepEqual(
        result.reviewedEmpty[field],
        result.before[field],
        `${field} preview is read-only`
      )
    assert.equal(result.blockedSize, 'PURCHASE_SIZE_REQUIRED')
    assert.deepEqual(result.again.issues, [])
    for (const field of [
      'orders',
      'images',
      'preparations',
      'allocations',
      'issuedCodes',
      'cartonBatches',
    ]) {
      assert.deepEqual(
        result.reopenedBackup[field],
        result.final[field],
        `${field} survives database reopening`
      )
      assert.deepEqual(
        result.restoredBackup[field],
        result.after[field],
        `${field} survives a full backup roundtrip`
      )
    }
    assert.equal(
      result.saved.snapshot.orderId,
      result.again.candidate.snapshot.orderId
    )
    assert.deepEqual(result.saved, result.retried)
    assert.equal(result.reused, 'INTENT_REUSED')
    assert.equal(result.after.orders.length, 1)
    assert.equal(result.after.preparations.length, 1)
    assert.equal(result.after.images.length, 1)
    assert.equal(result.after.cartonBatches.length, 3)
    assert.deepEqual(codes(result.after.preparations[0]), [
      'CE26100143CXS',
      'CE26100143BM',
      'CE26100102',
    ])
    assert.deepEqual(
      result.after.orders[0].snapshot,
      result.again.candidate.snapshot
    )
    assert.deepEqual(result.after.orders[0].unitsPerCarton, {
      1: 10,
      2: 10,
      3: 10,
    })
    assert.deepEqual(result.concurrent.map((value) => value.status).sort(), [
      'fulfilled',
      'rejected',
    ])
    assert.equal(
      result.concurrent.find((value) => value.status === 'rejected').code,
      'PACKING_CODE_CONFLICT'
    )
    assert.equal(result.afterConcurrent.orders.length, 2)
    assert.equal(result.lateFailure, 'Synthetic late preparation failure')
    for (const field of [
      'orders',
      'images',
      'preparations',
      'allocations',
      'issuedCodes',
      'cartonBatches',
      'packingPreferences',
      'operationIntents',
    ])
      assert.deepEqual(
        result.afterFailure[field],
        result.afterConcurrent[field],
        `${field} rolls back`
      )
    assert.equal(result.final.orders.length, 4)
    assert.equal(result.final.preparations.length, 3)
    assert.equal(result.final.cartonBatches.length, 12)
    assert.ok(
      !result.final.preparations.some(
        (preparation) => preparation.orderId === result.legacy.snapshot.orderId
      )
    )
    assert.ok(
      result.final.preparations.some(
        (preparation) =>
          preparation.orderId === result.retriedFailure.snapshot.orderId
      )
    )
  } finally {
    await fixture.close()
  }
})
