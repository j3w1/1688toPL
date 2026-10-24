import test from 'node:test'
import assert from 'node:assert/strict'
import {
  allocatePreparation,
  barcodeValue,
  createPreparation,
  setGroupSizeMode,
  validatePreparation,
} from '../src/packing-model.js'
import { createStoreOrder } from '../src/store-order.js'
import { resolvePendingSizeMappings } from '../src/size-vocabulary.js'
import { spreadsheetDeclaration } from '../src/spreadsheet-properties.js'
import { reviewStoreImportCodes } from '../src/store-import-codes.js'

function source(items) {
  return {
    accountId: 'local',
    orderId: '12345',
    sourceType: 'spreadsheet',
    sellerName: 'Synthetic market',
    sellerMemberLogin: 'store:market:1234',
    items: items.map((item, index) => ({
      entryId: String(index + 1),
      title: 'Synthetic cup',
      description: 'Synthetic cup',
      sourceGroup: '1',
      ...item,
    })),
  }
}

test('spreadsheet groups follow explicit markers independently of repeated or differing names', () => {
  const snapshot = source([
    { sourceGroup: '1', title: 'Same title' },
    { sourceGroup: '2', title: 'Same title' },
    { sourceGroup: '1', title: 'Different title' },
  ])
  const original = structuredClone(snapshot)
  const draft = createPreparation(snapshot, '2026-10', [])
  assert.equal(draft.groups.length, 2)
  assert.deepEqual(
    draft.groups[0].variants.flatMap((variant) => variant.entryIds),
    ['1', '3']
  )
  assert.deepEqual(
    draft.groups[1].variants.flatMap((variant) => variant.entryIds),
    ['2']
  )
  assert.equal(draft.groups[0].variants.length, 1)
  assert.deepEqual(snapshot, original)
  const allocated = allocatePreparation(draft, [], [])
  assert.deepEqual(
    allocated.preparation.groups.map((group) =>
      barcodeValue(group, group.variants[0])
    ),
    ['CE26100101', 'CE26100102']
  )
})

test('old source marker codes remain group identities and never become assigned codes', () => {
  const draft = createPreparation(
    source([{ sourceGroup: 'CE25102401' }, { sourceGroup: 'CE25102402' }]),
    '2026-10',
    []
  )
  assert.deepEqual(
    draft.groups.map((group) => group.baseCode),
    ['', '']
  )
  const allocated = allocatePreparation(draft, [], [])
  assert.deepEqual(
    allocated.preparation.groups.map((group) => group.baseCode),
    ['CE26100101', 'CE26100102']
  )
})

test('declared A/B variants and S/M/L sizes retain their explicit barcode endings', () => {
  const items = ['A', 'B'].flatMap((sourceVariant) =>
    ['S', 'M', 'L'].map((sourceSize) => ({
      sourceVariant,
      sourceSize,
      skuProperties: [
        { label: 'Variant', value: sourceVariant },
        { label: 'Size', value: sourceSize },
      ],
    }))
  )
  const draft = createPreparation(source(items), '2026-10', [])
  assert.equal(draft.groups.length, 1)
  assert.deepEqual(
    draft.groups[0].variants.map((variant) => [
      variant.variantSuffix,
      variant.sizeSuffix,
      variant.needsSizeMapping,
    ]),
    [
      ['A', 'S', false],
      ['A', 'M', false],
      ['A', 'L', false],
      ['B', 'S', false],
      ['B', 'M', false],
      ['B', 'L', false],
    ]
  )
  const allocated = allocatePreparation(draft, [], [])
  assert.deepEqual(
    allocated.preparation.groups[0].variants.map((variant) =>
      barcodeValue(allocated.preparation.groups[0], variant)
    ),
    [
      'CE26100101AS',
      'CE26100101AM',
      'CE26100101AL',
      'CE26100101BS',
      'CE26100101BM',
      'CE26100101BL',
    ]
  )
  assert.doesNotThrow(() => validatePreparation(allocated.preparation))
})

