import { test, expect } from './extension-fixture.mjs'

test('older local dictionaries upgrade once and preserve overrides, removals and timestamps through reopening and restore', async ({
  extension,
}) => {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  const result = await page.evaluate(async () => {
    const { openDatabase } = await import('/src/database.js')
    const { createPreparation } = await import('/src/packing-model.js')
    const { DEFAULT_VOCABULARY, createNameSuggester } =
      await import('/src/product-vocabulary.js')
    const { MATERIAL_VOCABULARY, createMaterialSuggester } =
      await import('/src/material-vocabulary.js')
    const { COLOR_VOCABULARY } = await import('/src/color-vocabulary.js')
    const { createSizeClassifier } = await import('/src/size-vocabulary.js')
    const name = `synthetic-vocabulary-upgrade-${crypto.randomUUID()}`
    const library = await openDatabase({ name })
    const source = {
      schemaVersion: 1,
      accountId: 'local',
      orderId: '9000100000000001',
      sourceUrl:
        'https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=9000100000000001',
      sellerName: 'Synthetic dictionary supplier',
      sellerMemberLogin: 'synthetic-dictionary-supplier',
      purchasedAt: '2026-01-01T12:00:00+08:00',
      observedAt: '2026-01-01T12:00:00.000Z',
      status: 'Completed',
      items: [
        {
          entryId: '9000100000000002',
          title: '合成 长毛绒圣诞帽',
          thumbnail: '',
          description: '合成 长毛绒圣诞帽',
          productNumber: 'SYNTHETIC-HAT-01',
          quantity: '3',
          price: '2.00',
          sourceDiscount: '0.00',
          allocatedDiscount: '0.00',
          discount: '0.00',
        },
      ],
      totals: {
        goodsGross: '6.00',
        sourceDiscount: '0.00',
        orderAdjustment: '0.00',
        goodsNet: '6.00',
        shipping: '0.00',
        payable: '6.00',
      },
    }
    await library.saveSnapshot(source)
    const draft = createPreparation(source, '2026-01')
    draft.groups[0].spanishName = 'OWNER NAME'
    draft.groups[0].category = ''
    draft.groups[0].naming = {
      spanishName: { source: 'manual', value: 'OWNER NAME' },
      category: { source: 'manual', value: '' },
    }
    draft.groups[0].variants[0].material = ''
    draft.groups[0].variants[0].materialSource = 'manual'
    await library.savePreparation(draft)
    const originalPreparation = await library.getPreparation(source.orderId)
    const oldCurtain = structuredClone(
      DEFAULT_VOCABULARY.find((entry) => entry.seed === 'curtain')
    )
    delete oldCurtain.exclude
    const bamboo = structuredClone(
      MATERIAL_VOCABULARY.find((entry) => entry.id === 'bamboo-wood')
    )
    bamboo.aliases = ['竹木']
    const previousTimestamp = '2026-01-02T03:04:05.000Z'
    await library.restoreBackup({
      format: '1688-order-library',
      version: 2,
      exportedAt: previousTimestamp,
      orders: [],
      history: [],
      images: [],
      preparations: [],
      allocations: [],
      issuedCodes: [],
      packingPreferences: {
        id: 'packing',
        updatedAt: previousTimestamp,
        value: {
          settings: { vocabularyInitialized: true, vocabularyVersion: 1 },
          vocabulary: [
            oldCurtain,
            { match: '合成自定义帽', spanishName: 'MI NOMBRE', category: '' },
          ],
          materialVocabulary: [bamboo],
          colorVocabulary: [
            COLOR_VOCABULARY.find((entry) => entry.id === 'red'),
          ],
          sizeVocabulary: [
            { match: 'S|小号|小码|小尺寸|小', suffix: 'S' },
            { match: 'L|大号|大码|大尺寸|大', suffix: 'L' },
          ],
        },
      },
    })
    const updated = await library.getPackingPreferences()
    const backup = await library.exportBackup()
    library.close()
    const reopened = await openDatabase({ name })
    const reopenedPreferences = await reopened.getPackingPreferences()
    const reopenedPreparation = await reopened.getPreparation(source.orderId)
    reopened.close()
    const restored = await openDatabase({ name: `${name}-restored` })
    await restored.restoreBackup(backup)
    const restoredPreferences = await restored.getPackingPreferences()
    const restoredBackup = await restored.exportBackup()
    const restoredPreparation = await restored.getPreparation(source.orderId)
    restored.close()
    return {
      updated,
      reopenedPreferences,
      restoredPreferences,
      originalPreparation,
      reopenedPreparation,
      restoredPreparation,
      beforeTimestamp: previousTimestamp,
      updatedTimestamp: backup.packingPreferences.updatedAt,
      restoredTimestamp: restoredBackup.packingPreferences.updatedAt,
      name: createNameSuggester(updated.vocabulary)('合成 长毛绒圣诞帽'),
      custom: createNameSuggester(updated.vocabulary)('合成自定义帽'),
      material: createMaterialSuggester(updated.materialVocabulary)({
        title: '合成 PC挂件',
      }),
      sizes: createSizeClassifier(updated.sizeVocabulary)
        .suggest(['short', 'long'])
        .map((entry) => entry.sizeSuffix),
      orderCount: backup.orders.length,
    }
  })
  expect(result.name).toMatchObject({
    spanishName: 'GORRO NAVIDENO',
    category: '圣诞帽',
  })
  expect(result.custom.spanishName).toBe('MI NOMBRE')
  expect(result.custom.category).toBe('')
  expect(result.material).toBe('PC')
  expect(result.sizes).toEqual(['S', 'L'])
  expect(
    result.updated.materialVocabulary.some((entry) => entry.id === 'glass')
  ).toBe(false)
  expect(
    result.updated.colorVocabulary.some((entry) => entry.id === 'glitter')
  ).toBe(true)
  expect(result.reopenedPreferences).toEqual(result.updated)
  expect(result.restoredPreferences).toEqual(result.updated)
  expect(result.updatedTimestamp).toBe(result.beforeTimestamp)
  expect(result.restoredTimestamp).toBe(result.beforeTimestamp)
  expect(result.orderCount).toBe(1)
  expect(result.reopenedPreparation).toEqual(result.originalPreparation)
  expect(result.restoredPreparation).toEqual(result.originalPreparation)
  await page.close()
})
