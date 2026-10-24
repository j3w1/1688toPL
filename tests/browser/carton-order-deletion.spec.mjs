import { test, expect } from './extension-fixture.mjs'

function snapshot(orderId, accountId = 'local') {
  return {
    schemaVersion: 1,
    accountId,
    orderId,
    sourceUrl: `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${orderId}`,
    sellerName: 'Synthetic carton deletion supplier',
    sellerMemberLogin: 'synthetic-carton-deletion',
    status: 'Completed',
    purchasedAt: '2026-10-01T12:00:00+08:00',
    observedAt: '2026-10-01T12:00:00.000Z',
    items: [
      {
        entryId: '1',
        title: 'Synthetic carton product',
        productNumber: 'SKU',
        description: 'Synthetic carton product',
        thumbnail: '',
        price: '1.00',
        quantity: '3',
        sourceDiscount: '0.00',
        allocatedDiscount: '0.00',
        discount: '0.00',
      },
    ],
    totals: {
      goodsGross: '3.00',
      shipping: '0.00',
      sourceDiscount: '0.00',
      orderAdjustment: '0.00',
      goodsNet: '3.00',
      payable: '3.00',
    },
  }
}

async function setup(extension, reference = 'contents') {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  await page.evaluate(
    async ({ sources, reference }) => {
      const { openDatabase, validateBackup } = await import('/src/database.js'),
        { createPreparation } = await import('/src/packing-model.js'),
        { validateCartonBatch } = await import('/src/carton-batches.js'),
        { repeatProductStoreIdentity } = await import('/src/repeat-products.js')
      window.databaseName = `synthetic-carton-deletion-${crypto.randomUUID()}`
      window.library = await openDatabase({ name: databaseName })
      const preparations = []
      for (const source of sources) {
        await library.saveSnapshot(source)
        preparations.push(
          await library.savePreparation(createPreparation(source, '2026-10'))
        )
      }
      await library.saveSnapshot({
        ...sources[0],
        observedAt: '2026-10-02T12:00:00.000Z',
        status: 'Shipped',
      })
      const owner =
          reference === 'other-account'
            ? 3
            : ['contents', 'orderId'].includes(reference)
              ? 0
              : 1,
        content = sources[owner],
        group = (index) => ({
          orderId: sources[index].orderId,
          groupId: preparations[index].groups[0].id,
        }),
        batch = validateCartonBatch({
          id: 'synthetic-active-carton',
          ...(reference === 'orderId' ? { orderId: content.orderId } : {}),
          accountId: content.accountId,
          storeId: repeatProductStoreIdentity(content),
          month: '2026-10',
          groups:
            reference === 'groups' ? [group(0), group(owner)] : [group(owner)],
          mark: reference === 'mark' ? group(0) : group(owner),
          contents: [{ orderId: content.orderId, entryId: '1', quantity: '3' }],
          count: 1,
          len: '40',
          wid: '30',
          ht: '25',
          weightBasis: 'carton',
          weight: '9.5',
          received: 1,
          loaded: 0,
          revision: 0,
          updatedAt: new Date().toISOString(),
          ...(['groups', 'mark'].includes(reference)
            ? { needsReview: true }
            : {}),
        })
      if (batch.needsReview) {
        // Retained review evidence can reference an old owning group or mark.
        // Restore validates the actual source/store/quantity evidence normally.
        const backup = await library.exportBackup()
        backup.cartonBatches.push(batch)
        validateBackup(backup)
        await library.restoreBackup(backup)
      } else await library.saveCartonBatch(batch)
    },
    {
      sources: [
        snapshot('1001'),
        snapshot('1002'),
        snapshot('1003'),
        snapshot('1001', 'other-account'),
      ],
      reference,
    }
  )
  return page
}

