import test from 'node:test'
import assert from 'node:assert/strict'
import { createStoreOrder } from '../src/store-order.js'
import { reviewStoreImportCodes } from '../src/store-import-codes.js'
import { planStoreOrderUpdate } from '../src/store-order-update.js'
import { barcodeValue } from '../src/packing-model.js'
import { validateCartonBatch } from '../src/carton-batches.js'
import { lineGrossCents, centsToMoney } from '../src/money.js'
import { SYNTHETIC_PHOTO } from './fixtures/container-fixture.mjs'
import { consumptionLocksForManifest } from '../src/purchase-codes.js'

const target = { accountId: 'local', orderId: '1001' }
const codes = (preparation) =>
  preparation.groups.flatMap((group) =>
    group.variants.map((variant) => barcodeValue(group, variant))
  )
function rows(count = 3) {
  return Array.from({ length: count }, (_, index) => ({
    row: index + 9,
    group: String(index + 1),
    description: `Synthetic household product ${index + 1}`,
    quantity: 10,
    boxes: 2,
    perbox: 5,
    price: '2.00',
    amount: '20.00',
    photos: [SYNTHETIC_PHOTO],
  }))
}
async function candidate(sourceRows, overrides = {}) {
  const r = sourceRows.map((row) => ({
    ...row,
    amount: centsToMoney(
      lineGrossCents(String(row.price), String(row.quantity))
    ),
  }))
  return createStoreOrder(
    {
      filename: '4321.xlsx',
      sheetName: 'Products',
      purchaseDate: '2026-10-01',
      store: {
        key: 'market:4321',
        name: 'Synthetic market',
        number: '4321',
        kind: 'market',
      },
      total: centsToMoney(
        r.reduce(
          (sum, row) =>
            sum + lineGrossCents(String(row.price), String(row.quantity)),
          0n
        )
      ),
      rows: r,
      ...overrides,
    },
    { orderId: target.orderId, now: '2026-10-26T10:00:00.000Z' }
  )
}
function batches(snapshot) {
  return snapshot.spreadsheet.rows.map((row) =>
    validateCartonBatch({
      id: `source:local/${snapshot.orderId}/${row.row}`,
      accountId: 'local',
      orderId: snapshot.orderId,
      storeId: 'market:4321',
      groups: [],
      contents: snapshot.items
        .filter((item) => item.sourceRow === row.row)
        .map((item) => ({
          orderId: snapshot.orderId,
          entryId: item.entryId,
          quantity: item.quantity,
        })),
      count: Number(row.boxes),
      packingBasis:
        snapshot.items.filter((item) => item.sourceRow === row.row).length === 1
          ? 'uniform'
          : 'aggregate',
      len: row.len || '',
      wid: row.wid || '',
      ht: row.ht || '',
      weight: row.kg || '',
      suppliedCbm: row.cbm || '',
      weightBasis: 'carton',
      volumeBasis: 'carton',
      unresolvedContents: [],
      contentsUnknown: false,
      labelOrigin: 'internal',
      provenance: { kind: 'supplier-source', row: row.row },
      revision: 1,
      updatedAt: snapshot.observedAt,
    })
  )
}
async function saved(sourceRows) {
  const source = await candidate(sourceRows),
    empty = {
      records: [],
      preparations: [],
      allocations: [],
      issuedCodes: [],
      batches: [],
      containers: [],
      locks: [],
      history: [],
    }
  const review = reviewStoreImportCodes(empty, { candidate: source })
  assert.deepEqual(review.issues, [])
  review.preparation.revision = 2
  for (const group of review.preparation.groups) {
    group.spanishName = ''
    group.category = '陶瓷'
    group.naming = {
      spanishName: { source: 'manual', value: '' },
      category: { source: 'manual', value: '陶瓷' },
    }
    for (const variant of group.variants) {
      variant.material = '陶瓷'
      variant.materialSource = 'manual'
    }
  }
  return {
    ...empty,
    records: [
      {
        snapshot: source.snapshot,
        revision: 1,
        unitsPerCarton: source.unitsPerCarton,
        notes: 'Authored note',
      },
    ],
    preparations: [review.preparation],
    batches: batches(source.snapshot),
  }
}

