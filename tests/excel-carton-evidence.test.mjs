import test from 'node:test'
import assert from 'node:assert/strict'
import { enrichExcelRows } from '../src/excel-carton-evidence.js'
import { physicalUnitId } from '../src/inventory-model.js'
import {
  syntheticBatch,
  syntheticOrder,
} from './fixtures/container-fixture.mjs'
import { databaseBrowser } from './fixtures/database-browser.mjs'
import {
  createPreparation,
  validatePackingPreferences,
} from '../src/packing-model.js'
import {
  captureContainerOrder,
  projectContainer,
} from '../src/container-model.js'

const row = (overrides = {}) => ({
  accountId: 'local',
  orderId: '1001',
  entryId: '2001',
  quantity: '30',
  price: '7.25',
  ...overrides,
})
const evidence = (batches, containers = []) => ({
  orders: [{ accountId: 'local', orderId: '1001', batches }],
  containers,
})
const batch = (overrides = {}) =>
  syntheticBatch('1001', 3, '30', {
    len: '60',
    wid: '40',
    ht: '30',
    weight: '12',
    received: null,
    ...overrides,
  })

function frozenManifest(overrides = {}) {
  const record = syntheticOrder('1001', '30')
  const preparation = createPreparation(record.snapshot, '2026-09')
  preparation.revision = 1
  preparation.groups[0].baseCode = 'CE26090101'
  preparation.groups[0].spanishName = 'VASOS'
  preparation.groups[0].category = '杯'
  const physical = batch({
    groups: [{ orderId: '1001', groupId: preparation.groups[0].id }],
    mark: { orderId: '1001', groupId: preparation.groups[0].id },
    ...overrides,
  })
  const state = {
    records: [record],
    preparations: [preparation],
    batches: [physical],
    containers: [],
    reports: [],
    preferences: validatePackingPreferences({}),
  }
  const container = {
    id: 'excel-container',
    accountId: 'local',
    name: 'Synthetic selection',
    period: '2026-10',
    loadingDate: '2026-10-20',
    revision: 1,
    status: 'draft',
    revisions: [],
    draft: { orders: [], decisions: {} },
  }
  container.draft.orders.push(
    captureContainerOrder(
      state,
      { accountId: 'local', orderId: '1001' },
      container.id
    )
  )
  container.draft.decisions = Object.fromEntries(
    container.draft.orders[0].cartons.map((unit, index) => [
      unit.id,
      index === 0 ? 'loaded' : 'left-behind',
    ])
  )
  return { ...projectContainer(state, container), kind: 'container-revision' }
}

test('equal linked physical measurements collapse without repeating source quantities or prices', () => {
  const source = row(),
    facts = evidence([batch()])
  const [result] = enrichExcelRows([source], facts)
  assert.equal(result.cartonDimensions, '60 × 40 × 30')
  assert.equal(result.cartonWeight, '12')
  assert.equal(result.cartonVolume, '0.072')
  assert.equal(result.plannedBoxes, '3')
  assert.equal(result.cartonMeasurementGroups.length, 1)
  assert.equal(result.cartonMeasurementGroups[0].count, 3)
  assert.equal(result.cartonMeasurementGroups[0].references.length, 3)
  assert.equal(result.unitsPerCarton, '10')
  assert.equal(result.cartonNumericValues.cartonWeight, '12')
  assert.equal(result.cartonNumericValues.cartonVolume, '0.072')
  assert.equal(result.quantity, '30')
  assert.equal(result.price, '7.25')
  assert.deepEqual(source, row())
})

test('weight differences and exact unit exceptions produce aligned labeled groups', () => {
  const original = batch({
    unitMeasurements: {
      1: { weight: '13.00' },
      2: { len: '50', weight: '12.0' },
    },
    unitLabels: { 0: 'Carton A', 1: 'Carton B', 2: 'Carton C' },
  })
  const [result] = enrichExcelRows([row()], evidence([original]))
  assert.equal(result.cartonMeasurementGroups.length, 3)
  assert.deepEqual(result.cartonNumericValues, {})
  assert.equal(
    result.cartonDimensions,
    '1 · 60 × 40 × 30 cm\n2 · 60 × 40 × 30 cm\n3 · 50 × 40 × 30 cm'
  )
  assert.equal(
    result.cartonWeight,
    '1 · 12 kg · per carton\n2 · 13 kg · per carton\n3 · 12 kg · per carton'
  )
  assert.match(
    result.cartonReferences,
    /^1 · Carton A · 1 cartons\n2 · Carton B/m
  )
  assert.deepEqual(original.unitMeasurements[1], { weight: '13.00' })
})

