import test from 'node:test'
import assert from 'node:assert/strict'
import { databaseBrowser } from './fixtures/database-browser.mjs'
import { SYNTHETIC_PHOTO } from './fixtures/container-fixture.mjs'

const fixture = (count = 20) => {
  const groups = [3, 3, 1, 1, 6, 1, 2, 2, 1, 5]
  const rows = []
  for (const [index, members] of groups.entries()) {
    for (let member = 0; member < members; member++) {
      if (rows.length === count) break
      rows.push({
        row: rows.length + 9,
        group: String(index + 1),
        description: `Synthetic vessel ${index + 1} style ${member + 1}`,
        variants:
          members > 1
            ? [{ variant: String.fromCharCode(65 + member), size: '' }]
            : [],
        boxes: 1,
        perbox: 10,
        quantity: 10,
        price: '2.00',
        amount: '20.00',
        photos: [SYNTHETIC_PHOTO],
      })
    }
  }
  return {
    filename: '4321.xlsx',
    sheetName: 'Products',
    purchaseDate: '2026-10-10',
    store: {
      key: 'market:4321',
      name: 'Synthetic market',
      number: '4321',
      kind: 'market',
    },
    total: `${count * 20}.00`,
    rows,
  }
}

test('atomic spreadsheet replacement preserves identities, authored preparation and retries through reopening and restore', async () => {
  const browser = await databaseBrowser()
  try {
    const result = await browser.page.evaluate(
      async ({ old, updated }) => {
        const db = await modules.openDatabase({
          name: 'store-update-persistence',
        })
        const first = await db.reviewStoreOrderImport(old)
        for (const group of first.preparation.groups) {
          group.spanishName = 'AUTHORED'
          group.category = '器皿'
          group.naming = {
            spanishName: { source: 'manual', value: 'AUTHORED' },
            category: { source: 'manual', value: '器皿' },
          }
          for (const variant of group.variants) {
            variant.material = '陶瓷'
            variant.materialSource = 'manual'
          }
        }
        const saved = await db.importStoreOrder({
          ...first,
          intentId: 'seed-update',
        })
        const target = {
          accountId: saved.snapshot.accountId,
          orderId: saved.snapshot.orderId,
        }
        await db.setNotes(target.orderId, {
          notes: 'Keep these notes',
          tags: ['Keep tag'],
        })
        const before = await db.exportBackup({})
        const review = await db.reviewStoreOrderUpdate({ ...updated, target })
        const afterReview = await db.exportBackup({})
        const request = { ...review, intentId: 'replace-once' }
        const changed = await db.updateStoreOrder(request)
        const retried = await db.updateStoreOrder(request)
        const after = await db.exportBackup({})
        const noChange = await db.reviewStoreOrderUpdate({ ...updated, target })
        const unchangedRecord = await db.updateStoreOrder({
          ...noChange,
          intentId: 'unchanged-update',
        })
        const afterNoOp = await db.exportBackup({})
        db.close()
        const reopened = await modules.openDatabase({
          name: 'store-update-persistence',
        })
        const reopenedBackup = await reopened.exportBackup({})
        reopened.close()
        const restored = await modules.openDatabase({
          name: 'store-update-restored',
        })
        await restored.restoreBackup(JSON.parse(JSON.stringify(after)))
        const restoredBackup = await restored.exportBackup({})
        restored.close()
        return {
          before,
          afterReview,
          review,
          changed,
          retried,
          after,
          noChange,
          unchangedRecord,
          afterNoOp,
          reopenedBackup,
          restoredBackup,
        }
      },
      { old: fixture(), updated: fixture(25) }
    )
    const { before, after, review } = result
    assert.deepEqual(review.issues, [])
    assert.equal(review.summary.added, 5)
    assert.equal(review.summary.priceChanges, 0)
    assert.deepEqual(before.orders, result.afterReview.orders)
    assert.deepEqual(before.cartonBatches, result.afterReview.cartonBatches)
    assert.equal(after.orders.length, 1)
    assert.equal(after.orders[0].snapshot.items.length, 25)
    assert.equal(
      after.cartonBatches.filter((batch) => !batch.deletedAt).length,
      25
    )
    assert.equal(
      after.orders[0].snapshot.orderId,
      before.orders[0].snapshot.orderId
    )
    assert.equal(
      after.orders[0].snapshot.purchasedAt,
      before.orders[0].snapshot.purchasedAt
    )
    assert.deepEqual(
      after.orders[0].snapshot.items.slice(0, 20).map((item) => item.entryId),
      before.orders[0].snapshot.items.map((item) => item.entryId)
    )
    assert.deepEqual(
      after.preparations[0].groups.slice(0, 9).map((group) => group.baseCode),
      before.preparations[0].groups.map((group) => group.baseCode)
    )
    assert.ok(
      after.preparations[0].groups
        .slice(0, 9)
        .every(
          (group) =>
            group.spanishName === 'AUTHORED' &&
            group.category === '器皿' &&
            group.variants.every((variant) => variant.material === '陶瓷')
        )
    )
    assert.equal(after.orders[0].notes, 'Keep these notes')
    assert.deepEqual(after.orders[0].tags, ['Keep tag'])
    assert.deepEqual(result.retried, result.changed)
    assert.equal(
      result.noChange.summary.hasChanges,
      false,
      JSON.stringify({
        summary: result.noChange.summary,
        metadata: result.noChange.sourceMetadataChanges,
        changedGroups: result.noChange.preparation.groups.flatMap(
          (group, index) =>
            JSON.stringify(group) ===
            JSON.stringify(after.preparations[0].groups[index])
              ? []
              : [{ before: after.preparations[0].groups[index], after: group }]
        ),
      })
    )
    assert.deepEqual(result.unchangedRecord, result.changed)
    assert.deepEqual(result.afterNoOp.orders, after.orders)
    assert.deepEqual(result.afterNoOp.history, after.history)
    assert.deepEqual(result.reopenedBackup.orders, after.orders)
    assert.deepEqual(result.restoredBackup.orders, after.orders)
    assert.deepEqual(result.restoredBackup.cartonBatches, after.cartonBatches)
  } finally {
    await browser.close()
  }
})