test('25 saved rows gain 24 measurement sets without changed prices, codes, originals or authored details', async () => {
  const r = rows(25),
    state = await saved(r),
    before = structuredClone(state)
  const updated = r.map((row, index) =>
    index === 8 ? row : { ...row, kg: '26.4', cbm: '0.05', sourceCbm: '0.05' }
  )
  const result = planStoreOrderUpdate(state, {
    target,
    candidate: await candidate(updated),
  })
  assert.deepEqual(result.issues, [])
  assert.equal(result.summary.measurementsAdded, 24)
  assert.equal(result.summary.unchangedPrices, 25)
  assert.equal(result.summary.priceChanges, 0)
  assert.equal(result.cartonBatchChanges.length, 24)
  assert.deepEqual(codes(result.preparation), codes(state.preparations[0]))
  assert.deepEqual(
    result.candidate.snapshot.items.map((item) => item.entryId),
    state.records[0].snapshot.items.map((item) => item.entryId)
  )
  assert.ok(
    result.preparation.groups.every(
      (group) =>
        group.spanishName === '' &&
        group.naming.spanishName.source === 'manual' &&
        group.variants[0].material === '陶瓷'
    )
  )
  assert.deepEqual(state, before)
  assert.equal(result.hasChanges, true)
})

test('20 to 25 rows replaces four quantities without reporting price changes or duplicating matched cartons', async () => {
  const old = rows(20),
    state = await saved(old),
    next = rows(25)
  for (const index of [4, 5, 12, 13]) {
    next[index].perbox = 8
    next[index].quantity = 16
  }
  const result = planStoreOrderUpdate(state, {
    target,
    candidate: await candidate(next),
  })
  assert.deepEqual(result.issues, [])
  assert.equal(result.summary.added, 5)
  assert.equal(result.summary.changed, 4)
  assert.equal(result.summary.priceChanges, 0)
  assert.equal(result.summary.unchangedPrices, 20)
  assert.equal(
    result.cartonBatchChanges.filter((change) => !change.before).length,
    5
  )
  assert.equal(
    result.cartonBatchChanges.filter((change) => change.before).length,
    4
  )
  assert.equal(
    new Set(result.candidate.snapshot.items.map((item) => item.entryId)).size,
    25
  )
})

test('reordered source rows retain entries, code groups, variants and physical batch identities', async () => {
  const r = rows(),
    state = await saved(r),
    next = [r[2], r[0], r[1]].map((row, index) => ({ ...row, row: index + 20 }))
  const result = planStoreOrderUpdate(state, {
    target,
    candidate: await candidate(next),
  })
  assert.deepEqual(result.issues, [])
  assert.deepEqual(
    result.candidate.snapshot.items.map((item) => item.entryId),
    ['3', '1', '2']
  )
  assert.deepEqual(
    result.preparation.groups.map((group) => group.id),
    [2, 0, 1].map((i) => state.preparations[0].groups[i].id)
  )
  assert.equal(result.cartonBatchChanges.length, 0)
  assert.equal(result.hasChanges, true)
})

test('ambiguous separately accounted identical rows require explicit one-to-one mappings', async () => {
  const r = rows(2).map((row) => ({
      ...row,
      group: '1',
      description: 'Synthetic same object',
      variants: [{ variant: 'A', size: '' }],
    })),
    state = await saved(r)
  const c = await candidate(
    r.map((row, index) => ({ ...row, row: index + 30 }))
  )
  const ambiguous = planStoreOrderUpdate(state, { target, candidate: c })
  assert.equal(
    ambiguous.issues.filter(
      (issue) => issue.code === 'STORE_UPDATE_MAPPING_REQUIRED'
    ).length,
    2
  )
  const resolved = planStoreOrderUpdate(state, {
    target,
    candidate: c,
    mappings: { 30: 10, 31: 9 },
  })
  assert.deepEqual(resolved.issues, [])
  assert.deepEqual(
    resolved.candidate.snapshot.items.map((item) => item.entryId),
    ['2', '1']
  )
  assert.equal(resolved.preparation.groups[0].variants.length, 1)
  assert.equal(resolved.cartonBatchChanges.length, 0)
  const duplicate = planStoreOrderUpdate(state, {
    target,
    candidate: c,
    mappings: { 30: 9, 31: 9 },
  })
  assert.ok(
    duplicate.issues.some(
      (issue) => issue.code === 'STORE_UPDATE_MAPPING_INVALID'
    )
  )
})