for (const reference of ['contents', 'orderId']) {
  test(`deleting an order retires its exclusively owned ${reference} cartons atomically`, async ({
    extension,
  }) => {
    const page = await setup(extension, reference)
    const result = await page.evaluate(async () => {
      const before = await library.exportBackup()
      const review = await library.reviewOrderRemoval(['1003', '1001'])
      const afterReview = await library.exportBackup()
      await library.removeOrders(['1003', '1001'])
      return {
        before,
        review,
        afterReview,
        after: await library.exportBackup(),
      }
    })
    expect(result.review.canRemove).toBe(true)
    expect(result.review.cartonBatchCount).toBe(1)
    expect({ ...result.afterReview, exportedAt: '' }).toEqual({
      ...result.before,
      exportedAt: '',
    })
    expect(
      result.after.orders.map(({ snapshot }) => [
        snapshot.accountId,
        snapshot.orderId,
      ])
    ).toEqual([
      ['local', '1002'],
      ['other-account', '1001'],
    ])
    expect(result.after.history).toEqual([])
    expect(
      result.after.preparations.map((entry) => [entry.accountId, entry.orderId])
    ).toEqual([
      ['local', '1002'],
      ['other-account', '1001'],
    ])
    const [batch] = result.after.cartonBatches
    expect(batch.deletedAt).toBeTruthy()
    expect(batch.revision).toBeGreaterThan(
      result.before.cartonBatches[0].revision
    )
    expect(batch.contents).toEqual(result.before.cartonBatches[0].contents)
  })
}

for (const reference of ['groups', 'mark']) {
  test(`legacy carton ${reference} ownership rejects bulk deletion until every owner is selected`, async ({
    extension,
  }) => {
    const page = await setup(extension, reference)
    const result = await page.evaluate(async () => {
      const before = await library.exportBackup()
      const review = await library.reviewOrderRemoval(['1003', '1001'])
      let error
      try {
        await library.removeOrders(['1003', '1001'])
      } catch (failure) {
        error = { code: failure.code, message: failure.message }
      }
      const after = await library.exportBackup()
      await library.removeOrders(['1001', '1002', '1003'])
      return {
        before,
        after,
        review,
        error,
        complete: await library.exportBackup(),
      }
    })
    expect(result.error.code).toBe('ORDER_REMOVAL_BLOCKED')
    expect(result.review.canRemove).toBe(false)
    expect(result.review.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          orderId: '1001',
          batchId: 'synthetic-active-carton',
        }),
      ])
    )
    expect(result.error.message).not.toContain('Remove this order')
    expect({ ...result.after, exportedAt: '' }).toEqual({
      ...result.before,
      exportedAt: '',
    })
    expect(
      result.complete.orders.map(({ snapshot }) => snapshot.accountId)
    ).toEqual(['other-account'])
    expect(result.complete.cartonBatches[0].deletedAt).toBeTruthy()
  })
}

for (const reference of ['other-order', 'other-account']) {
  test(`active cartons from an ${reference} do not block deleting an unrelated source`, async ({
    extension,
  }) => {
    const page = await setup(extension, reference)
    const result = await page.evaluate(async (reference) => {
      const { validateBackup } = await import('/src/database.js'),
        accountId = reference === 'other-account' ? 'other-account' : 'local',
        before = await library.listCartonBatches({
          accountId,
          includeDeleted: true,
        })
      await library.removeOrders(['1001'])
      const after = await library.listCartonBatches({
          accountId,
          includeDeleted: true,
        }),
        localBackup = await library.exportBackup(),
        otherBackup = await library.exportBackup({ accountId: 'other-account' })
      validateBackup(localBackup)
      validateBackup(otherBackup)
      return {
        before,
        after,
        local: await library.listOrders(),
        other: await library.getOrder('1001', { accountId: 'other-account' }),
      }
    }, reference)
    expect(result.after).toEqual(result.before)
    expect(result.local.map((record) => record.snapshot.orderId)).toEqual([
      '1002',
      '1003',
    ])
    expect(result.other.snapshot.accountId).toBe('other-account')
  })
}