test('removed rows retire cartons and an older backup cannot revive the retired source batch', async () => {
  const browser = await databaseBrowser()
  try {
    const result = await browser.page.evaluate(async (raw) => {
      const db = await modules.openDatabase({ name: 'store-update-removal' })
      const initial = await db.reviewStoreOrderImport(raw)
      const saved = await db.importStoreOrder({
        ...initial,
        intentId: 'removed-seed',
      })
      const target = { accountId: 'local', orderId: saved.snapshot.orderId }
      const older = await db.exportBackup({})
      const incoming = structuredClone(raw)
      incoming.rows.pop()
      incoming.total = `${incoming.rows.length * 20}.00`
      const review = await db.reviewStoreOrderUpdate({ ...incoming, target })
      await db.updateStoreOrder({ ...review, intentId: 'remove-source-row' })
      const after = await db.exportBackup({})
      let blockedRestore
      try {
        await db.restoreBackup(older)
      } catch (error) {
        blockedRestore = error.message
      }
      const restored = await db.exportBackup({})
      db.close()
      return { after, restored, blockedRestore }
    }, fixture(25))
    assert.equal(result.after.orders[0].snapshot.items.length, 24)
    assert.equal(
      result.after.cartonBatches.filter((batch) => !batch.deletedAt).length,
      24
    )
    const retired = result.after.cartonBatches.find((batch) => batch.deletedAt)
    assert.ok(retired)
    assert.match(result.blockedRestore, /retained carton deletion/)
    assert.equal(result.restored.orders[0].snapshot.items.length, 24)
    assert.ok(
      result.restored.cartonBatches.find((batch) => batch.id === retired.id)
        .deletedAt
    )
    assert.equal(
      result.restored.cartonBatches.filter((batch) => !batch.deletedAt).length,
      24
    )
  } finally {
    await browser.close()
  }
})

