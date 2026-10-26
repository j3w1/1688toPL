import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'

test('reviewed family context and details survive atomic assignment, history, reopening and full/scoped restore', async ({
  extension,
}) => {
  const [record] = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)`
  )
  record.snapshot.purchasedAt = '2026-10-24T10:00:00+08:00'
  record.snapshot.sellerMemberLogin = 'synthetic-preparation-history'
  for (const [index, item] of record.snapshot.items.entries()) {
    item.title = '合成树脂摆件'
    item.description = `${item.title}\n颜色：合成款${index + 1}`
    delete item.productNumber
    item.skuProperties = [{ label: '颜色', value: `合成款${index + 1}` }]
  }
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  const result = await page.evaluate(async (record) => {
    const { openDatabase } = await import('/src/database.js')
    const { applyProductDetails } = await import('/src/product-detail-edits.js')
    const { createPackingBackup } = await import('/src/packing-backup.js')
    const { preparationHistorySnapshot, restorePreparationHistory } =
      await import('/src/preparation-history.js')
    const name = 'synthetic-product-preparation-history',
      ref = {
        accountId: record.snapshot.accountId,
        orderId: record.snapshot.orderId,
      },
      ids = record.snapshot.items.map((item) => item.entryId),
      selection = {
        orderRefs: [ref],
        entryRefs: ids.slice(0, 2).map((entryId) => ({ ...ref, entryId })),
      }
    let repository = await openDatabase({ name })
    try {
      await repository.saveSnapshot(record.snapshot)
      const blocked = await repository.reviewPurchaseCodes(selection)
      const review = await repository.reviewPurchaseCodes({
        ...selection,
        familyChoices: [{ ...ref, entryIds: ids, kind: 'family' }],
      })
      review.plan.preparations[0] = applyProductDetails(
        review.plan.preparations[0],
        {
          scope: { kind: 'order' },
          fields: {
            spanishName: 'FIGURA SINTÉTICA',
            category: '合成摆件',
            material: '树脂',
          },
        }
      ).preparation
      const before = await repository.exportBackup(),
        originalTransaction = IDBDatabase.prototype.transaction
      let aborted = false,
        rejected = false
      IDBDatabase.prototype.transaction = function (...args) {
        const tx = originalTransaction.apply(this, args)
        if (!aborted && args[1] === 'readwrite') {
          aborted = true
          queueMicrotask(() => tx.abort())
        }
        return tx
      }
      try {
        await repository.assignPurchaseCodes({
          plan: review.plan,
          intentId: 'synthetic-abort',
        })
      } catch {
        rejected = true
      } finally {
        IDBDatabase.prototype.transaction = originalTransaction
      }
      const failed = await repository.exportBackup()
      await repository.assignPurchaseCodes({
        plan: review.plan,
        intentId: 'synthetic-confirm',
      })
      const assigned = (await repository.listPreparations())[0],
        oldHistory = preparationHistorySnapshot(assigned)
      const edited = applyProductDetails(assigned, {
        scope: { kind: 'order' },
        fields: { material: '玻璃' },
        replaceCustom: true,
      }).preparation
      const [saved] = await repository.savePreparations([edited], {
        preserveNaming: true,
        preserveMaterials: true,
      })
      const [undone] = await repository.savePreparations(
        [restorePreparationHistory(JSON.parse(oldHistory), saved)],
        { preserveNaming: true, preserveMaterials: true }
      )
      const [redone] = await repository.savePreparations(
        [
          restorePreparationHistory(
            JSON.parse(preparationHistorySnapshot(saved)),
            undone
          ),
        ],
        { preserveNaming: true, preserveMaterials: true }
      )
      const full = await repository.exportBackup(),
        scoped = createPackingBackup(full, {
          months: ['2026-10'],
          orders: [{ ...ref, entryIds: [ids[0]] }],
        })
      repository.close()
      repository = await openDatabase({ name })
      const reopened = (await repository.listPreparations())[0],
        sibling = await repository.reviewPurchaseCodes({
          orderRefs: [ref],
          entryRefs: [{ ...ref, entryId: ids[2] }],
        })
      const targets = await Promise.all(
        ['full', 'scoped'].map((suffix) =>
          openDatabase({ name: `${name}-${suffix}` })
        )
      )
      try {
        await targets[0].restoreBackup(full)
        await targets[1].restoreBackup(scoped)
        const restored = await Promise.all(
            targets.map((target) => target.listPreparations())
          ),
          source = structuredClone(record.snapshot)
        source.observedAt = '2026-10-26T12:00:00.000Z'
        source.items[2].description += '\nUpdated source evidence'
        await repository.saveSnapshot(source)
        let staleRejected = false
        try {
          await repository.assignPurchaseCodes({
            plan: sibling.plan,
            intentId: 'synthetic-stale',
          })
        } catch {
          staleRejected = true
        }
        return {
          blocked: blocked.issues.map((issue) => issue.code),
          rejected,
          aborted,
          rollback: [
            'orders',
            'preparations',
            'allocations',
            'issuedCodes',
            'cartonBatches',
          ].every(
            (key) => JSON.stringify(before[key]) === JSON.stringify(failed[key])
          ),
          assigned,
          undone,
          redone,
          reopened,
          restored,
          storedSource: full.orders[0].snapshot,
          siblingIssues: sibling.issues,
          siblingBase: sibling.changes[0]?.baseCode,
          staleRejected,
          scopedSourceCount: scoped.orders[0].snapshot.items.length,
        }
      } finally {
        targets.forEach((target) => target.close())
      }
    } finally {
      repository.close()
    }
  }, record)
  expect(result.blocked).toContain('PRODUCT_FAMILY_REVIEW_REQUIRED')
  expect(result.aborted && result.rejected && result.rollback).toBe(true)
  expect(result.assigned.groups).toHaveLength(1)
  expect(result.assigned.groups[0].spanishName).toBe('FIGURA SINTÉTICA')
  expect(result.assigned.groups[0].category).toBe('合成摆件')
  expect(result.assigned.groups[0].variants[0].material).toBe('树脂')
  expect(result.undone.groups[0].variants[0].material).toBe('树脂')
  expect(result.redone.groups[0].variants[0].material).toBe('玻璃')
  expect(result.reopened).toEqual(result.redone)
  expect(result.restored[0][0]).toEqual(result.redone)
  expect(result.restored[1][0].productFamilies).toEqual(
    result.redone.productFamilies
  )
  expect(
    result.restored[1][0].groups[0].variants.flatMap(
      (variant) => variant.entryIds
    )
  ).toHaveLength(1)
  expect(result.scopedSourceCount).toBe(3)
  expect(result.siblingIssues).toEqual([])
  expect(result.siblingBase).toBe(result.assigned.groups[0].baseCode)
  expect(result.staleRejected).toBe(true)
  expect(result.storedSource).toEqual(record.snapshot)
})
