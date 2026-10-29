import test from 'node:test'
import assert from 'node:assert/strict'
import { databaseBrowser } from './fixtures/database-browser.mjs'
import { SYNTHETIC_PHOTO } from './fixtures/container-fixture.mjs'
import { storeCartonCountUpdate } from './fixtures/store-carton-update.mjs'
import { png } from './fixtures/store-workbook-fixture.mjs'
import { collectImageReferences } from '../src/images.js'
import { validateStoreItem } from '../src/store-order.js'
import { validateBackup } from '../src/database.js'
import { createPackingBackup } from '../src/packing-backup.js'

const NEW_PHOTO = `data:image/png;base64,${png.toString('base64')}`
const single = (photos = [SYNTHETIC_PHOTO]) => {
  const result = storeCartonCountUpdate()
  result.rows = result.rows.slice(0, 1).map((row) => ({ ...row, photos }))
  result.total = result.rows[0].amount
  return result
}

test('spreadsheet source originals validate independently and remain reachable beside chosen display photos', () => {
  const current = `local-image:${'a'.repeat(64)}`,
    source = `local-image:${'b'.repeat(64)}`,
    item = {
      sourceGroup: '1',
      sourceRow: 2,
      photos: [current],
      sourcePhotos: [source],
    }
  assert.deepEqual(validateStoreItem(item).sourcePhotos, [source])
  assert.equal(
    validateStoreItem({ ...item, sourcePhotos: undefined }).sourcePhotos,
    undefined
  )
  for (const sourcePhotos of [
    [],
    ['https://example.invalid/photo.png'],
    null,
    {},
  ])
    assert.throws(
      () => validateStoreItem({ ...item, sourcePhotos }),
      /source photos/
    )
  assert.deepEqual(
    [
      ...collectImageReferences({ orders: [{ snapshot: { items: [item] } }] }),
    ].sort(),
    [current, source]
  )
})