test('resolving ambiguous mappings rebases actual draft edits onto saved identities without retaining temporary allocated codes', async () => {
  const r = rows(3).map((row, index) =>
      index < 2
        ? {
            ...row,
            group: '1',
            description: 'Synthetic identical cup',
            variants: [{ variant: 'A', size: '' }],
          }
        : row
    ),
    state = await saved(r),
    c = await candidate(
      r.map((row, index) =>
        index === 0 ? { ...row, quantity: 20, perbox: 10 } : row
      )
    ),
    initial = planStoreOrderUpdate(state, { target, candidate: c }),
    edited = structuredClone(initial.preparation),
    group = edited.groups.find((value) =>
      value.variants.some((variant) =>
        variant.entryIds.includes(initial.candidate.snapshot.items[0].entryId)
      )
    )
  assert.ok(
    initial.issues.some(
      (issue) => issue.code === 'STORE_UPDATE_MAPPING_REQUIRED'
    )
  )
  assert.notEqual(group.baseCode, state.preparations[0].groups[0].baseCode)
  group.spanishName = 'EDITADO'
  group.variants[0].variantSuffix = 'C'
  group.variants[0].materialOverrides = {
    [initial.candidate.snapshot.items[0].entryId]: {
      value: '木',
      source: 'manual',
    },
  }
  const resolved = planStoreOrderUpdate(state, {
    target,
    candidate: c,
    preparation: edited,
    draftCandidate: initial.candidate,
    previousSuggestedPreparation: initial.suggestedPreparation,
    mappings: { 9: 10 },
  })
  assert.deepEqual(resolved.issues, [])
  assert.deepEqual(
    resolved.candidate.snapshot.items.map((item) => item.entryId),
    ['2', '1', '3']
  )
  assert.equal(
    resolved.preparation.groups[0].id,
    state.preparations[0].groups[0].id
  )
  assert.equal(
    resolved.preparation.groups[0].baseCode,
    state.preparations[0].groups[0].baseCode
  )
  assert.equal(resolved.preparation.groups[0].spanishName, 'EDITADO')
  assert.equal(resolved.preparation.groups[0].variants[0].variantSuffix, 'C')
  assert.equal(
    resolved.preparation.groups[0].variants[0].materialOverrides['2'].value,
    '木'
  )
  const foreign = structuredClone(edited)
  foreign.groups[0].variants[0].entryIds = ['999']
  const invalid = planStoreOrderUpdate(state, {
    target,
    candidate: c,
    preparation: foreign,
    draftCandidate: initial.candidate,
    previousSuggestedPreparation: initial.suggestedPreparation,
    mappings: { 9: 10 },
  })
  assert.ok(
    invalid.issues.some((issue) => issue.code === 'STORE_UPDATE_CODES_INVALID')
  )
})

test('combined declarations preserve each allocation identity and one aggregate source carton batch', async () => {
  const r = [
      {
        ...rows(1)[0],
        variants: [
          { variant: 'A', size: '' },
          { variant: 'B', size: '' },
        ],
        variantAllocations: [
          { variant: 'A', size: '', quantity: 4 },
          { variant: 'B', size: '', quantity: 6 },
        ],
      },
    ],
    state = await saved(r)
  const c = await candidate([
    {
      ...r[0],
      variantAllocations: [
        { variant: 'A', size: '', quantity: 3 },
        { variant: 'B', size: '', quantity: 7 },
      ],
      kg: '12',
    },
  ])
  const result = planStoreOrderUpdate(state, { target, candidate: c })
  assert.deepEqual(result.issues, [])
  assert.deepEqual(
    result.candidate.snapshot.items.map((item) => [
      item.entryId,
      item.quantity,
    ]),
    [
      ['1', '3'],
      ['2', '7'],
    ]
  )
  assert.equal(result.cartonBatchChanges.length, 1)
  assert.equal(result.cartonBatchChanges[0].after.packingBasis, 'aggregate')
  assert.equal(result.cartonBatchChanges[0].after.count, 2)
  assert.equal(result.hasChanges, true)
  assert.ok(
    result.rowChanges[0].fields.some(
      (field) =>
        field.field === 'allocations' &&
        field.before[0].quantity === '4' &&
        field.after[0].quantity === '3'
    )
  )
})