test('sized assortment import produces one authoritative group with six distinct codes', async () => {
  const built = await createStoreOrder(
    {
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
      rows: ['S', 'M', 'L'].map((size, index) => ({
        row: index + 3,
        group: '1',
        title: `Cup ${size}`,
        description: `Cup size ${size}`,
        boxes: 1,
        perbox: 10,
        quantity: 10,
        price: '2.00',
        amount: '20.00',
        photos: ['data:image/png;base64,AQID'],
        variants: [
          { variant: 'A', size },
          { variant: 'B', size },
        ],
        variantAllocations: [
          { variant: 'A', size, quantity: 5 },
          { variant: 'B', size, quantity: 5 },
        ],
      })),
    },
    { now: '2026-10-21T12:00:00Z', orderId: '12345' }
  )
  assert.equal(built.snapshot.items.length, 6)
  assert.equal(built.snapshot.totals.payable, '60.00')
  assert.equal(built.snapshot.items.filter((item) => item.carton).length, 3)
  const allocated = allocatePreparation(
    createPreparation(built.snapshot, '2026-10', []),
    [],
    []
  )
  assert.equal(allocated.preparation.groups.length, 1)
  assert.deepEqual(
    allocated.preparation.groups[0].variants.map((variant) =>
      barcodeValue(allocated.preparation.groups[0], variant)
    ),
    [
      'CE26100101AS',
      'CE26100101BS',
      'CE26100101AM',
      'CE26100101BM',
      'CE26100101AL',
      'CE26100101BL',
    ]
  )
})

test('declared A–F are complete endings despite six differing physical size descriptions', () => {
  const snapshot = source(
    ['6', '7', '8', '9', '10', '10'].map((size, index) => ({
      sourceGroup: '5',
      sourceVariant: String.fromCharCode(65 + index),
      sourceRow: index + 17,
      title: `${size}寸合成盘`,
      description: `${size}寸合成盘${index === 4 ? '（深）' : index === 5 ? '（浅）' : ''}`,
      quantity: String([24, 30, 36, 42, 48, 54][index]),
    }))
  )
  const original = structuredClone(snapshot)
  const prepared = allocatePreparation(
    createPreparation(snapshot, '2026-10', []),
    [],
    []
  ).preparation
  const group = prepared.groups[0]
  assert.deepEqual(
    group.variants.map((variant) => barcodeValue(group, variant)),
    ['A', 'B', 'C', 'D', 'E', 'F'].map((ending) => `${group.baseCode}${ending}`)
  )
  assert.deepEqual(
    group.variants.map((variant) => variant.size),
    ['6寸', '7寸', '8寸', '9寸', '10寸', '10寸']
  )
  assert.ok(
    group.variants.every(
      (variant) => !variant.needsSizeMapping && variant.sizeSuffix === ''
    )
  )
  assert.deepEqual(snapshot, original)
})

test('size-only declarations suppress inferred model/color endings and explicit combined endings stay exact', () => {
  const snapshot = source([
    { sourceSize: 'S', description: '20cm 合成杯 红色' },
    { sourceSize: 'M', description: '30cm 合成杯 蓝色' },
    { sourceVariant: 'A', sourceSize: 'S', description: '40cm 合成杯 绿色' },
  ])
  const prepared = allocatePreparation(
    createPreparation(snapshot, '2026-10', []),
    [],
    []
  ).preparation
  const group = prepared.groups[0]
  assert.deepEqual(
    group.variants.map((variant) => barcodeValue(group, variant)),
    ['S', 'M', 'AS'].map((ending) => `${group.baseCode}${ending}`)
  )
  assert.deepEqual(spreadsheetDeclaration(snapshot.items[0]), {
    variantSuffix: '',
    sizeSuffix: 'S',
  })
  assert.equal(
    spreadsheetDeclaration({ sourceGroup: '1', description: 'A 20cm' }),
    null
  )
  assert.equal(spreadsheetDeclaration({ sourceVariant: 'A' }), null)
})

test('identical declarations share one identity while preserving independently accounted source rows', () => {
  const snapshot = source([
    {
      sourceVariant: 'A',
      sourceRow: 17,
      description: '6寸合成盘',
      quantity: '12',
      price: '1.25',
    },
    {
      sourceVariant: 'A',
      sourceRow: 18,
      description: '7寸合成盘',
      quantity: '18',
      price: '1.50',
    },
    {
      sourceVariant: 'B',
      sourceRow: 19,
      description: '8寸合成盘',
      quantity: '24',
      price: '1.75',
    },
  ])
  const original = structuredClone(snapshot)
  const prepared = createPreparation(snapshot, '2026-10', [])
  assert.deepEqual(
    prepared.groups[0].variants.map((variant) => variant.entryIds),
    [['1', '2'], ['3']]
  )
  const none = setGroupSizeMode(prepared, prepared.groups[0].id, 'none')
  const automatic = setGroupSizeMode(none, prepared.groups[0].id, 'automatic', {
    snapshot,
  })
  assert.deepEqual(
    automatic.groups[0].variants.map((variant) => [
      variant.variantSuffix,
      variant.sizeSuffix,
      variant.needsSizeMapping,
    ]),
    [
      ['A', '', false],
      ['B', '', false],
    ]
  )
  assert.deepEqual(snapshot, original)
})