test('52 edited photos on a shared original survive authoritative source/carton replacement, rollback, retries and restore', async () => {
  const browser = await databaseBrowser()
  try {
    const result = await browser.page.evaluate(
      async ({ old, updated, newPhoto }) => {
        const db = await modules.openDatabase({ name: 'photo-update-52' })
        const initial = await db.reviewStoreOrderImport(old)
        const saved = await db.importStoreOrder({
          ...initial,
          intentId: 'photo-seed',
        })
        const target = { accountId: 'local', orderId: saved.snapshot.orderId }
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 128
        const context = canvas.getContext('2d')
        for (const [index, item] of saved.snapshot.items.entries()) {
          context.fillStyle = '#ffffff'
          context.fillRect(0, 0, 128, 128)
          context.fillStyle = '#000000'
          context.fillText(`TAG ${index + 1}`, 8, 30)
          await db.setProductPhoto(target.orderId, item.entryId, {
            thumbnail: canvas.toDataURL('image/png'),
            edit: {
              fit: 'cover',
              scale: 1.25,
              x: 0.05,
              y: -0.05,
              background: '#fafafa',
              tags: [
                {
                  id: `tag-${index}`,
                  code: `TAG ${index + 1}`,
                  x: 0.5,
                  y: 0.5,
                  labelX: 0.8,
                  labelY: 0.8,
                },
              ],
              tagScale: 2,
              pointerScale: 1.5,
              invertPointer: true,
            },
          })
        }
        updated.rows.forEach((row) => {
          row.photos = [newPhoto]
        })
        const before = await db.exportBackup({}),
          review = await db.reviewStoreOrderUpdate({ ...updated, target }),
          afterReview = await db.exportBackup({}),
          request = { ...review, intentId: 'photo-authoritative-update' }
        const put = IDBObjectStore.prototype.put
        IDBObjectStore.prototype.put = function (...args) {
          if (this.name === 'preparations')
            throw new Error('Synthetic photo update rollback')
          return put.apply(this, args)
        }
        let failure
        try {
          await db.updateStoreOrder(request)
        } catch (error) {
          failure = error.message
        } finally {
          IDBObjectStore.prototype.put = put
        }
        const failed = await db.exportBackup({})
        const changed = await db.updateStoreOrder(request),
          duplicate = await db.updateStoreOrder(request),
          after = await db.exportBackup({}),
          noOp = await db.reviewStoreOrderUpdate({ ...updated, target })
        const replacement = structuredClone(noOp.photoChoices),
          first = noOp.photoChanges[0],
          slot = first.slots[0]
        replacement[first.entryId][slot.key].action = 'workbook'
        const replaceReview = await db.reviewStoreOrderUpdate({
          ...noOp,
          photoChoices: replacement,
        })
        await db.updateStoreOrder({
          ...replaceReview,
          intentId: 'replace-one-photo',
        })
        const replaced = await db.exportBackup({})
        db.close()
        const reopened = await modules.openDatabase({
            name: 'photo-update-52',
          }),
          reopenedBackup = await reopened.exportBackup({})
        reopened.close()
        const restored = await modules.openDatabase({
          name: 'photo-update-52-restored',
        })
        await restored.restoreBackup(JSON.parse(JSON.stringify(replaced)))
        const restoredBackup = await restored.exportBackup({})
        restored.close()
        return {
          before,
          review,
          afterReview,
          failure,
          failed,
          changed,
          duplicate,
          after,
          noOp,
          replaced,
          reopenedBackup,
          restoredBackup,
        }
      },
      {
        old: storeCartonCountUpdate(),
        updated: storeCartonCountUpdate(true),
        newPhoto: NEW_PHOTO,
      }
    )
    assert.deepEqual(result.review.issues, [])
    assert.equal(result.review.photoSummary.editedKept, 52)
    assert.equal(result.review.summary.measurementsAdded, 52)
    assert.equal(result.review.summary.after.cartons, 219)
    assert.equal(result.review.summary.after.pieces, '5451')
    assert.equal(result.review.summary.after.total, '21881.80')
    const keys = [
      'orders',
      'history',
      'images',
      'preparations',
      'cartonBatches',
      'issuedCodes',
      'operationIntents',
    ]
    for (const key of keys) {
      assert.deepEqual(
        result.afterReview[key],
        result.before[key],
        `read-only review ${key}`
      )
      assert.deepEqual(
        result.failed[key],
        result.before[key],
        `atomic rollback ${key}`
      )
    }
    assert.match(result.failure, /Synthetic photo update rollback/)
    assert.deepEqual(result.duplicate, result.changed)
    const beforeItems = result.before.orders[0].snapshot.items,
      afterItems = result.after.orders[0].snapshot.items
    for (const [index, item] of afterItems.entries()) {
      assert.deepEqual(item.photos, beforeItems[index].photos)
      assert.deepEqual(item.photoEdits, beforeItems[index].photoEdits)
      assert.equal(item.thumbnail, beforeItems[index].thumbnail)
      assert.notDeepEqual(item.sourcePhotos, item.photos)
      assert.equal(item.price, beforeItems[index].price)
    }
    assert.equal(new Set(afterItems.map((item) => item.thumbnail)).size, 52)
    assert.deepEqual(
      result.after.preparations[0].groups,
      result.before.preparations[0].groups
    )
    assert.equal(result.after.images.length, 2)
    const scoped = validateBackup(
      createPackingBackup(result.after, {
        months: ['2026-10'],
        orders: [
          {
            orderId: result.after.orders[0].snapshot.orderId,
            entryIds: afterItems.map((item) => item.entryId),
          },
        ],
      })
    )
    assert.equal(scoped.images.length, 2)
    assert.deepEqual(
      scoped.orders[0].snapshot.items[0].sourcePhotos,
      afterItems[0].sourcePhotos
    )
    assert.deepEqual(
      scoped.orders[0].snapshot.items[0].photoEdits,
      afterItems[0].photoEdits
    )
    assert.equal(result.noOp.summary.hasChanges, false)
    assert.equal(
      result.replaced.orders[0].snapshot.items[0].photoEdits,
      undefined
    )
    assert.notDeepEqual(
      result.replaced.orders[0].snapshot.items[0].photos,
      afterItems[0].photos
    )
    for (let index = 1; index < 52; index++)
      assert.deepEqual(
        result.replaced.orders[0].snapshot.items[index],
        afterItems[index]
      )
    for (const key of [
      'orders',
      'history',
      'images',
      'preparations',
      'cartonBatches',
    ]) {
      assert.deepEqual(
        result.reopenedBackup[key],
        result.replaced[key],
        `reopened ${key}`
      )
      assert.deepEqual(
        result.restoredBackup[key],
        result.replaced[key],
        `restored ${key}`
      )
    }
  } finally {
    await browser.close()
  }
})