test('normalized equivalent decimals collapse; absent measurements do not become zero', () => {
  const [result] = enrichExcelRows(
    [row()],
    evidence([
      batch({ weight: '12.00', unitMeasurements: { 1: { weight: '12.000' } } }),
    ])
  )
  assert.equal(result.cartonMeasurementGroups.length, 1)
  const [missing] = enrichExcelRows([row()], evidence([batch({ weight: '' })]))
  assert.equal(missing.cartonWeight, '')
  assert.equal(missing.receivedBoxes, '')
  assert.equal(missing.loadedBoxes, '')
})

test('a large identical carton set retains every identity while keeping the visible row compact', () => {
  const [result] = enrichExcelRows(
    [row({ quantity: '100000' })],
    evidence([
      batch({
        count: 10000,
        contents: [{ orderId: '1001', entryId: '2001', quantity: '100000' }],
      }),
    ])
  )
  assert.equal(result.cartonMeasurementGroups.length, 1)
  assert.equal(result.physicalCartonIds.length, 10000)
  assert.equal(result.cartonMeasurementGroups[0].references.length, 10000)
  assert.ok(result.cartonReferences.length < 150)
  assert.match(result.cartonReferences, /1\.1–Internal 1\.10000/)
  assert.equal(result.plannedBoxes, '10000')
})

test('shared boxes show whole physical measurements without allocating their kg to source rows', () => {
  const shared = batch({
    contents: [
      { orderId: '1001', entryId: '2001', quantity: '15' },
      { orderId: '1001', entryId: '2002', quantity: '15' },
    ],
  })
  const results = enrichExcelRows(
    [row({ quantity: '15' }), row({ entryId: '2002', quantity: '15' })],
    evidence([shared])
  )
  for (const result of results) {
    assert.equal(result.cartonWeight, '12')
    assert.equal(result.cartonDimensions, '60 × 40 × 30 · shared')
    assert.equal(result.cartonSharedLabel, 'shared')
    assert.equal(result.cartonNumericValues.cartonWeight, '12')
    assert.match(result.cartonReferences, /shared/)
    assert.deepEqual(result.physicalCartonIds, results[0].physicalCartonIds)
    assert.equal(result.quantity, '15')
  }
})

test('shared measurement markers remain visible without the optional references column in each language', () => {
  const shared = batch({
    contents: [
      { orderId: '1001', entryId: '2001', quantity: '15' },
      { orderId: '1001', entryId: '2002', quantity: '15' },
    ],
  })
  for (const [language, marker] of [
    ['en', 'shared'],
    ['es', 'compartida'],
    ['zh', '共箱'],
  ]) {
    const [uniform] = enrichExcelRows(
      [row({ quantity: '15' })],
      evidence([shared]),
      { language }
    )
    assert.equal(uniform.cartonSharedLabel, marker)
    assert.equal(uniform.cartonDimensions, `60 × 40 × 30 · ${marker}`)
    assert.equal(uniform.cartonWeight, '12')
    assert.equal(uniform.cartonVolume, '0.072')
    assert.equal(uniform.cartonNumericValues.cartonWeight, '12')
    const [mixed] = enrichExcelRows(
      [row({ quantity: '15' })],
      evidence([{ ...shared, unitMeasurements: { 1: { weight: '13' } } }]),
      { language }
    )
    for (const value of [
      mixed.cartonDimensions,
      mixed.cartonWeight,
      mixed.cartonVolume,
    ])
      assert.ok(value.split('\n').every((line) => line.endsWith(marker)))
    assert.equal(mixed.cartonNumericValues.cartonWeight, undefined)
  }
  const [ordinary] = enrichExcelRows([row()], evidence([batch()]))
  assert.equal(ordinary.cartonSharedLabel, '')
  assert.equal(ordinary.cartonDimensions, '60 × 40 × 30')
})

test('an aggregate retains total basis rather than dividing weight or guessing product membership', () => {
  const [result] = enrichExcelRows(
    [row()],
    evidence([
      batch({
        packingBasis: 'aggregate',
        weight: '40',
        weightBasis: 'batch',
        suppliedCbm: '0.2',
        volumeBasis: 'batch',
        len: '',
        wid: '',
        ht: '',
      }),
    ])
  )
  assert.equal(result.cartonWeight, '40 · batch total')
  assert.equal(result.cartonVolume, '0.2 · batch total')
  assert.equal(result.plannedBoxes, '')
  assert.equal(result.physicalCartonReview, true)
  assert.equal(result.cartonMeasurementGroups[0].ambiguousContents, true)
  assert.equal(result.cartonNumericValues.cartonWeight, undefined)
})