test('blank var rows retain independent automatic size review beside declared rows', () => {
  const snapshot = source([
    { sourceVariant: 'A', description: '6寸合成盘' },
    { description: '7寸合成盘' },
    { description: '8寸合成盘' },
  ])
  const prepared = createPreparation(snapshot, '2026-10', [])
  const [declared, ...inferred] = prepared.groups[0].variants
  assert.equal(declared.variantSuffix, 'A')
  assert.equal(declared.sizeSuffix, '')
  assert.deepEqual(
    inferred.map((variant) => variant.sizeSuffix),
    ['S', 'L']
  )
  assert.ok(inferred.every((variant) => !variant.needsSizeMapping))
})

test('pending resolution honors declarations unless description suggestions are explicitly requested', () => {
  const snapshot = source(
    ['6', '7', '8'].map((size, index) => ({
      sourceVariant: String.fromCharCode(65 + index),
      description: `${size}寸合成盘`,
    }))
  )
  const prepared = createPreparation(snapshot, '2026-10', [])
  const group = prepared.groups[0]
  const inferred = setGroupSizeMode(prepared, group.id, 'automatic', {
    snapshot,
    inferDeclaredSizes: true,
  })
  assert.deepEqual(
    inferred.groups[0].variants.map((variant) => variant.sizeSuffix),
    ['S', 'M', 'L']
  )
  // A saved/edited ending is never silently stripped on ordinary reanalysis.
  assert.deepEqual(
    resolvePendingSizeMappings(inferred, undefined, { snapshot }).preparation,
    inferred
  )
  const pending = structuredClone(prepared)
  pending.groups[0].variants[0].needsSizeMapping = true
  assert.equal(
    resolvePendingSizeMappings(pending, undefined, { snapshot }).preparation
      .groups[0].variants[0].needsSizeMapping,
    false
  )
})

test('reviewed custom endings remain allowed and resetting suggestions restores declarations without clearing authored details', async () => {
  const candidate = await createStoreOrder(
    {
      filename: '1234.xlsx',
      sheetName: 'Products',
      purchaseDate: '2026-10-01',
      store: {
        key: 'market:1234',
        name: 'Synthetic market',
        number: '1234',
        kind: 'market',
      },
      total: '2.00',
      rows: ['6', '7'].map((size, index) => ({
        row: index + 3,
        group: '1',
        title: `${size}寸合成盘`,
        description: `${size}寸合成盘`,
        boxes: 1,
        perbox: 1,
        quantity: 1,
        price: '1.00',
        amount: '1.00',
        photos: ['data:image/png;base64,AQID'],
        variants: [{ variant: index ? 'B' : 'A', size: '' }],
      })),
    },
    { orderId: '12345' }
  )
  const state = {
    records: [],
    preparations: [],
    allocations: [],
    issuedCodes: [],
    batches: [],
    locks: [],
  }
  const initial = reviewStoreImportCodes(state, { candidate })
  const draft = structuredClone(initial.preparation)
  Object.assign(draft.groups[0], {
    spanishName: 'PLATOS SINTETICOS',
    category: '合成盘',
  })
  Object.assign(draft.groups[0].variants[0], {
    variantSuffix: 'Z',
    sizeSuffix: 'XL',
    material: 'Synthetic glass',
    materialSource: 'manual',
  })
  assert.deepEqual(
    reviewStoreImportCodes(state, { candidate, preparation: draft }).issues,
    []
  )
  const reset = reviewStoreImportCodes(state, {
    candidate,
    preparation: draft,
    resetCodes: true,
  })
  assert.deepEqual(reset.issues, [])
  assert.deepEqual(
    reset.preparation.groups[0].variants.map((variant) => [
      variant.variantSuffix,
      variant.sizeSuffix,
    ]),
    [
      ['A', ''],
      ['B', ''],
    ]
  )
  assert.equal(reset.preparation.groups[0].spanishName, 'PLATOS SINTETICOS')
  assert.equal(reset.preparation.groups[0].category, '合成盘')
  assert.equal(
    reset.preparation.groups[0].variants[0].material,
    'Synthetic glass'
  )
})