test('order deletion retains carton tombstones across reopening and restore and old backups cannot revive them', async ({
  extension,
}) => {
  const page = await setup(extension)
  const result = await page.evaluate(async () => {
    const { openDatabase, validateBackup } = await import('/src/database.js')
    const olderBackup = await library.exportBackup()
    await library.removeOrders(['1001'])
    const retired = await library.listCartonBatches({ includeDeleted: true })
    library.close()
    window.library = await openDatabase({ name: databaseName })
    const backup = await library.exportBackup(),
      retained = await library.listCartonBatches({ includeDeleted: true })
    validateBackup(backup)
    const restored = await openDatabase({ name: `${databaseName}-restored` })
    await restored.restoreBackup(backup)
    const roundtrip = await restored.exportBackup()
    validateBackup(roundtrip)
    let oldRestoreError
    try {
      await restored.restoreBackup(olderBackup)
    } catch (error) {
      oldRestoreError = error.message
    }
    const afterOldRestore = await restored.listCartonBatches({
      includeDeleted: true,
    })
    restored.close()
    return {
      retired,
      retained,
      backup,
      roundtrip,
      afterOldRestore,
      oldRestoreError,
      active: await library.listCartonBatches(),
    }
  })
  expect(result.retired[0].deletedAt).toBeTruthy()
  expect(result.retained).toEqual(result.retired)
  expect(result.active).toEqual([])
  expect(
    result.backup.orders.map(({ snapshot }) => [
      snapshot.accountId,
      snapshot.orderId,
    ])
  ).toEqual([
    ['local', '1002'],
    ['local', '1003'],
    ['other-account', '1001'],
  ])
  expect(result.backup.history).toEqual([])
  expect(result.backup.cartonBatches).toEqual(result.retired)
  expect(result.roundtrip.cartonBatches).toEqual(result.retired)
  expect(result.oldRestoreError).toContain('retained carton deletion')
  expect(result.afterOldRestore).toEqual(result.retired)
})

async function prepareContainers(page, { skipSecondBatch = false } = {}) {
  await page.evaluate(
    async ({ skipSecondBatch }) => {
      const records = await library.listOrders()
      for (const [index, record] of records.entries()) {
        const { accountId, orderId } = record.snapshot
        const preparation = await library.getPreparation(orderId, { accountId })
        for (const group of preparation.groups) {
          group.baseCode = `CE261001${String(index + 1).padStart(2, '0')}`
          group.spanishName = 'PRODUCTO SINTETICO'
          group.category = '杯'
          group.sizeMode = 'none'
          for (const variant of group.variants) {
            variant.variantSuffix = ''
            variant.sizeSuffix = ''
            variant.needsSizeMapping = false
          }
        }
        await library.savePreparation(preparation)
        if (
          accountId !== 'local' ||
          orderId === '1001' ||
          (skipSecondBatch && orderId === '1002')
        )
          continue
        const [original] = await library.listCartonBatches()
        await library.saveCartonBatch({
          ...original,
          id: `cartons-${orderId}`,
          orderId,
          groups: [{ orderId, groupId: preparation.groups[0].id }],
          mark: { orderId, groupId: preparation.groups[0].id },
          contents: [{ orderId, entryId: '1', quantity: '3' }],
          revision: 0,
        })
      }
      window.addDraft = async (name, orderIds) => {
        const container = await library.createContainer({ name })
        return library.includeContainerOrders({
          id: container.id,
          orderRefs: orderIds.map((orderId) => ({
            accountId: 'local',
            orderId,
          })),
          expectedRevision: container.revision,
        })
      }
      window.sealDraft = async (view) => {
        const loaded = await library.markContainerLoaded({
          id: view.container.id,
          expectedRevision: view.container.revision,
        })
        const review = await library.reviewContainerSeal({
          id: loaded.container.id,
          expectedRevision: loaded.container.revision,
        })
        if (!review.ready) throw new Error(JSON.stringify(review))
        return library.sealContainer({
          id: loaded.container.id,
          expectedRevision: loaded.container.revision,
          reviewToken: review.reviewToken,
        })
      }
    },
    { skipSecondBatch }
  )
}

