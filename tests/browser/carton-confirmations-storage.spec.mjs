import { test, expect } from './extension-fixture.mjs'

function snapshot(accountId = 'local') {
  return {
    schemaVersion: 1,
    accountId,
    orderId: '1001',
    sourceUrl:
      'https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=1001',
    sellerName: 'Synthetic confirmation supplier',
    sellerMemberLogin: 'synthetic-confirmation-supplier',
    status: 'Completed',
    purchasedAt: '2026-10-01T12:00:00+08:00',
    observedAt: '2026-10-01T12:00:00.000Z',
    items: ['Cup', 'Bowl', 'Plate'].map((title, index) => ({
      entryId: String(index + 1),
      title,
      description: title,
      thumbnail: '',
      price: '10.00',
      quantity: '10',
      sourceDiscount: '0.00',
      allocatedDiscount: '0.00',
      discount: '0.00',
    })),
    totals: {
      goodsGross: '300.00',
      shipping: '0.00',
      sourceDiscount: '0.00',
      orderAdjustment: '0.00',
      goodsNet: '300.00',
      payable: '300.00',
    },
  }
}

async function databasePage(extension) {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  await page.evaluate(async () => {
    window.openOrderDatabase = (await import('/src/database.js')).openDatabase
    window.databaseName = `synthetic-confirmations-${crypto.randomUUID()}`
    window.library = await openOrderDatabase({ name: databaseName })
    // Explicit pre-SEAL v3 fixture: source, monthly annotations and allocated
    // preparation only. This is never a downgraded/stripped v5 export. V3
    // predates persisted cartonBatches and operational shipment stores.
    window.legacyConfirmationArchive = async (
      snapshot,
      confirmations,
      images = []
    ) => {
      const { allocatePreparation, createPreparation } =
        await import('/src/packing-model.js')
      const allocated = allocatePreparation(
        createPreparation(snapshot, '2026-10'),
        [],
        [],
        { snapshot }
      )
      return {
        format: '1688-order-library',
        version: 3,
        exportedAt: '2026-10-15T12:00:00.000Z',
        orders: [
          {
            snapshot,
            revision: 1,
            changedAt: snapshot.observedAt,
            lastCheckedAt: snapshot.observedAt,
            notes: '',
            tags: [],
            changedEntryIds: [],
            removedEntryIds: [],
            cartonConfirmations: confirmations,
            cartonConfirmationClocks: Object.fromEntries(
              Object.entries(confirmations).map(([id, months]) => [
                id,
                Object.fromEntries(
                  Object.keys(months).map((month) => [
                    month,
                    '2026-10-15T12:00:00.000Z',
                  ])
                ),
              ])
            ),
          },
        ],
        history: [],
        images,
        preparations: [
          {
            ...allocated.preparation,
            revision: 1,
            updatedAt: snapshot.observedAt,
          },
        ],
        allocations: allocated.allocations,
        issuedCodes: allocated.issuedCodes,
      }
    }
  })
  return page
}

test('legacy confirmation evidence preserves zero, refresh, reopening and newer archived clears', async ({
  extension,
}) => {
  const page = await databasePage(extension)
  const result = await page.evaluate(async (source) => {
    await library.restoreBackup(
      await legacyConfirmationArchive(source, {
        1: {
          '2026-10': { received: 0, loaded: 3 },
          '2026-11': { received: 8 },
        },
      })
    )
    await library.saveSnapshot({ ...source, accountId: 'other-account' })
    const beforeRefresh = await library.getOrder('1001')
    await library.saveSnapshot({
      ...source,
      status: 'Awaiting shipment',
      observedAt: '2026-10-02T12:00:00.000Z',
    })
    const refreshed = await library.getOrder('1001')
    library.close()
    window.library = await openOrderDatabase({ name: databaseName })
    const reopened = await library.getOrder('1001')
    const backup = await library.exportBackup()
    const target = await openOrderDatabase({ name: databaseName + '-restored' })
    await target.restoreBackup(backup)
    const restored = await target.getOrder('1001')
    const newer = structuredClone(backup)
    const record = newer.orders.find(
      (value) => value.snapshot.accountId === 'local'
    )
    record.cartonConfirmations = { 1: { '2026-11': { received: 8 } } }
    record.cartonConfirmationClocks['1']['2026-10'] = new Date(
      Date.now() + 1000
    ).toISOString()
    await target.restoreBackup(newer)
    const cleared = await target.getOrder('1001')
    await target.restoreBackup(backup)
    const afterOldRestore = await target.getOrder('1001')
    const other = await target.getOrder('1001', { accountId: 'other-account' })
    const copy = await openOrderDatabase({ name: databaseName + '-copy' })
    await copy.restoreBackup(await target.exportBackup())
    const copied = await copy.getOrder('1001')
    copy.close()
    target.close()
    library.close()
    return {
      beforeRefresh,
      refreshed,
      reopened,
      restored,
      cleared,
      afterOldRestore,
      other,
      copied,
    }
  }, snapshot())
  expect(result.beforeRefresh.cartonConfirmations).toEqual({
    1: { '2026-10': { received: 0, loaded: 3 }, '2026-11': { received: 8 } },
  })
  expect(result.refreshed.cartonConfirmations).toEqual(
    result.beforeRefresh.cartonConfirmations
  )
  expect(result.refreshed.cartonConfirmationClocks).toEqual(
    result.beforeRefresh.cartonConfirmationClocks
  )
  expect(result.reopened).toEqual(result.refreshed)
  expect(result.restored).toEqual(result.refreshed)
  expect(result.cleared.cartonConfirmations).toEqual({
    1: { '2026-11': { received: 8 } },
  })
  expect(result.afterOldRestore).toEqual(result.cleared)
  expect(result.other.cartonConfirmations).toBeUndefined()
  expect(result.copied).toEqual(result.cleared)
})