test('uniform contents preserve whole-batch weight and aggregate measurement exceptions stay visible', () => {
  const [uniform] = enrichExcelRows(
    [row()],
    evidence([batch({ weightBasis: 'batch', weight: '40' })])
  )
  assert.equal(uniform.cartonWeight, '40 · batch total')
  assert.equal(uniform.cartonNumericValues.cartonWeight, undefined)
  assert.equal(uniform.unitsPerCarton, '10')
  const [exceptions] = enrichExcelRows(
    [row()],
    evidence([
      batch({
        packingBasis: 'aggregate',
        weightBasis: 'batch',
        weight: '40',
        unitMeasurements: { 1: { len: '50', weight: '13' } },
      }),
    ])
  )
  assert.match(exceptions.cartonDimensions, /50 × 40 × 30/)
  assert.match(exceptions.cartonWeight, /13 kg/)
  assert.match(exceptions.cartonWeight, /40 kg · batch total/)
  assert.equal(exceptions.plannedBoxes, '')
  assert.equal(exceptions.unitsPerCarton, '')
})

test('missing, deleted and foreign-account facts never populate the selected purchase row', () => {
  const [result] = enrichExcelRows(
    [row()],
    evidence([
      batch({ accountId: 'other', weight: '999' }),
      batch({ deletedAt: '2026-10-24T01:00:00.000Z', weight: '888' }),
      batch({
        contents: [{ orderId: '1002', entryId: '2001', quantity: '30' }],
        weight: '777',
      }),
    ])
  )
  assert.equal(result.cartonWeight, '')
  assert.equal(result.plannedBoxes, '')
  assert.deepEqual(result.physicalCartonIds, [])
})

test('one source row linked to only some explicit units retains only those carton measurements', () => {
  const [result] = enrichExcelRows(
    [row()],
    evidence([
      batch({
        packingBasis: 'aggregate',
        unitContents: {
          0: [{ orderId: '1001', entryId: '2001', quantity: '10' }],
          1: [{ orderId: '1001', entryId: '2002', quantity: '10' }],
          2: [{ orderId: '1001', entryId: '2001', quantity: '10' }],
        },
        unitMeasurements: { 1: { weight: '999' } },
      }),
    ])
  )
  assert.equal(result.cartonWeight, '12')
  assert.equal(result.plannedBoxes, '2')
  assert.equal(result.physicalCartonIds.length, 2)
})

test('known zero and partial receipt measurements remain distinguishable from unknown', () => {
  const [zero] = enrichExcelRows(
    [row()],
    evidence([batch({ received: 0, weight: '' })])
  )
  assert.equal(zero.receivedBoxes, '0')
  assert.equal(zero.receivedWeight, '0')
  const [uniform] = enrichExcelRows([row()], evidence([batch({ received: 2 })]))
  assert.equal(uniform.receivedBoxes, '2')
  assert.equal(uniform.receivedWeight, '24')
  const [different] = enrichExcelRows(
    [row()],
    evidence([
      batch({ received: 2, unitMeasurements: { 1: { weight: '13' } } }),
    ])
  )
  assert.equal(different.receivedBoxes, '2')
  assert.equal(different.receivedWeight, '')
})

test('loading uses physical container decisions and preserves unknown measurement coverage', () => {
  const own = batch(),
    units = [0, 1, 2].map((index) => ({ id: physicalUnitId(own.id, index) }))
  const container = {
    id: 'test-container',
    status: 'draft',
    draft: {
      orders: [{ accountId: 'local', orderId: '1001', cartons: units }],
      decisions: {
        [units[0].id]: 'loaded',
        [units[1].id]: 'left-behind',
        [units[2].id]: 'loaded',
      },
    },
  }
  const [result] = enrichExcelRows([row()], evidence([own], [container]))
  assert.equal(result.loadedBoxes, '2')
  assert.equal(result.loadedWeight, '24')
  delete container.draft.decisions[units[2].id]
  const [pending] = enrichExcelRows([row()], evidence([own], [container]))
  assert.equal(pending.loadedBoxes, '')
  assert.equal(pending.loadedWeight, '')
})