test('bulk deletion detaches multiple unsealed containers, keeps other orders and decisions, and retains empty containers', async ({
  extension,
}) => {
  const page = await setup(extension)
  await prepareContainers(page)
  const result = await page.evaluate(async () => {
    let mixed = await addDraft('Mixed draft', ['1001', '1002'])
    mixed = await library.markContainerLoaded({
      id: mixed.container.id,
      expectedRevision: mixed.container.revision,
    })
    const empty = await addDraft('Becomes empty', ['1003'])
    await library.saveOrderCartonDraft({
      orderId: '1001',
      expectedRevision: 0,
      draft: { note: 'Synthetic reconciliation recovery' },
    })
    const review = await library.reviewOrderRemoval(['1001', '1003'])
    const mixedRecord = (await library.exportBackup()).containers.find(
      (container) => container.id === mixed.container.id
    )
    const survivor = mixedRecord.draft.orders.find(
      (order) => order.orderId === '1002'
    )
    const survivorDecisions = Object.fromEntries(
      survivor.cartons.map((carton) => [
        carton.id,
        mixedRecord.draft.decisions[carton.id],
      ])
    )
    await library.removeOrders(['1001', '1003'])
    const after = await library.exportBackup()
    return {
      review,
      after,
      mixedId: mixed.container.id,
      emptyId: empty.container.id,
      survivor,
      survivorDecisions,
    }
  })
  expect(result.review.canRemove).toBe(true)
  expect(result.review.cartonBatchCount).toBe(2)
  expect(
    result.review.containers.map((container) => container.name).sort()
  ).toEqual(['Becomes empty', 'Mixed draft'])
  const mixed = result.after.containers.find(
    (container) => container.id === result.mixedId
  )
  const empty = result.after.containers.find(
    (container) => container.id === result.emptyId
  )
  expect(mixed.draft.orders).toEqual([result.survivor])
  expect(mixed.draft.decisions).toEqual(result.survivorDecisions)
  expect(empty.status).toBe('draft')
  expect(empty.draft.orders).toEqual([])
  expect(empty.draft.decisions).toEqual({})
  expect(result.after.orderCartonDrafts).toEqual([])
  expect(
    result.after.cartonBatches.filter((batch) => batch.deletedAt)
  ).toHaveLength(2)
  expect(
    result.after.cartonBatches
      .filter((batch) => !batch.deletedAt)
      .map((batch) => batch.orderId)
  ).toEqual(['1002'])
})

test('sealed containers block the whole request by actual name, including after a stale deletion review', async ({
  extension,
}) => {
  const page = await setup(extension)
  await prepareContainers(page)
  const result = await page.evaluate(async () => {
    const first = await addDraft('Actual October shipment', ['1001'])
    const second = await addDraft('Actual November shipment', ['1002'])
    const review = await library.reviewOrderRemoval(['1001', '1002', '1003'])
    await sealDraft(first)
    await sealDraft(second)
    const before = await library.exportBackup()
    let error
    try {
      await library.removeOrders(['1001', '1002', '1003'])
    } catch (failure) {
      error = { code: failure.code, message: failure.message }
    }
    const blocked = await library.reviewOrderRemoval(['1001', '1002', '1003'])
    return {
      review,
      blocked,
      error,
      before,
      after: await library.exportBackup(),
    }
  })
  expect(result.review.canRemove).toBe(true)
  expect(result.blocked.canRemove).toBe(false)
  expect(result.error.code).toBe('ORDER_REMOVAL_BLOCKED')
  const names = result.blocked.blockers.flatMap(
    (blocker) => blocker.containerNames || []
  )
  expect(names).toContain('Actual October shipment')
  expect(names).toContain('Actual November shipment')
  expect(result.error.message).toContain('Actual October shipment')
  expect(result.error.message).toContain('Actual November shipment')
  expect({ ...result.after, exportedAt: '' }).toEqual({
    ...result.before,
    exportedAt: '',
  })
})