test('legacy scoped confirmations preserve other products, months and accounts while physical scope requires complete orders', async ({
  extension,
}) => {
  const page = await databasePage(extension)
  const result = await page.evaluate(async (source) => {
    const { validateBackup } = await import('/src/database.js')
    const { createPackingBackup } = await import('/src/packing-backup.js')
    const legacy = await legacyConfirmationArchive(source, {
      2: { '2026-10': { received: 4 }, '2026-11': { received: 6 } },
      3: { '2026-10': { received: 5 } },
    })
    validateBackup(legacy)
    await library.restoreBackup(legacy)
    const full = await library.exportBackup()
    const scope = {
      months: ['2026-10'],
      orders: [{ orderId: '1001', entryIds: ['2'] }],
    }
    let refusal
    try {
      await library.exportBackup({ packingScope: scope })
    } catch (error) {
      refusal = { code: error.code, requiredOrderRefs: error.requiredOrderRefs }
    }
    const afterRefusal = await library.exportBackup()
    const complete = createPackingBackup(full, {
      ...scope,
      orders: [{ orderId: '1001', entryIds: ['1', '2', '3'] }],
    })
    validateBackup(complete)
    const completeTarget = await openOrderDatabase({
      name: databaseName + '-complete',
    })
    await completeTarget.restoreBackup(complete)
    const completeRoundTrip = await completeTarget.exportBackup()
    completeTarget.close()
    const scoped = createPackingBackup(legacy, scope)
    validateBackup(scoped)
    const target = await openOrderDatabase({ name: databaseName + '-target' })
    const initial = await legacyConfirmationArchive(source, {
      1: { '2026-10': { loaded: 7 } },
      2: { '2026-11': { received: 9 } },
    })
    initial.preparations = []
    initial.allocations = []
    initial.issuedCodes = []
    initial.orders[0].cartonConfirmationClocks['2']['2026-11'] =
      '2026-10-16T12:00:00.000Z'
    await target.restoreBackup(initial)
    const otherArchive = await legacyConfirmationArchive(
      { ...source, accountId: 'other-account' },
      { 2: { '2026-10': { received: 10 } } }
    )
    await target.restoreBackup(otherArchive)
    const other = await target.getOrder('1001', { accountId: 'other-account' })
    await target.restoreBackup(scoped)
    const restored = await target.getOrder('1001')
    const otherAfter = await target.getOrder('1001', {
      accountId: 'other-account',
    })
    const newer = await target.exportBackup()
    const owner = newer.orders.find(
      (record) => record.snapshot.accountId === 'local'
    )
    delete owner.cartonConfirmations['2']['2026-10']
    owner.cartonConfirmationClocks['2']['2026-10'] = new Date(
      Date.now() + 1000
    ).toISOString()
    await target.restoreBackup(newer)
    const cleared = await target.getOrder('1001')
    await target.restoreBackup(full)
    const completed = await target.getOrder('1001')
    await target.restoreBackup(scoped)
    const repeated = await target.getOrder('1001')
    target.close()
    library.close()
    return {
      full,
      refusal,
      afterRefusal,
      complete,
      completeRoundTrip,
      scoped,
      restored,
      other,
      otherAfter,
      cleared,
      completed,
      repeated,
    }
  }, snapshot())
  expect(result.refusal).toMatchObject({
    code: 'PACKING_BACKUP_DEPENDENCY_REVIEW',
    requiredOrderRefs: [{ accountId: 'local', orderId: '1001' }],
  })
  for (const field of Object.keys(result.full).filter(
    (key) => key !== 'exportedAt'
  ))
    expect(result.afterRefusal[field], field).toEqual(result.full[field])
  for (const field of ['orders', 'cartonBatches', 'images'])
    expect(result.completeRoundTrip[field], field).toEqual(
      result.complete[field]
    )
  expect(result.scoped.version).toBe(4)
  expect(result.scoped.orders[0].cartonConfirmations).toEqual({
    2: { '2026-10': { received: 4 } },
  })
  expect(Object.keys(result.scoped.orders[0].cartonConfirmationClocks)).toEqual(
    ['2']
  )
  expect(
    Object.keys(result.scoped.orders[0].cartonConfirmationClocks['2'])
  ).toEqual(['2026-10'])
  expect(result.restored.cartonConfirmations).toEqual({
    1: { '2026-10': { loaded: 7 } },
    2: { '2026-10': { received: 4 }, '2026-11': { received: 9 } },
  })
  expect(result.otherAfter).toEqual(result.other)
  expect(result.completed.cartonConfirmations).toEqual({
    1: { '2026-10': { loaded: 7 } },
    2: { '2026-11': { received: 9 } },
    3: { '2026-10': { received: 5 } },
  })
  expect(result.repeated).toEqual(result.completed)
  expect(result.completed.cartonConfirmationClocks['2']['2026-10']).toBe(
    result.cleared.cartonConfirmationClocks['2']['2026-10']
  )
})