test('precise unit-price increases/decreases differ from quantity-driven subtotal changes', async () => {
  const r = rows(),
    state = await saved(r),
    c = await candidate(
      r.map((row, index) => ({
        ...row,
        price: ['2.001', '1.999', '2.00'][index],
        ...(index === 2 ? { quantity: 12, perbox: 6 } : {}),
      }))
    )
  const result = planStoreOrderUpdate(state, { target, candidate: c })
  assert.deepEqual(result.issues, [])
  assert.deepEqual(
    result.rowChanges.map((row) => row.priceStatus),
    ['increased', 'decreased', 'unchanged']
  )
  assert.equal(result.summary.priceChanges, 2)
})

test('Excel replaces manual unsealed measurements and clears missing optional source evidence', async () => {
  const r = rows(1),
    state = await saved(r)
  Object.assign(state.batches[0], {
    weight: '19',
    suppliedCbm: '0.6',
    weightBasis: 'batch',
    volumeBasis: 'batch',
    unitMeasurements: {
      0: { weight: '10', len: '', wid: '', ht: '', suppliedCbm: '' },
    },
  })
  const result = planStoreOrderUpdate(state, {
    target,
    candidate: await candidate(r),
  })
  assert.deepEqual(result.issues, [])
  assert.equal(result.cartonBatchChanges.length, 1)
  assert.equal(result.cartonBatchChanges[0].after.weight, '')
  assert.equal(result.cartonBatchChanges[0].after.suppliedCbm, '')
  assert.equal(result.cartonBatchChanges[0].after.weightBasis, 'carton')
  assert.equal(result.cartonBatchChanges[0].after.unitMeasurements, undefined)
})

test('removed source rows retire cartons while new entries do not reuse retired historical entry IDs', async () => {
  const r = rows(3),
    state = await saved(r)
  state.history = [
    {
      snapshot: {
        ...state.records[0].snapshot,
        items: [{ ...state.records[0].snapshot.items[0], entryId: '90' }],
      },
    },
  ]
  const next = [
    r[0],
    {
      ...r[2],
      group: '4',
      description: 'Synthetic new distinct object',
      productNumber: 'NEW-41',
    },
  ]
  const result = planStoreOrderUpdate(state, {
    target,
    candidate: await candidate(next),
    mappings: { 11: 'new' },
  })
  assert.deepEqual(result.issues, [])
  assert.equal(result.summary.removed, 2)
  assert.equal(result.candidate.snapshot.items[1].entryId, '91')
  assert.equal(
    result.cartonBatchChanges.filter((change) => change.after.deletedAt).length,
    2
  )
})

test('new variants reuse the matched group base and repeated reviews preserve proposed IDs and edits', async () => {
  const r = [{ ...rows(1)[0], variants: [{ variant: 'A', size: '' }] }],
    state = await saved(r)
  const c = await candidate([
    ...r,
    {
      ...r[0],
      row: 10,
      description: 'Synthetic sibling',
      variants: [{ variant: 'B', size: '' }],
    },
  ])
  const result = planStoreOrderUpdate(state, {
    target,
    candidate: c,
    mappings: { 10: 'new' },
  })
  assert.deepEqual(result.issues, [])
  assert.equal(result.preparation.groups.length, 1)
  assert.equal(
    result.preparation.groups[0].baseCode,
    state.preparations[0].groups[0].baseCode
  )
  const edited = structuredClone(result.preparation)
  edited.groups[0].variants[1].variantSuffix = 'C'
  edited.groups[0].variants[1].material = '木'
  const again = planStoreOrderUpdate(state, {
    target,
    candidate: result.sourceCandidate,
    mappings: result.mappings,
    preparation: edited,
  })
  assert.deepEqual(again.issues, [])
  assert.deepEqual(again.preparation, edited)
  assert.equal(
    again.preparation.groups[0].variants[1].id,
    result.preparation.groups[0].variants[1].id
  )
})