test('container frozen units use their captured facts and filter source identities', () => {
  const [result] = enrichExcelRows([row()], {
    cartons: [
      {
        id: 'frozen',
        batchId: 'old-batch',
        index: 0,
        accountId: 'local',
        orderId: '1001',
        contents: [{ orderId: '1001', entryId: '2001', quantity: '30' }],
        len: '20',
        wid: '30',
        ht: '40',
        weight: '5.5',
        volume: '0.024',
        state: 'loaded',
        reference: 'Historical box',
        labelOrigin: 'reported',
      },
    ],
  })
  assert.equal(result.cartonDimensions, '20 × 30 × 40')
  assert.equal(result.cartonWeight, '5.5')
  assert.equal(result.loadedWeight, '5.5')
  assert.match(result.cartonReferences, /Historical box/)
})

test('a complete projected manifest uses its selected loaded side even though it retains whole-order batches', () => {
  const manifest = frozenManifest({
    unitMeasurements: { 1: { weight: '13' }, 2: { weight: '14' } },
  })
  assert.equal(manifest.orders.length, 1)
  assert.equal(manifest.orders[0].batches[0].count, 3)
  assert.equal(manifest.cartons.length, 3)
  const [loaded] = enrichExcelRows(manifest.products, manifest)
  assert.equal(loaded.quantity, '10')
  assert.equal(loaded.plannedBoxes, '1')
  assert.equal(loaded.loadedBoxes, '1')
  assert.equal(loaded.loadedWeight, '12')
  assert.equal(loaded.cartonWeight, '12')
  assert.deepEqual(
    loaded.physicalCartonIds,
    manifest.products[0].cartonReferences
  )
  assert.equal(loaded.cartonReferences.includes('1.2'), false)

  const [left] = enrichExcelRows(manifest.leftBehind.products, {
    ...manifest,
    outputSide: 'left-behind',
  })
  assert.equal(left.quantity, '20')
  assert.equal(left.plannedBoxes, '2')
  assert.equal(left.loadedBoxes, '0')
  assert.equal(left.loadedWeight, '0')
  assert.match(left.cartonWeight, /13 kg/)
  assert.match(left.cartonWeight, /14 kg/)
  assert.equal(
    left.physicalCartonIds.includes(loaded.physicalCartonIds[0]),
    false
  )
})

test('frozen carton selection and account scope cannot fall back to broader live order facts', () => {
  const manifest = frozenManifest({
    unitMeasurements: { 1: { weight: '13' }, 2: { weight: '14' } },
  })
  const selectedId = manifest.leftBehind.cartons[1].id
  const [selected] = enrichExcelRows(
    [{ ...manifest.leftBehind.products[0], cartonId: selectedId }],
    { ...manifest, outputSide: 'left-behind', partial: true }
  )
  assert.equal(selected.plannedBoxes, '1')
  assert.equal(selected.cartonWeight, '14')
  assert.deepEqual(selected.physicalCartonIds, [selectedId])

  const [foreign] = enrichExcelRows(
    [{ ...manifest.products[0], accountId: 'other' }],
    manifest
  )
  assert.equal(foreign.plannedBoxes, '')
  assert.equal(foreign.cartonWeight, '')

  const [empty] = enrichExcelRows(manifest.products, {
    ...manifest,
    cartons: [],
  })
  assert.equal(empty.plannedBoxes, '')
  assert.equal(empty.loadedBoxes, '')
  assert.deepEqual(empty.physicalCartonIds, [])
})

test('frozen partial aggregate-basis measurements stay unknown instead of using the whole batch total', () => {
  const manifest = frozenManifest({
    weightBasis: 'batch',
    weight: '40',
    received: 3,
  })
  const [loaded] = enrichExcelRows(manifest.products, manifest)
  assert.equal(loaded.plannedBoxes, '1')
  assert.equal(loaded.loadedBoxes, '1')
  assert.equal(loaded.loadedWeight, '')
  assert.equal(loaded.cartonWeight, '')
  assert.equal(loaded.cartonNumericValues.cartonWeight, undefined)

  const allLoaded = {
    ...manifest,
    products: [
      {
        ...manifest.orders[0].record.snapshot.items[0],
        ...row(),
        cartonReferences: manifest.cartons.map((unit) => unit.id),
      },
    ],
    cartons: manifest.cartons.map((unit) => ({ ...unit, state: 'loaded' })),
  }
  const [whole] = enrichExcelRows(allLoaded.products, allLoaded)
  assert.equal(whole.loadedBoxes, '3')
  assert.equal(whole.loadedWeight, '40')
  assert.equal(whole.cartonWeight, '40 · batch total')
  assert.equal(whole.cartonNumericValues.cartonWeight, undefined)
})