test('historical photo-only recovery preserves the new source quantities and cartons and becomes a no-op', async () => {
  const browser = await databaseBrowser()
  try {
    const result = await browser.page.evaluate(
      async ({ raw, replacementPhoto }) => {
        const db = await modules.openDatabase({
            name: 'photo-history-recovery',
          }),
          initial = await db.reviewStoreOrderImport(raw),
          saved = await db.importStoreOrder({
            ...initial,
            intentId: 'history-photo-seed',
          }),
          target = { accountId: 'local', orderId: saved.snapshot.orderId },
          entryId = saved.snapshot.items[0].entryId,
          edit = { tags: [], scale: 1.5, background: '#fefefe' }
        await db.setProductPhoto(target.orderId, entryId, {
          thumbnail: raw.rows[0].photos[0],
          edit,
        })
        const updated = structuredClone(raw)
        updated.rows[0].photos = [replacementPhoto]
        updated.rows[0].boxes = 2
        updated.rows[0].quantity *= 2
        updated.rows[0].amount = updated.total = (
          Number(updated.rows[0].amount) * 2
        ).toFixed(2)
        const first = await db.reviewStoreOrderUpdate({ ...updated, target })
        first.photoChoices[entryId][first.photoChanges[0].slots[0].key].action =
          'workbook'
        const replace = await db.reviewStoreOrderUpdate(first)
        await db.updateStoreOrder({
          ...replace,
          intentId: 'discard-old-photo-explicitly',
        })
        const beforeRecovery = await db.exportBackup({}),
          recovery = await db.reviewStoreOrderUpdate({ ...updated, target }),
          slot = recovery.photoChanges[0].slots[0]
        if (!slot.previous)
          throw new Error('Historical edited photo was not offered')
        const defaultNoOp = recovery.summary.hasChanges
        recovery.photoChoices[entryId][slot.key] = {
          ...recovery.photoChoices[entryId][slot.key],
          action: 'previous',
          previousPhoto: slot.previous.key,
          previousObservedAt: slot.previous.observedAt,
        }
        const confirmed = await db.reviewStoreOrderUpdate(recovery)
        await db.updateStoreOrder({
          ...confirmed,
          intentId: 'recover-only-photo',
        })
        const afterRecovery = await db.exportBackup({}),
          noOp = await db.reviewStoreOrderUpdate({ ...updated, target })
        db.close()
        return {
          beforeRecovery,
          afterRecovery,
          confirmed,
          noOp,
          defaultNoOp,
          edit,
        }
      },
      { raw: single(), replacementPhoto: NEW_PHOTO }
    )
    assert.equal(result.defaultNoOp, false)
    assert.deepEqual(result.confirmed.issues, [])
    assert.equal(result.confirmed.photoSummary.previousSelected, 1)
    assert.equal(result.confirmed.summary.hasChanges, true)
    const before = result.beforeRecovery.orders[0],
      after = result.afterRecovery.orders[0]
    assert.deepEqual(after.snapshot.items[0].photoEdits, { 0: result.edit })
    assert.notDeepEqual(
      after.snapshot.items[0].photos,
      before.snapshot.items[0].photos
    )
    for (const field of ['quantity', 'price', 'amount', 'carton'])
      assert.deepEqual(
        after.snapshot.items[0][field],
        before.snapshot.items[0][field],
        field
      )
    assert.deepEqual(after.snapshot.totals, before.snapshot.totals)
    const { importedAt: beforeImportedAt, ...beforeSource } =
        before.snapshot.spreadsheet,
      { importedAt: afterImportedAt, ...afterSource } =
        after.snapshot.spreadsheet
    assert.deepEqual(afterSource, beforeSource)
    assert.ok(afterImportedAt >= beforeImportedAt)
    assert.deepEqual(
      result.afterRecovery.cartonBatches,
      result.beforeRecovery.cartonBatches
    )
    assert.deepEqual(
      result.afterRecovery.preparations.map(
        (preparation) => preparation.groups
      ),
      result.beforeRecovery.preparations.map(
        (preparation) => preparation.groups
      )
    )
    assert.equal(result.afterRecovery.images.length, 2)
    assert.equal(result.noOp.summary.hasChanges, false)
  } finally {
    await browser.close()
  }
})