test('changed declarations require explicit code review acknowledgment and regenerate only that identity', async () => {
  const r = [{ ...rows(1)[0], variants: [{ variant: 'A', size: '' }] }],
    state = await saved(r),
    c = await candidate([{ ...r[0], variants: [{ variant: 'B', size: '' }] }])
  const result = planStoreOrderUpdate(state, { target, candidate: c })
  assert.ok(
    result.issues.some(
      (issue) => issue.code === 'STORE_UPDATE_IDENTITY_REVIEW_REQUIRED'
    )
  )
  assert.equal(result.preparation.groups[0].variants[0].variantSuffix, 'A')
  const confirmed = planStoreOrderUpdate(state, {
    target,
    candidate: c,
    identityChangesConfirmed: true,
  })
  assert.deepEqual(confirmed.issues, [])
  assert.equal(confirmed.preparation.groups[0].variants[0].variantSuffix, 'B')
  assert.equal(
    confirmed.preparation.groups[0].baseCode,
    state.preparations[0].groups[0].baseCode
  )
})

test('unchanged full source and cartons produce a no-op; changed authored details produce an update', async () => {
  const r = rows(),
    state = await saved(r),
    c = await candidate(r),
    result = planStoreOrderUpdate(state, { target, candidate: c })
  assert.deepEqual(result.issues, [])
  assert.equal(result.hasChanges, false)
  assert.equal(result.cartonBatchChanges.length, 0)
  const edited = structuredClone(result.preparation)
  edited.groups[0].spanishName = 'NUEVO'
  const changed = planStoreOrderUpdate(state, {
    target,
    candidate: c,
    preparation: edited,
  })
  assert.deepEqual(changed.issues, [])
  assert.equal(changed.hasChanges, true)
})

test('reset code suggestions retains scoped draft details and matched manually assigned codes', async () => {
  const r = rows(2),
    state = await saved(r),
    c = await candidate(r),
    review = planStoreOrderUpdate(state, { target, candidate: c })
  const edited = structuredClone(review.preparation)
  edited.groups[0].baseCode = 'INVALID'
  edited.groups[0].spanishName = 'EDITADO'
  edited.groups[0].variants[0].material = ''
  edited.groups[0].variants[0].materialSource = 'manual'
  const reset = planStoreOrderUpdate(state, {
    target,
    candidate: c,
    preparation: edited,
    resetCodes: true,
  })
  assert.deepEqual(reset.issues, [])
  assert.deepEqual(codes(reset.preparation), codes(state.preparations[0]))
  assert.equal(reset.preparation.groups[0].spanishName, 'EDITADO')
  assert.equal(reset.preparation.groups[0].variants[0].material, '')
  assert.equal(reset.preparation.groups[0].variants[0].materialSource, 'manual')
})

test('carton labels and entitlement identities survive measurements replacement and incompatible counts block', async () => {
  const r = rows(1),
    state = await saved(r)
  state.batches[0].entitlementIndices = [3, 5]
  state.batches[0].unitLabels = {
    3: 'Supplier carton 3',
    5: 'Supplier carton 5',
  }
  const c = await candidate([{ ...r[0], kg: '5' }]),
    result = planStoreOrderUpdate(state, { target, candidate: c })
  assert.deepEqual(result.issues, [])
  assert.deepEqual(
    result.cartonBatchChanges[0].after.entitlementIndices,
    [3, 5]
  )
  assert.deepEqual(
    result.cartonBatchChanges[0].after.unitLabels,
    state.batches[0].unitLabels
  )
  const incompatible = planStoreOrderUpdate(state, {
    target,
    candidate: await candidate([{ ...r[0], boxes: 1, perbox: 10 }]),
  })
  assert.ok(
    incompatible.issues.some(
      (issue) => issue.code === 'STORE_UPDATE_CARTON_CONFLICT'
    )
  )
})

