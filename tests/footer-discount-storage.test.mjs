import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { buildDiscountReviewFixture } from './fixtures/discount-review-fixture.mjs'
import { extractOrderSnapshot } from '../src/order-snapshot.js'
import { databaseBrowser } from './fixtures/database-browser.mjs'

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