test('gallery reordering matches originals and renders a retained secondary composition as the primary thumbnail in a worker', async () => {
  const browser = await databaseBrowser()
  try {
    const result = await browser.page.evaluate(
      async (raw) => {
        const db = await modules.openDatabase({ name: 'photo-gallery-worker' }),
          initial = await db.reviewStoreOrderImport(raw),
          saved = await db.importStoreOrder({
            ...initial,
            intentId: 'gallery-photo-seed',
          }),
          target = { accountId: 'local', orderId: saved.snapshot.orderId },
          entryId = saved.snapshot.items[0].entryId,
          edit = {
            fit: 'cover',
            scale: 1.5,
            tags: [
              {
                id: 'secondary-tag',
                code: 'SECOND',
                x: 0.5,
                y: 0.5,
                labelX: 0.8,
                labelY: 0.8,
              },
            ],
          }
        await db.setProductPhoto(target.orderId, entryId, {
          photoIndex: 1,
          edit,
        })
        const before = await db.exportBackup({}),
          updated = structuredClone(raw)
        updated.rows[0].photos.reverse()
        const nativeImage = window.Image
        let review, changed
        try {
          window.Image = undefined
          review = await db.reviewStoreOrderUpdate({ ...updated, target })
          changed = await db.updateStoreOrder({
            ...review,
            intentId: 'gallery-reorder',
          })
        } finally {
          window.Image = nativeImage
        }
        const after = await db.exportBackup({}),
          noOp = await db.reviewStoreOrderUpdate({ ...updated, target })
        db.close()
        return { before, review, changed, after, noOp, edit }
      },
      single([SYNTHETIC_PHOTO, NEW_PHOTO])
    )
    assert.deepEqual(result.review.issues, [])
    const item = result.changed.snapshot.items[0]
    assert.deepEqual(
      item.photos,
      [...result.before.orders[0].snapshot.items[0].photos].reverse()
    )
    assert.deepEqual(item.photoEdits, { 0: result.edit })
    assert.match(item.thumbnail, /^data:image\/png;base64,/)
    assert.notEqual(
      item.thumbnail,
      result.before.orders[0].snapshot.items[0].thumbnail
    )
    assert.notEqual(item.thumbnail, NEW_PHOTO)
    assert.equal(result.noOp.summary.hasChanges, false)
  } finally {
    await browser.close()
  }
})