test('account/store isolation and invalid preparations fail closed', async () => {
  const r = rows(),
    state = await saved(r),
    c = await candidate(r)
  assert.throws(
    () =>
      planStoreOrderUpdate(state, {
        target: { ...target, accountId: 'other' },
        candidate: c,
      }),
    /existing spreadsheet/
  )
  c.snapshot.store.key = 'market:9876'
  assert.throws(
    () => planStoreOrderUpdate(state, { target, candidate: c }),
    /account and store/
  )
  const valid = await candidate(r),
    review = planStoreOrderUpdate(state, { target, candidate: valid }),
    edited = structuredClone(review.preparation)
  edited.groups[0].variants[0].entryIds = ['999']
  const broken = planStoreOrderUpdate(state, {
    target,
    candidate: valid,
    preparation: edited,
  })
  assert.ok(
    broken.issues.some((issue) => issue.code === 'STORE_UPDATE_CODES_INVALID')
  )
})

test('edited codes conflict with current and historical owners without silently substituting codes', async () => {
  const r = rows(1),
    state = await saved(r),
    other = structuredClone(state.preparations[0])
  other.orderId = '2002'
  other.groups[0].id = 'other-group'
  other.groups[0].baseCode = 'CE26100105'
  other.groups[0].variants[0].id = 'other-variant'
  const otherRecord = structuredClone(state.records[0])
  otherRecord.snapshot.orderId = '2002'
  state.records.push(otherRecord)
  state.preparations.push(other)
  const c = await candidate(r),
    initial = planStoreOrderUpdate(state, { target, candidate: c }),
    edited = structuredClone(initial.preparation)
  edited.groups[0].baseCode = 'CE26100105'
  const current = planStoreOrderUpdate(state, {
    target,
    candidate: c,
    preparation: edited,
  })
  assert.equal(current.preparation.groups[0].baseCode, 'CE26100105')
  assert.equal(
    current.issues.find((issue) => issue.conflict)?.conflict.owner.orderId,
    '2002'
  )
  state.locks = consumptionLocksForManifest(
    {
      container: { id: 'synthetic' },
      revisionId: 'synthetic/r1',
      sealedAt: '2026-10-26T10:00:00.000Z',
      draft: false,
      status: 'sealed',
      orders: [{ record: otherRecord, preparation: other }],
      products: [
        {
          accountId: 'local',
          orderId: '2002',
          baseCode: other.groups[0].baseCode,
          barcode: codes(other)[0],
        },
      ],
    },
    state
  )
  state.preparations = state.preparations.filter(
    (value) => value.orderId !== '2002'
  )
  const historical = planStoreOrderUpdate(state, {
    target,
    candidate: c,
    preparation: edited,
  })
  assert.equal(historical.preparation.groups[0].baseCode, 'CE26100105')
  assert.equal(
    historical.issues.find((issue) => issue.conflict)?.conflict.owner.orderId,
    '2002'
  )
})

test('a blank shown base blocks validation and remains blank instead of silently receiving an allocation', async () => {
  const r = rows(1),
    state = await saved(r),
    c = await candidate(r),
    initial = planStoreOrderUpdate(state, { target, candidate: c }),
    edited = structuredClone(initial.preparation)
  edited.groups[0].baseCode = ''
  const reviewed = planStoreOrderUpdate(state, {
    target,
    candidate: c,
    preparation: edited,
  })
  assert.equal(reviewed.preparation.groups[0].baseCode, '')
  assert.ok(
    reviewed.issues.some(
      (issue) =>
        issue.field === 'baseCode' && issue.groupId === edited.groups[0].id
    )
  )
  assert.deepEqual(reviewed.rowChanges[0].after.codes, [])
})