test('draft-only amendment additions can be deleted while previous sealed revisions remain protected', async ({
  extension,
}) => {
  const page = await setup(extension)
  await prepareContainers(page, { skipSecondBatch: true })
  const result = await page.evaluate(async () => {
    const cells = await import('/src/packing-report-cells.js')
    const reports = await import('/src/packing-report-model.js')
    const matches = await import('/src/packing-report-matches.js')
    async function reportForSecond(weight, contextContainerId) {
      const text = `Carton no\tArticle\tPieces per carton\tWeight per carton kg\n001\tSKU\t3\t${weight}`
      const raw = await library.savePackingReportSource({
        orderId: '1002',
        kind: 'clipboard-tsv',
        text,
      })
      const context = await library.getPackingReportContext({
        orderId: '1002',
        contextContainerId,
      })
      const source = cells.parsePackingReportCells({ ...raw, text }).source
      const analysis = reports.analyzePackingReport({ source, context })
      const prior = context.previousReports[0]
      const review = reports.validatePackingReportReview({
        analysis,
        context,
        previousReportRevision: prior?.revision ?? null,
        expectedContextRevisions: context.expectedRevisions,
      })
      if (!review.valid) throw new Error(JSON.stringify(review.issues))
      const plan = matches.planPackingReportUpdate({
        interpretedReport: review.interpretedReport,
        priorReport: prior,
        physicalFacts: context.batches,
        sealedDependencies: context.sealedDependencies,
        newIdentityPool: prior ? [] : ['synthetic-report-1002'],
      })
      if (plan.status !== 'ready') throw new Error(JSON.stringify(plan))
      const reconciliation = await library.getOrderReconciliation({
        orderId: '1002',
        contextContainerId,
      })
      await library.commitPackingReportUpdate({
        orderId: '1002',
        contextContainerId,
        expectedAmendment: reconciliation.amendmentContext,
        plan,
        expectedRevisions: context.expectedRevisions,
      })
    }
    await reportForSecond('9.5')
    const initial = await addDraft('Historical shipment', ['1001'])
    await sealDraft(initial)
    const sealed = await library.getContainerView({ id: initial.container.id })
    let amended = await library.beginContainerAmendment({
      id: initial.container.id,
      expectedRevision: sealed.container.revision,
      reason: 'Synthetic added purchase',
    })
    amended = await library.includeContainerOrders({
      id: initial.container.id,
      expectedRevision: amended.container.revision,
      orderRefs: [{ accountId: 'local', orderId: '1002' }],
    })
    await reportForSecond('10.5', initial.container.id)
    for (const orderId of ['1001', '1002']) {
      let context = await library.getOrderReconciliation({
        orderId,
        contextContainerId: initial.container.id,
      })
      await library.updateOrderCapacities({
        orderId,
        values: { 1: '3' },
        expectedValues: { 1: null },
        expectedObservedAt: context.record.snapshot.observedAt,
        contextContainerId: initial.container.id,
        expectedAmendment: context.amendmentContext,
      })
      context = await library.getOrderReconciliation({
        orderId,
        contextContainerId: initial.container.id,
      })
      const candidate = structuredClone(context.preparation)
      candidate.groups[0].spanishName = `STAGED ${orderId}`
      await library.savePreparation(candidate, {
        contextContainerId: initial.container.id,
        expectedAmendment: context.amendmentContext,
        preserveNaming: true,
      })
    }
    const context = await library.getOrderReconciliation({
      orderId: '1001',
      contextContainerId: initial.container.id,
    })
    await library.saveOrderCartonFacts({
      orderId: '1001',
      contextContainerId: initial.container.id,
      expectedAmendment: context.amendmentContext,
      expectedRevisions: context.revisions,
      changes: [
        {
          after: { ...context.batches[0], weight: '12.5' },
          expectedRevision: context.batches[0].revision,
        },
      ],
    })
    const staged = (await library.exportBackup()).containers.find(
      (container) => container.id === initial.container.id
    ).draft
    const previousRevisions = (await library.exportBackup()).containers.find(
      (container) => container.id === initial.container.id
    ).revisions
    const review = await library.reviewOrderRemoval(['1002'])
    await library.removeOrders(['1002'])
    const after = await library.exportBackup()
    const oldReview = await library.reviewOrderRemoval(['1001'])
    return {
      review,
      previousRevisions,
      staged,
      after,
      oldReview,
      containerId: initial.container.id,
    }
  })
  expect(result.review.canRemove).toBe(true)
  expect(
    result.staged.orderChanges
      .map((change) => change.after.snapshot.orderId)
      .sort()
  ).toEqual(['1001', '1002'])
  expect(
    result.staged.preparationChanges
      .map((change) => change.after.orderId)
      .sort()
  ).toEqual(['1001', '1002'])
  expect(result.staged.cartonChanges).toHaveLength(2)
  expect(
    result.staged.reportChanges.map((report) => report.orderKey.orderId)
  ).toEqual(['1002'])
  const container = result.after.containers.find(
    (entry) => entry.id === result.containerId
  )
  expect(container.status).toBe('amending')
  expect(container.revisions).toEqual(result.previousRevisions)
  expect(container.draft.orderChanges).toEqual(
    result.staged.orderChanges.filter(
      (change) => change.after.snapshot.orderId === '1001'
    )
  )
  expect(container.draft.preparationChanges).toEqual(
    result.staged.preparationChanges.filter(
      (change) => change.after.orderId === '1001'
    )
  )
  expect(container.draft.cartonChanges).toEqual(
    result.staged.cartonChanges.filter((change) =>
      change.after.contents.some((item) => item.orderId === '1001')
    )
  )
  expect(container.draft.reportChanges).toEqual([])
  expect(container.draft.orders.map((order) => order.orderId)).toEqual(['1001'])
  expect(result.oldReview.canRemove).toBe(false)
  expect(
    result.oldReview.blockers.flatMap((blocker) => blocker.containerNames || [])
  ).toContain('Historical shipment')
})