test('shared supplier rows keep one legacy confirmation owner and partial variants cannot duplicate carton evidence', async ({
  extension,
}) => {
  const page = await databasePage(extension)
  const result = await page.evaluate(async () => {
    const { validateBackup } = await import('/src/database.js')
    const { createPackingBackup } = await import('/src/packing-backup.js')
    const first = await library.importStoreOrder({
      filename: '4321.xlsx',
      sheetName: 'Order',
      purchaseDate: '2026-10-01',
      store: {
        key: 'market:4321',
        name: 'Synthetic shared carton store',
        number: '4321',
        kind: 'market',
      },
      total: '100.00',
      rows: [
        {
          row: 5,
          group: '1',
          description: 'Synthetic assortment',
          boxes: 2,
          perbox: 5,
          quantity: 10,
          price: '10.00',
          amount: '100.00',
          photos: ['data:image/png;base64,AQID'],
          variants: [{ variant: 'A' }, { variant: 'B' }],
          variantAllocations: [
            { variant: 'A', quantity: 3 },
            { variant: 'B', quantity: 7 },
          ],
        },
      ],
    })
    const { createPreparation } = await import('/src/packing-model.js')
    await library.savePreparation(createPreparation(first.snapshot, '2026-10'))
    const backup = await library.exportBackup()
    const legacy = await legacyConfirmationArchive(
      first.snapshot,
      { 1: { '2026-10': { received: 2, loaded: 1 } } },
      backup.images
    )
    validateBackup(legacy)
    const scope = (entryIds) => ({
      months: ['2026-10'],
      orders: [{ orderId: first.snapshot.orderId, entryIds }],
    })
    let refusal
    try {
      await library.exportBackup({ packingScope: scope(['2']) })
    } catch (error) {
      refusal = error.code
    }
    const afterRefusal = await library.exportBackup()
    const partial = createPackingBackup(legacy, scope(['2']))
    const complete = createPackingBackup(legacy, scope(['1', '2']))
    validateBackup(partial)
    validateBackup(complete)
    const target = await openOrderDatabase({ name: databaseName + '-target' })
    await target.restoreBackup(partial)
    const partialRestored = await target.getOrder(first.snapshot.orderId)
    await target.restoreBackup(complete)
    const restored = await target.getOrder(first.snapshot.orderId)
    const roundTrip = await target.exportBackup()
    target.close()
    library.close()
    return {
      backup,
      afterRefusal,
      partial,
      complete,
      partialRestored,
      restored,
      roundTrip,
      refusal,
    }
  })
  expect(result.refusal).toBe('PACKING_BACKUP_DEPENDENCY_REVIEW')
  for (const field of Object.keys(result.backup).filter(
    (key) => key !== 'exportedAt'
  ))
    expect(result.afterRefusal[field], field).toEqual(result.backup[field])
  expect(result.partial.orders[0].cartonConfirmations).toEqual({})
  expect(result.partial.orders[0].cartonConfirmationClocks).toEqual({})
  expect(result.partialRestored.cartonConfirmations || {}).toEqual({})
  expect(result.restored.cartonConfirmations).toEqual({
    1: { '2026-10': { received: 2, loaded: 1 } },
  })
  expect(result.roundTrip.orders[0].cartonConfirmations).toEqual(
    result.restored.cartonConfirmations
  )
})