test('independently changed title and SKU properties are authoritative visible source changes', async () => {
  const r = [
      {
        ...rows(1)[0],
        title: 'Synthetic original title',
        skuProperties: [
          { label: 'Material', value: 'Wood', raw: 'Material: Wood' },
        ],
      },
    ],
    state = await saved(r),
    next = [
      {
        ...r[0],
        title: 'Synthetic updated title',
        skuProperties: [
          { label: 'Material', value: 'Metal', raw: 'Material: Metal' },
        ],
      },
    ],
    result = planStoreOrderUpdate(state, {
      target,
      candidate: await candidate(next),
    })
  assert.deepEqual(result.issues, [])
  assert.equal(result.hasChanges, true)
  assert.ok(
    result.rowChanges[0].fields.some(
      (field) =>
        field.field === 'title' && field.after === 'Synthetic updated title'
    )
  )
  assert.ok(
    result.rowChanges[0].fields.some(
      (field) =>
        field.field === 'skuProperties' && field.after[0].value === 'Metal'
    )
  )
  assert.equal(result.preparation.groups[0].spanishName, '')
  assert.equal(result.preparation.groups[0].naming.spanishName.source, 'manual')
  assert.equal(result.preparation.groups[0].variants[0].material, '陶瓷')
  assert.deepEqual(codes(result.preparation), codes(state.preparations[0]))
})

test('retiring or consolidating cartons cannot discard recorded receipt/loading decisions', async () => {
  const r = rows(1),
    state = await saved(r),
    original = state.batches[0]
  state.batches = [
    {
      ...structuredClone(original),
      id: 'first',
      count: 1,
      packingBasis: 'exact',
      contents: [{ orderId: target.orderId, entryId: '1', quantity: '5' }],
      received: 0,
    },
    {
      ...structuredClone(original),
      id: 'second',
      count: 1,
      packingBasis: 'exact',
      contents: [{ orderId: target.orderId, entryId: '1', quantity: '5' }],
      received: 1,
    },
  ]
  const result = planStoreOrderUpdate(state, {
    target,
    candidate: await candidate(r),
  })
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === 'STORE_UPDATE_CARTON_DECISIONS' &&
        issue.batchId === 'second'
    )
  )
  assert.ok(
    !result.cartonBatchChanges.some(
      (change) => change.after.id === 'second' && change.after.deletedAt
    )
  )
  assert.equal(state.batches[1].received, 1)
})

test('new source context refreshes automatic suggestions while authored names and materials remain independent', async () => {
  const r = [
      {
        ...rows(1)[0],
        title: 'Synthetic oldobject',
        skuProperties: [{ label: '材质', value: '木质' }],
      },
    ],
    state = await saved(r)
  state.preferences = {
    vocabulary: [
      { match: 'oldobject', spanishName: 'ANTERIOR', category: '旧类' },
      { match: 'newobject', spanishName: 'ACTUAL', category: '新类' },
    ],
  }
  const g = state.preparations[0].groups[0]
  g.spanishName = 'ANTERIOR'
  g.category = ''
  g.naming = {
    spanishName: { source: 'automatic', value: 'ANTERIOR' },
    category: { source: 'manual', value: '' },
  }
  const result = planStoreOrderUpdate(state, {
    target,
    candidate: await candidate([
      {
        ...r[0],
        title: 'Synthetic newobject',
        skuProperties: [{ label: '材质', value: '金属' }],
      },
    ]),
  })
  assert.deepEqual(result.issues, [])
  assert.equal(result.preparation.groups[0].spanishName, 'ACTUAL')
  assert.equal(result.preparation.groups[0].category, '')
  assert.equal(result.preparation.groups[0].naming.category.source, 'manual')
  assert.equal(result.preparation.groups[0].variants[0].material, '陶瓷')
})