test('effective sealed facts stay loaded while an amendment has unconfirmed draft decisions', () => {
  const own = batch(),
    units = [0, 1, 2].map((index) => ({ id: physicalUnitId(own.id, index) }))
  const container = {
    id: 'amending',
    status: 'amending',
    effectiveRevisionId: 'sealed-1',
    revisions: [{ revisionId: 'sealed-1', cartons: units }],
    draft: {
      orders: [{ accountId: 'local', orderId: '1001', cartons: units }],
      decisions: {},
    },
  }
  const [result] = enrichExcelRows([row()], evidence([own], [container]))
  assert.equal(result.loadedBoxes, '3')
  assert.equal(result.loadedWeight, '36')
})

test('the same purchase ID in another selected account keeps independent physical evidence', () => {
  const facts = {
    orders: [
      { accountId: 'local', orderId: '1001', batches: [batch()] },
      {
        accountId: 'other',
        orderId: '1001',
        batches: [batch({ accountId: 'other', id: 'other', weight: '3' })],
      },
    ],
  }
  const results = enrichExcelRows([row(), row({ accountId: 'other' })], facts)
  assert.equal(results[0].cartonWeight, '12')
  assert.equal(results[1].cartonWeight, '3')
  assert.notDeepEqual(
    results[0].physicalCartonIds,
    results[1].physicalCartonIds
  )
})

test('measurement annotations localize without changing numeric source values', () => {
  for (const [language, annotation] of [
    ['en', 'batch total'],
    ['es', 'total del lote'],
    ['zh', '整批合计'],
  ]) {
    const [result] = enrichExcelRows(
      [row()],
      evidence([batch({ packingBasis: 'aggregate', weightBasis: 'batch' })]),
      { language }
    )
    assert.equal(result.cartonWeight, `12 · ${annotation}`)
    assert.equal(result.price, '7.25')
  }
})

test('repository captures selected accounts and their revision witnesses in a read-only transaction', async () => {
  const browser = await databaseBrowser()
  try {
    const result = await browser.page.evaluate(async () => {
      const {
        openDatabase,
        fixture: { syntheticOrder, syntheticBatch },
      } = modules
      const db = await openDatabase({ name: 'synthetic-excel-evidence' })
      await db.restoreBackup({
        format: '1688-order-library',
        version: 4,
        exportedAt: new Date().toISOString(),
        orders: [
          syntheticOrder(),
          syntheticOrder('1001', '100', { accountId: 'other' }),
        ],
        history: [],
        images: [],
        preparations: [],
        allocations: [],
        issuedCodes: [],
        packingPreferences: null,
        cartonBatches: [
          syntheticBatch(),
          syntheticBatch('1001', 10, '100', {
            id: 'other-batch',
            accountId: 'other',
            weight: '999',
          }),
        ],
      })
      const before = await db.exportBackup({})
      const evidence = await db.getOrdersExcelEvidence([
        { accountId: 'local', orderId: '1001', entryId: '2001' },
      ])
      let stale = false
      try {
        await db.getOrdersExcelEvidence([
          {
            accountId: 'local',
            orderId: '1001',
            entryId: '2001',
            observedAt: '1999-01-01T00:00:00.000Z',
          },
        ])
      } catch (error) {
        stale = error.code === 'OUTPUT_SOURCE_CHANGED'
      }
      let missing = false
      try {
        await db.getOrdersExcelEvidence([
          { accountId: 'local', orderId: '1001', entryId: '999' },
        ])
      } catch (error) {
        missing = error.code === 'OUTPUT_SOURCE_CHANGED'
      }
      const after = await db.exportBackup({})
      db.close()
      return { evidence, before, after, stale, missing }
    })
    assert.equal(result.evidence.orders.length, 1)
    assert.equal(result.evidence.orders[0].accountId, 'local')
    assert.equal(result.evidence.orders[0].batches.length, 1)
    assert.equal(result.evidence.orders[0].batches[0].id, 'batch-1001')
    assert.equal(
      result.evidence.orders[0].revisions.observedAt,
      syntheticOrder().snapshot.observedAt
    )
    assert.deepEqual(result.evidence.orders[0].selectedEntryIds, ['2001'])
    const { exportedAt: a, ...before } = result.before
    const { exportedAt: b, ...after } = result.after
    assert.deepEqual(after, before)
    assert.equal(result.stale, true)
    assert.equal(result.missing, true)
  } finally {
    await browser.close()
  }
})
