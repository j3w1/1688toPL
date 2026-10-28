import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import {
  buildDiscountReviewFixture,
  sixRowDiscountPattern,
} from './fixtures/discount-review-fixture.mjs'
import { extractOrderSnapshot } from '../src/order-snapshot.js'
import { databaseBrowser } from './fixtures/database-browser.mjs'

test('six-row PLUS discounts and seller reduction save automatically, retry without duplicates and retain precise failed-save evidence', async () => {
  const orderId = '9990000000000000078'
  const { document } = parseHTML('<html><body></body></html>')
  buildDiscountReviewFixture(document, orderId, {
    pattern: sixRowDiscountPattern,
    signedAdjustment: true,
    amounts: {
      adjustment: '66.30',
      shop: '0.00',
      shipping: '600.00',
      redPacket: '0.00',
    },
  })
  const snapshot = extractOrderSnapshot(
    document,
    `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${orderId}`
  )
  assert.equal(snapshot.items.length, 6)
  assert.deepEqual(
    snapshot.items.map((item) => item.sourceDiscount),
    sixRowDiscountPattern.map((row) => row[2])
  )
  assert.ok(
    snapshot.items.every(
      (item) =>
        item.allocatedDiscount === '0.00' &&
        item.discount === item.sourceDiscount
    )
  )
  assert.equal(snapshot.reconciliationReview.mode, 'automatic')
  const browser = await databaseBrowser()
  try {
    const result = await browser.page.evaluate(async (source) => {
      let db = await modules.openDatabase({ name: 'synthetic-six-row-footer' })
      try {
        await db.saveSnapshot(source)
        const duplicate = await db.saveSnapshot(source)
        const before = await db.exportBackup({})
        const invalid = structuredClone(source)
        invalid.totals.payable = '10655.01'
        let failure
        try {
          await db.saveSnapshot(invalid)
        } catch (error) {
          failure = {
            code: error.code,
            message: error.message,
            diagnostics: error.diagnostics,
          }
        }
        const after = await db.exportBackup({})
        db.close()
        db = await modules.openDatabase({ name: 'synthetic-six-row-footer' })
        const reopened = await db.getOrder(source.orderId)
        const restored = await modules.openDatabase({
          name: 'synthetic-six-row-footer-restored',
        })
        try {
          await restored.restoreBackup(after)
          return {
            duplicateChanged: duplicate.changed,
            before,
            after,
            failure,
            reopened,
            restored: await restored.getOrder(source.orderId),
            count: (await db.listOrders()).length,
          }
        } finally {
          restored.close()
        }
      } finally {
        db.close()
      }
    }, snapshot)
    assert.equal(result.count, 1)
    assert.equal(result.duplicateChanged, false)
    assert.deepEqual(result.before.orders, result.after.orders)
    assert.deepEqual(result.before.history, result.after.history)
    assert.deepEqual(result.restored, result.reopened)
    assert.equal(result.reopened.snapshot.totals.goodsGross, '10654.00')
    assert.equal(result.reopened.snapshot.totals.sourceDiscount, '532.70')
    assert.equal(result.reopened.snapshot.totals.orderLevelAdjustment, '66.30')
    assert.equal(result.reopened.snapshot.totals.goodsNet, '10055.00')
    assert.equal(result.reopened.snapshot.totals.shipping, '600.00')
    assert.equal(result.reopened.snapshot.totals.payable, '10655.00')
    assert.equal(result.failure.code, 'ORDER_AMOUNT_MISMATCH')
    assert.equal(result.failure.diagnostics.stage, 'validation')
    assert.deepEqual(result.failure.diagnostics.failure, {
      code: 'ORDER_AMOUNT_MISMATCH',
      field: 'payable',
      comparison: 'equal',
      expected: '10655.01',
      actual: '10655.00',
    })
    assert.equal(result.failure.diagnostics.products.count, 6)
    assert.equal(result.failure.diagnostics.products.gross, '10654.00')
    assert.equal(result.failure.diagnostics.products.discount, '532.70')
    assert.equal(
      result.failure.diagnostics.snapshotTotals.orderLevelAdjustment,
      '66.30'
    )
    assert.doesNotMatch(
      JSON.stringify(result.failure),
      /Synthetic product|thumbnail|sku|entryId|sellerName/
    )
  } finally {
    await browser.close()
  }
})

test('automatic footer reductions preserve source rows, receipts and history through native storage and restore', async () => {
  const orderId = '9990000000000000077'
  const { document } = parseHTML('<html><body></body></html>')
  buildDiscountReviewFixture(document, orderId, { signedAdjustment: true })
  const snapshot = extractOrderSnapshot(
    document,
    `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${orderId}`,
    { observedAt: '2026-10-27T05:00:00.000Z' }
  )
  const browser = await databaseBrowser()
  try {
    const result = await browser.page.evaluate(async (source) => {
      const db = await modules.openDatabase({ name: 'automatic-footer-source' })
      await db.saveSnapshot(source)
      const before = await db.exportBackup({})
      const put = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'orders')
          throw new Error('Synthetic automatic financial rollback')
        return put.apply(this, args)
      }
      let failure
      try {
        await db.saveSnapshot({
          ...source,
          observedAt: '2026-10-27T05:01:00.000Z',
          status: 'Updated status',
        })
      } catch (error) {
        failure = error.message
      } finally {
        IDBObjectStore.prototype.put = put
      }
      const afterFailure = await db.exportBackup({})
      await db.saveSnapshot({
        ...source,
        observedAt: '2026-10-27T05:02:00.000Z',
        status: 'Updated status',
      })
      const after = await db.exportBackup({})
      db.close()
      const reopened = await modules.openDatabase({
        name: 'automatic-footer-source',
      })
      const saved = await reopened.getOrder(source.orderId)
      reopened.close()
      const restored = await modules.openDatabase({
        name: 'automatic-footer-restored',
      })
      await restored.restoreBackup(after)
      const roundTrip = await restored.getOrder(source.orderId)
      const invalid = structuredClone(after)
      delete invalid.orders[0].snapshot.reconciliationReview
      let missingReceipt
      try {
        await restored.restoreBackup(invalid)
      } catch (error) {
        missingReceipt = error.message
      }
      restored.close()
      return {
        before,
        afterFailure,
        failure,
        after,
        saved,
        roundTrip,
        missingReceipt,
      }
    }, snapshot)
    assert.match(result.failure, /Synthetic automatic financial rollback/)
    assert.deepEqual(result.afterFailure.orders, result.before.orders)
    assert.deepEqual(result.afterFailure.history, result.before.history)
    assert.equal(result.saved.snapshot.totals.orderLevelAdjustment, '4.50')
    assert.equal(result.saved.snapshot.totals.orderAdjustment, '4.50')
    assert.equal(result.saved.snapshot.totals.payable, '5960.00')
    assert.equal(result.saved.snapshot.totals.rowIncludedAdjustment, undefined)
    assert.equal(result.saved.snapshot.reconciliationReview.mode, 'automatic')
    assert.ok(
      result.saved.snapshot.items.every(
        (item) =>
          item.allocatedDiscount === '0.00' &&
          item.discount === item.sourceDiscount
      )
    )
    assert.deepEqual(result.roundTrip, result.saved)
    assert.deepEqual(
      result.after.history[0].snapshot.reconciliationReview,
      snapshot.reconciliationReview
    )
    assert.match(result.missingReceipt, /does not match/)
  } finally {
    await browser.close()
  }
})