test('splitting a source group preserves manual details/materials on every matched product without copying a base', async () => {
  const r = rows(2).map((row, index) => ({
      ...row,
      group: '1',
      variants: [{ variant: index ? 'B' : 'A', size: '' }],
    })),
    state = await saved(r),
    next = r.map((row, index) => ({ ...row, group: String(index + 1) })),
    result = planStoreOrderUpdate(state, {
      target,
      candidate: await candidate(next),
      identityChangesConfirmed: true,
    })
  assert.deepEqual(result.issues, [])
  assert.equal(result.preparation.groups.length, 2)
  assert.notEqual(
    result.preparation.groups[0].baseCode,
    result.preparation.groups[1].baseCode
  )
  assert.ok(
    result.preparation.groups.every(
      (group) =>
        group.spanishName === '' &&
        group.naming.spanishName.source === 'manual' &&
        group.category === '陶瓷'
    )
  )
  assert.ok(
    result.preparation.groups.every(
      (group) =>
        group.variants[0].material === '陶瓷' &&
        group.variants[0].materialSource === 'manual'
    )
  )
})

test('merging conflicting authored group details requires an explicit manual detail choice', async () => {
  const r = rows(2).map((row, index) => ({
      ...row,
      variants: [{ variant: index ? 'B' : 'A', size: '' }],
    })),
    state = await saved(r)
  state.preparations[0].groups[0].category = '第一'
  state.preparations[0].groups[0].naming.category.value = '第一'
  state.preparations[0].groups[1].category = '第二'
  state.preparations[0].groups[1].naming.category.value = '第二'
  const c = await candidate(r.map((row) => ({ ...row, group: '1' }))),
    initial = planStoreOrderUpdate(state, {
      target,
      candidate: c,
      identityChangesConfirmed: true,
    })
  assert.ok(
    initial.issues.some(
      (issue) =>
        issue.code === 'STORE_UPDATE_DETAILS_REVIEW_REQUIRED' &&
        issue.field === 'category'
    )
  )
  const edited = structuredClone(initial.preparation)
  edited.groups[0].category = '选择'
  edited.groups[0].naming.category = { source: 'manual', value: '选择' }
  const reviewed = planStoreOrderUpdate(state, {
    target,
    candidate: c,
    preparation: edited,
    identityChangesConfirmed: true,
  })
  assert.deepEqual(reviewed.issues, [])
  assert.equal(reviewed.preparation.groups[0].category, '选择')
})

test('filename/sheet provenance changes are updates while observation/import timestamps alone remain no-ops', async () => {
  const r = rows(1),
    state = await saved(r),
    changed = await candidate(r, {
      filename: '4321 (2).xlsx',
      sheetName: 'Revised products',
    }),
    result = planStoreOrderUpdate(state, { target, candidate: changed })
  assert.deepEqual(result.issues, [])
  assert.equal(result.hasChanges, true)
  assert.deepEqual(
    result.sourceMetadataChanges.map((change) => change.field),
    ['filename', 'sheetName']
  )
  const same = await candidate(r)
  same.snapshot.observedAt = '2026-10-27T10:00:00.000Z'
  same.snapshot.spreadsheet.importedAt = same.snapshot.observedAt
  const unchanged = planStoreOrderUpdate(state, { target, candidate: same })
  assert.equal(unchanged.hasChanges, false)
})

test('absent unknown material and empty suggested material compare equally while manual blank provenance remains an edit', async () => {
  const r = rows(1),
    state = await saved(r),
    variant = state.preparations[0].groups[0].variants[0]
  delete variant.material
  delete variant.materialSource
  const c = await candidate(r),
    first = planStoreOrderUpdate(state, { target, candidate: c })
  assert.deepEqual(first.issues, [])
  assert.equal(first.hasChanges, false)
  assert.equal(first.preparation.groups[0].variants[0].material, undefined)
  const suggested = structuredClone(first.preparation)
  suggested.groups[0].variants[0].material = ''
  suggested.groups[0].variants[0].materialSource = 'suggested'
  const same = planStoreOrderUpdate(state, {
    target,
    candidate: c,
    preparation: suggested,
  })
  assert.deepEqual(same.issues, [])
  assert.equal(same.hasChanges, false)
  suggested.groups[0].variants[0].materialSource = 'manual'
  const authored = planStoreOrderUpdate(state, {
    target,
    candidate: c,
    preparation: suggested,
  })
  assert.deepEqual(authored.issues, [])
  assert.equal(authored.hasChanges, true)
  assert.equal(
    authored.preparation.groups[0].variants[0].materialSource,
    'manual'
  )
})