test('measurement replacement, stale guards, rollback and retry preserve the entire library on failures', async () => {
  const browser = await databaseBrowser()
  try {
    const result = await browser.page.evaluate(async (raw) => {
      const db = await modules.openDatabase({
        name: 'store-update-measurements',
      })
      const initial = await db.reviewStoreOrderImport(raw)
      const saved = await db.importStoreOrder({
        ...initial,
        intentId: 'measurement-seed',
      })
      const target = { accountId: 'local', orderId: saved.snapshot.orderId }
      const incoming = structuredClone(raw)
      incoming.rows.forEach((row, index) => {
        if (index !== 8) {
          row.kg = '12.5'
          row.cbm = '0.045'
        }
      })
      const review = await db.reviewStoreOrderUpdate({ ...incoming, target })
      const before = await db.exportBackup({})
      const put = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'preparations')
          throw new Error('Synthetic update rollback')
        return put.apply(this, args)
      }
      let failure
      try {
        await db.updateStoreOrder({ ...review, intentId: 'measurement-update' })
      } catch (error) {
        failure = error.message
      } finally {
        IDBObjectStore.prototype.put = put
      }
      const failed = await db.exportBackup({})
      await db.updateStoreOrder({ ...review, intentId: 'measurement-update' })
      const after = await db.exportBackup({})
      let stale
      try {
        await db.updateStoreOrder({ ...review, intentId: 'stale-measurements' })
      } catch (error) {
        stale = error.code
      }
      const final = await db.exportBackup({})
      db.close()
      return { review, before, failed, failure, after, stale, final }
    }, fixture(25))
    assert.deepEqual(result.review.issues, [])
    assert.equal(result.review.summary.measurementsAdded, 24)
    assert.match(result.failure, /Synthetic update rollback/)
    for (const key of [
      'orders',
      'preparations',
      'cartonBatches',
      'images',
      'issuedCodes',
      'operationIntents',
      'history',
    ])
      assert.deepEqual(
        result.failed[key],
        result.before[key],
        `rollback ${key}`
      )
    assert.equal(result.after.orders.length, 1)
    assert.equal(result.after.cartonBatches.length, 25)
    assert.equal(
      result.after.cartonBatches.filter(
        (batch) => batch.weight === '12.5' && batch.suppliedCbm === '0.045'
      ).length,
      24
    )
    assert.equal(result.stale, 'ORDER_REVISION_CONFLICT')
    assert.deepEqual(result.final.orders, result.after.orders)
    assert.deepEqual(result.final.cartonBatches, result.after.cartonBatches)
  } finally {
    await browser.close()
  }
})

test('a shipment sealed after review blocks replacement and names the historical container without partial changes', async () => {
  const browser = await databaseBrowser()
  try {
    const result = await browser.page.evaluate(async (raw) => {
      const db = await modules.openDatabase({ name: 'store-update-sealed' })
      const initial = await db.reviewStoreOrderImport(raw)
      for (const group of initial.preparation.groups) {
        group.spanishName = 'VESSEL'
        group.category = '器皿'
        for (const variant of group.variants) variant.material = '陶瓷'
      }
      const saved = await db.importStoreOrder({
        ...initial,
        intentId: 'sealed-seed',
      })
      const target = { accountId: 'local', orderId: saved.snapshot.orderId }
      const incoming = structuredClone(raw)
      incoming.rows[0].kg = '15'
      const draft = await db.reviewStoreOrderUpdate({ ...incoming, target })
      const container = await db.createContainer({
        name: 'October protected shipment',
      })
      let view = await db.includeContainerOrders({
        id: container.id,
        expectedRevision: container.revision,
        orderRefs: [target],
      })
      view = await db.markContainerLoaded({
        id: container.id,
        expectedRevision: view.container.revision,
      })
      const seal = await db.reviewContainerSeal({
        id: container.id,
        expectedRevision: view.container.revision,
      })
      if (!seal.ready) throw new Error(JSON.stringify(seal.issues))
      await db.sealContainer({
        id: container.id,
        expectedRevision: view.container.revision,
        reviewToken: seal.reviewToken,
      })
      const before = await db.exportBackup({})
      let blocked
      try {
        await db.updateStoreOrder({ ...draft, intentId: 'newly-sealed-update' })
      } catch (error) {
        blocked = { code: error.code, detail: error.detail }
      }
      const fresh = await db.reviewStoreOrderUpdate({ ...incoming, target })
      const after = await db.exportBackup({})
      db.close()
      return { before, after, blocked, fresh }
    }, fixture(1))
    assert.equal(result.blocked.code, 'AMENDMENT_REQUIRED')
    assert.deepEqual(result.blocked.detail.containerNames, [
      'October protected shipment',
    ])
    assert.ok(
      result.fresh.issues.some((issue) => issue.code === 'AMENDMENT_REQUIRED')
    )
    for (const key of [
      'orders',
      'preparations',
      'cartonBatches',
      'containers',
      'shipmentLocks',
      'history',
      'operationIntents',
    ])
      assert.deepEqual(
        result.after[key],
        result.before[key],
        `sealed protection ${key}`
      )
  } finally {
    await browser.close()
  }
})