test('photo edits in another tab and missing retained originals reject confirmation without partial writes', async () => {
  const browser = await databaseBrowser()
  try {
    const result = await browser.page.evaluate(
      async ({ raw, replacementPhoto }) => {
        const name = 'photo-update-stale-assets',
          db = await modules.openDatabase({ name }),
          initial = await db.reviewStoreOrderImport(raw),
          saved = await db.importStoreOrder({
            ...initial,
            intentId: 'photo-guard-seed',
          }),
          target = { accountId: 'local', orderId: saved.snapshot.orderId },
          entryId = saved.snapshot.items[0].entryId
        await db.setProductPhoto(target.orderId, entryId, {
          edit: { scale: 1.25 },
        })
        const incoming = structuredClone(raw)
        incoming.rows[0].photos = [replacementPhoto]
        const review = await db.reviewStoreOrderUpdate({ ...incoming, target })
        await db.setProductPhoto(target.orderId, entryId, {
          edit: { scale: 1.75 },
        })
        const before = await db.exportBackup({})
        let stale
        try {
          await db.updateStoreOrder({
            ...review,
            intentId: 'stale-photo-choice',
          })
        } catch (error) {
          stale = error.code
        }
        const afterStale = await db.exportBackup({}),
          fresh = await db.reviewStoreOrderUpdate({ ...incoming, target })
        const direct = await new Promise((resolve, reject) => {
          const request = indexedDB.open(name, 5)
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        await new Promise((resolve, reject) => {
          const tx = direct.transaction('images', 'readwrite')
          tx.objectStore('images').delete(saved.snapshot.items[0].photos[0])
          tx.oncomplete = resolve
          tx.onerror = () => reject(tx.error)
        })
        direct.close()
        const missingBaseline = await db.exportBackup({})
        let missing
        try {
          await db.updateStoreOrder({
            ...fresh,
            intentId: 'missing-photo-choice',
          })
        } catch (error) {
          missing = error.code
        }
        const afterMissing = await db.exportBackup({})
        db.close()
        return {
          before,
          afterStale,
          stale,
          missingBaseline,
          afterMissing,
          missing,
        }
      },
      { raw: single(), replacementPhoto: NEW_PHOTO }
    )
    assert.equal(result.stale, 'ORDER_REVISION_CONFLICT')
    assert.equal(result.missing, 'STORE_UPDATE_PHOTO_MISSING')
    for (const key of [
      'orders',
      'history',
      'preparations',
      'cartonBatches',
      'issuedCodes',
      'operationIntents',
      'images',
    ]) {
      assert.deepEqual(
        result.afterStale[key],
        result.before[key],
        `stale ${key}`
      )
      assert.deepEqual(
        result.afterMissing[key],
        result.missingBaseline[key],
        `missing ${key}`
      )
    }
  } finally {
    await browser.close()
  }
})

test('photo updates preserve sealed source media and its complete immutable shipment revision', async () => {
  const browser = await databaseBrowser()
  try {
    const result = await browser.page.evaluate(
      async ({ raw, replacementPhoto }) => {
        const db = await modules.openDatabase({
            name: 'photo-update-sealed-media',
          }),
          initial = await db.reviewStoreOrderImport(raw)
        for (const group of initial.preparation.groups) {
          group.spanishName = 'VESSEL'
          group.category = '器皿'
          for (const variant of group.variants) variant.material = '陶瓷'
        }
        const saved = await db.importStoreOrder({
            ...initial,
            intentId: 'sealed-photo-seed',
          }),
          target = { accountId: 'local', orderId: saved.snapshot.orderId },
          container = await db.createContainer({
            name: 'Frozen media shipment',
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
        await db.setProductPhoto(
          target.orderId,
          saved.snapshot.items[0].entryId,
          { edit: { tags: [], scale: 1.5 }, thumbnail: raw.rows[0].photos[0] }
        )
        const incoming = structuredClone(raw)
        incoming.rows[0].photos = [replacementPhoto]
        const review = await db.reviewStoreOrderUpdate({ ...incoming, target })
        await db.updateStoreOrder({
          ...review,
          intentId: 'update-current-photo-after-seal',
        })
        const after = await db.exportBackup({})
        db.close()
        return { before, after, review }
      },
      { raw: single(), replacementPhoto: NEW_PHOTO }
    )
    assert.deepEqual(result.review.issues, [])
    assert.deepEqual(result.after.containers, result.before.containers)
    assert.deepEqual(result.after.shipmentLocks, result.before.shipmentLocks)
    assert.deepEqual(result.after.cartonBatches, result.before.cartonBatches)
    assert.equal(result.after.images.length, 2)
    assert.equal(
      result.after.orders[0].snapshot.items[0].photoEdits[0].scale,
      1.5
    )
    assert.equal(
      result.after.orders[0].snapshot.items[0].sourcePhotos.length,
      1
    )
  } finally {
    await browser.close()
  }
})

test('failed thumbnail decoding retains the photo draft and allows the same intent to retry without partial writes', async () => {
  const browser = await databaseBrowser()
  try {
    const result = await browser.page.evaluate(
      async (raw) => {
        const db = await modules.openDatabase({
            name: 'photo-update-render-retry',
          }),
          initial = await db.reviewStoreOrderImport(raw),
          saved = await db.importStoreOrder({
            ...initial,
            intentId: 'render-retry-seed',
          }),
          target = { accountId: 'local', orderId: saved.snapshot.orderId }
        await db.setProductPhoto(
          target.orderId,
          saved.snapshot.items[0].entryId,
          { photoIndex: 1, edit: { scale: 1.5, tags: [] } }
        )
        const before = await db.exportBackup({}),
          incoming = structuredClone(raw)
        incoming.rows[0].photos.reverse()
        const nativeImage = window.Image,
          nativeBitmap = window.createImageBitmap
        let review, failure
        try {
          window.Image = undefined
          window.createImageBitmap = async () => {
            throw new Error('Synthetic decoder failure')
          }
          review = await db.reviewStoreOrderUpdate({ ...incoming, target })
          try {
            await db.updateStoreOrder({
              ...review,
              intentId: 'render-retry-update',
            })
          } catch (error) {
            failure = error.code
          }
        } finally {
          window.Image = nativeImage
          window.createImageBitmap = nativeBitmap
        }
        const afterFailure = await db.exportBackup({}),
          retry = await db.reviewStoreOrderUpdate(review)
        await db.updateStoreOrder({ ...retry, intentId: 'render-retry-update' })
        const afterRetry = await db.exportBackup({})
        db.close()
        return { before, review, failure, afterFailure, retry, afterRetry }
      },
      single([SYNTHETIC_PHOTO, NEW_PHOTO])
    )
    assert.equal(result.failure, 'STORE_UPDATE_PHOTO_RENDER_FAILED')
    assert.ok(
      result.review.issues.some(
        (issue) => issue.code === 'STORE_UPDATE_PHOTO_RENDER_FAILED'
      )
    )
    assert.ok(
      result.review.issues.every(
        (issue) => !issue.message.includes('Synthetic decoder failure')
      )
    )
    for (const key of [
      'orders',
      'history',
      'preparations',
      'cartonBatches',
      'images',
      'issuedCodes',
      'operationIntents',
    ])
      assert.deepEqual(
        result.afterFailure[key],
        result.before[key],
        `render failure ${key}`
      )
    assert.deepEqual(result.retry.issues, [])
    assert.equal(
      result.afterRetry.orders[0].snapshot.items[0].photoEdits[0].scale,
      1.5
    )
    assert.equal(result.afterRetry.orders.length, 1)
    assert.equal(result.afterRetry.cartonBatches.length, 1)
  } finally {
    await browser.close()
  }
})
