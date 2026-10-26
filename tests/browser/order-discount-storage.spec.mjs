import { test, expect } from './extension-fixture.mjs'
import { buildOrderFixture } from '../fixtures/order-fixture.mjs'
import { buildDiscountReviewFixture } from '../fixtures/discount-review-fixture.mjs'

test('review receipts survive native source history, rollback, reopening and full/scoped restore', async ({
  extension,
}) => {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  await page.addScriptTag({
    content: `${buildOrderFixture.toString()}\n${buildDiscountReviewFixture.toString()}\nbuildDiscountReviewFixture(document,'9990000000000000091');`,
  })
  const result = await page.evaluate(async () => {
    const { openDatabase } = await import('/src/database.js')
    const { reviewOrderSnapshot, confirmOrderReconciliation } =
      await import('/src/order-snapshot.js')
    const { createPackingBackup } = await import('/src/packing-backup.js')
    const orderId = '9990000000000000091'
    const sourceUrl = `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${orderId}`
    const { review } = reviewOrderSnapshot(document, sourceUrl, {
      observedAt: '2026-10-20T10:00:00.000Z',
    })
    const source = confirmOrderReconciliation(review, {
      choice: review.suggestedChoice,
      evidenceKey: review.evidenceKey,
      reviewedAt: '2026-10-26T06:00:00.000Z',
    })
    const name = 'synthetic-reviewed-financial-history'
    let repository = await openDatabase({ name })
    try {
      await repository.saveSnapshot(source)
      const update = structuredClone(source)
      update.observedAt = '2026-10-21T10:00:00.000Z'
      update.items[0].description = 'Updated synthetic description only'
      await repository.saveSnapshot(update)
      const before = await repository.getOrder(orderId)
      const beforeHistory = await repository.getHistory(orderId)
      const originalTransaction = IDBDatabase.prototype.transaction
      let aborted = false
      IDBDatabase.prototype.transaction = function (...args) {
        const tx = originalTransaction.apply(this, args)
        if (!aborted && args[1] === 'readwrite') {
          aborted = true
          queueMicrotask(() => tx.abort())
        }
        return tx
      }
      let rejected = false
      try {
        const failed = structuredClone(update)
        failed.observedAt = '2026-10-22T10:00:00.000Z'
        failed.items[0].description = 'Must not survive transaction abort'
        await repository.saveSnapshot(failed)
      } catch {
        rejected = true
      } finally {
        IDBDatabase.prototype.transaction = originalTransaction
      }
      const after = await repository.getOrder(orderId)
      const afterHistory = await repository.getHistory(orderId)
      const ref = { accountId: 'local', orderId }
      const codes = await repository.reviewPurchaseCodes({
        orderRefs: [ref],
        entryRefs: source.items.map(({ entryId }) => ({ ...ref, entryId })),
      })
      await repository.assignPurchaseCodes({
        plan: codes.plan || codes,
        expectedRevisions: codes.expectedRevisions,
        intentId: crypto.randomUUID(),
      })
      const full = await repository.exportBackup()
      const scoped = createPackingBackup(full, {
        months: ['2026-10'],
        orders: [{ ...ref, entryIds: [source.items[0].entryId] }],
      })
      repository.close()
      repository = await openDatabase({ name })
      const reopened = await repository.getOrder(orderId)
      const target = await openDatabase({ name: name + '-full' })
      const scopedTarget = await openDatabase({ name: name + '-scope' })
      try {
        await target.restoreBackup(full)
        await scopedTarget.restoreBackup(scoped)
        return {
          receipt: source.reconciliationReview,
          rejected,
          aborted,
          unchanged: JSON.stringify(before) === JSON.stringify(after),
          historyUnchanged:
            JSON.stringify(beforeHistory) === JSON.stringify(afterHistory),
          historicalReceipts: beforeHistory.map(
            (entry) => entry.snapshot.reconciliationReview
          ),
          reopened: reopened.snapshot.reconciliationReview,
          full: (await target.getOrder(orderId)).snapshot.reconciliationReview,
          scoped: (await scopedTarget.getOrder(orderId)).snapshot
            .reconciliationReview,
          scopedSourceRows: (await scopedTarget.getOrder(orderId)).snapshot
            .items.length,
        }
      } finally {
        target.close()
        scopedTarget.close()
      }
    } finally {
      repository.close()
    }
  })
  expect(result.rejected).toBe(true)
  expect(result.aborted).toBe(true)
  expect(result.unchanged).toBe(true)
  expect(result.historyUnchanged).toBe(true)
  expect(result.historicalReceipts).toEqual([result.receipt])
  expect(result.reopened).toEqual(result.receipt)
  expect(result.full).toEqual(result.receipt)
  expect(result.scoped).toEqual(result.receipt)
  expect(result.scopedSourceRows).toBe(15)
})