test('an earlier sealed revision protects a purchase absent from the effective amended shipment', async ({
  extension,
}) => {
  const page = await setup(extension)
  await prepareContainers(page)
  const result = await page.evaluate(async () => {
    const initial = await addDraft('Retained original shipment', [
      '1001',
      '1002',
    ])
    await sealDraft(initial)
    let view = await library.getContainerView({ id: initial.container.id })
    view = await library.beginContainerAmendment({
      id: initial.container.id,
      expectedRevision: view.container.revision,
      reason: 'Synthetic shipment scope correction',
    })
    view = await library.removeContainerOrder({
      id: initial.container.id,
      expectedRevision: view.container.revision,
      orderRef: { accountId: 'local', orderId: '1001' },
    })
    const sealReview = await library.reviewContainerSeal({
      id: initial.container.id,
      expectedRevision: view.container.revision,
    })
    const amended = await library.applyContainerAmendment({
      id: initial.container.id,
      expectedRevision: view.container.revision,
      reviewToken: sealReview.reviewToken,
      reason: 'Synthetic shipment scope correction',
    })
    const before = await library.exportBackup()
    const review = await library.reviewOrderRemoval(['1001', '1003'])
    let error
    try {
      await library.removeOrders(['1001', '1003'])
    } catch (failure) {
      error = failure.code
    }
    return {
      amended,
      review,
      error,
      before,
      after: await library.exportBackup(),
    }
  })
  expect(result.amended.orders.map((order) => order.orderId)).toEqual(['1002'])
  expect(result.review.canRemove).toBe(false)
  expect(
    result.review.blockers.find((blocker) => blocker.kind === 'sealed')
      .containerNames
  ).toEqual(['Retained original shipment'])
  expect(result.error).toBe('ORDER_REMOVAL_BLOCKED')
  expect({ ...result.after, exportedAt: '' }).toEqual({
    ...result.before,
    exportedAt: '',
  })
})

test('a persistence failure rolls back carton retirement, draft detachment and source deletion together', async ({
  extension,
}) => {
  const page = await setup(extension)
  await prepareContainers(page)
  const result = await page.evaluate(async () => {
    await addDraft('Rollback draft', ['1001', '1002'])
    const before = await library.exportBackup()
    const original = IDBObjectStore.prototype.delete
    let error
    IDBObjectStore.prototype.delete = function (key) {
      if (
        this.name === 'preparations' &&
        Array.isArray(key) &&
        key[1] === '1001'
      )
        throw new Error('Synthetic preparation deletion failure')
      return original.call(this, key)
    }
    try {
      await library.removeOrders(['1001', '1003'])
    } catch (failure) {
      error = failure.message
    } finally {
      IDBObjectStore.prototype.delete = original
    }
    return { error, before, after: await library.exportBackup() }
  })
  expect(result.error).toContain('Synthetic preparation deletion failure')
  expect({ ...result.after, exportedAt: '' }).toEqual({
    ...result.before,
    exportedAt: '',
  })
})

test('account-scoped deletion retires only that account’s identically numbered order and cartons', async ({
  extension,
}) => {
  const page = await setup(extension, 'other-account')
  const result = await page.evaluate(async () => {
    const review = await library.reviewOrderRemoval(['1001'], {
      accountId: 'other-account',
    })
    await library.removeOrders(['1001'], { accountId: 'other-account' })
    return {
      review,
      local: await library.getOrder('1001'),
      other: await library.getOrder('1001', { accountId: 'other-account' }),
      after: await library.exportBackup(),
    }
  })
  expect(result.review.accountId).toBe('other-account')
  expect(result.review.cartonBatchCount).toBe(1)
  expect(result.local.snapshot.accountId).toBe('local')
  expect(result.other).toBeUndefined()
  expect(result.after.cartonBatches[0].accountId).toBe('other-account')
  expect(result.after.cartonBatches[0].deletedAt).toBeTruthy()
})
