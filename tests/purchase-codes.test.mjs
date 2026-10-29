import test from 'node:test'
import assert from 'node:assert/strict'
import {
  purchaseMonthForCodes,
  purchaseSupplierForCodes,
  planLegacySupplierIdentityReview,
  applyLegacySupplierIdentityReview,
  supplierCodeIdentityEquivalences,
  hasReviewedSupplierCodeIdentity,
  planPurchaseCodeReview,
  assertPurchaseCodeMonths,
  assertConsumedCodeChanges,
  historicalCodeReservations,
  consumptionLocksForManifest,
  assertRepeatCodeEligibility,
} from '../src/purchase-codes.js'
import {
  activePackingState,
  allocatePreparation,
  barcodeValue,
  createPreparation,
  validatePreparationReservations,
  codeOwnerEvidence,
} from '../src/packing-model.js'
import {
  planSharedProductLink,
  planSharedProductUnlink,
  repeatProductCandidates,
} from '../src/repeat-products.js'
import { createPackingBackup } from '../src/packing-backup.js'
import { validateBackup } from '../src/database.js'
import { createRepeatProductsRepository } from '../src/repeat-products-repository.js'

function records(months = ['2026-09', '2026-10', '2026-11']) {
  return months.map((month, index) => ({
    snapshot: {
      accountId: 'local',
      orderId: String(101 + index),
      sellerName: 'Synthetic factory',
      sellerMemberLogin: 'factory-id',
      purchasedAt: month ? `${month}-30T23:30:00-05:00` : undefined,
      observedAt: '2026-11-01T12:00:00Z',
      items: [
        {
          entryId: '1',
          title: 'Cup',
          productNumber: 'SYNTHETIC-CUP',
          description: 'White cup',
          sourceSize: 'S',
          quantity: String((index + 1) * 10),
          price: `${index + 2}.00`,
          thumbnail: 'synthetic-photo',
        },
      ],
    },
    productWorkflow: {},
    revision: 1,
  }))
}

test('explicit current-order code scope includes all 17 logical source products without touching unrelated purchases or accounts', () => {
  const source = records(['2026-09', '2026-10'])
  source[0].snapshot.items = Array.from({ length: 17 }, (_, index) => ({
    ...source[0].snapshot.items[0],
    entryId: String(index + 1),
    title: `Synthetic product ${index + 1}`,
    productNumber: `SYNTHETIC-PRODUCT-${index + 1}`,
    description: `Synthetic product ${index + 1}`,
  }))
  delete source[1].snapshot.sellerMemberLogin
  source[1].snapshot.sellerUnavailable = true
  const foreign = structuredClone(source[0]),
    spreadsheet = structuredClone(source[1])
  foreign.snapshot.accountId = 'another-account'
  delete foreign.snapshot.sellerMemberLogin
  foreign.snapshot.sellerUnavailable = true
  Object.assign(spreadsheet.snapshot, {
    orderId: '104',
    sourceType: 'spreadsheet',
    sourceUrl: '',
  })
  const s = {
      records: [...source, foreign, spreadsheet],
      preparations: [],
      allocations: [],
      issuedCodes: [],
      locks: [],
    },
    before = structuredClone(s),
    refs = source[0].snapshot.items.map((item) => ({
      accountId: 'local',
      orderId: '101',
      entryId: item.entryId,
    })),
    review = planPurchaseCodeReview(s, { entryRefs: refs })
  assert.equal(refs.length, 17)
  assert.ok(
    refs.every((row) => row.accountId === 'local' && row.orderId === '101')
  )
  assert.equal(review.changes.length, 17)
  assert.deepEqual(review.issues, [])
  assert.ok(review.changes.every((row) => row.after.startsWith('CE2609')))
  assert.deepEqual(s, before)
})

test('a source subset code review preserves unselected assignments and excludes other purchases and unselected missing rows', () => {
  const s = state(['2026-09', '2026-10'])
  s.records[0].snapshot.items.push(
    ...['2', '3'].map((entryId) => ({
      ...s.records[0].snapshot.items[0],
      entryId,
      title: `Source product ${entryId}`,
      productNumber: `SYNTHETIC-PRODUCT-${entryId}`,
      description: `Source product ${entryId}`,
    }))
  )
  const before = structuredClone(s),
    review = planPurchaseCodeReview(s, {
      orderRefs: [{ accountId: 'local', orderId: '101' }],
      entryRefs: [{ accountId: 'local', orderId: '101', entryId: '2' }],
    })
  assert.deepEqual(review.issues, [])
  assert.equal(review.changes.length, 1)
  assert.equal(review.changes[0].entryId, '2')
  assert.equal(review.changes[0].before, '')
  assert.match(review.changes[0].after, /^CE2609/)
  assert.equal(review.plan.preparations.length, 1)
  const proposed = review.plan.preparations[0]
  assert.equal(proposed.orderId, '101')
  assert.deepEqual(
    proposed.groups.find(
      (group) => group.id === before.preparations[0].groups[0].id
    ),
    before.preparations[0].groups[0]
  )
  assert.ok(
    !proposed.groups.some((group) =>
      group.variants.some((variant) => variant.entryIds.includes('3'))
    )
  )
  assert.deepEqual(s.preparations[1], before.preparations[1])
  assert.deepEqual(s, before)
})

test('selecting one of two identical source identities never prepares the unchecked source row', () => {
  const source = records(['2026-09'])
  source[0].snapshot.items.push({
    ...source[0].snapshot.items[0],
    entryId: '2',
    quantity: '25',
  })
  const s = {
      records: source,
      preparations: [],
      allocations: [],
      issuedCodes: [],
      locks: [],
    },
    before = structuredClone(s),
    review = planPurchaseCodeReview(s, {
      orderRefs: [{ accountId: 'local', orderId: '101' }],
      entryRefs: [{ accountId: 'local', orderId: '101', entryId: '1' }],
    })
  assert.deepEqual(review.issues, [])
  assert.deepEqual(
    review.changes.map((change) => change.entryId),
    ['1']
  )
  assert.deepEqual(
    review.plan.preparations.flatMap((preparation) =>
      preparation.groups.flatMap((group) =>
        group.variants.flatMap((variant) => variant.entryIds)
      )
    ),
    ['1']
  )
  assert.deepEqual(s, before)
})

test('a selected row preserves previously shared unchecked identities without adding another identical source row', () => {
  const source = records(['2026-09'])
  source[0].snapshot.items.push({
    ...source[0].snapshot.items[0],
    entryId: '2',
    quantity: '25',
  })
  const allocation = allocatePreparation(
      createPreparation(source[0].snapshot, '2026-09'),
      [],
      [],
      { snapshot: source[0].snapshot }
    ),
    preparation = { ...allocation.preparation, revision: 1 },
    variant = preparation.groups[0].variants[0]
  assert.deepEqual(variant.entryIds, ['1', '2'])
  source[0].snapshot.items.push({
    ...source[0].snapshot.items[0],
    entryId: '3',
    quantity: '40',
  })
  const s = {
      records: source,
      preparations: [preparation],
      allocations: allocation.allocations,
      issuedCodes: allocation.issuedCodes,
      locks: [],
    },
    before = structuredClone(s),
    review = planPurchaseCodeReview(s, {
      orderRefs: [{ accountId: 'local', orderId: '101' }],
      entryRefs: [{ accountId: 'local', orderId: '101', entryId: '1' }],
    })
  assert.deepEqual(review.issues, [])
  assert.equal(review.changes.length, 1)
  assert.equal(review.changes[0].after, review.changes[0].before)
  assert.deepEqual(review.plan.preparations[0], before.preparations[0])
  assert.deepEqual(s, before)
})

function unassignedState(source = records(['2026-10'])) {
  return {
    records: source,
    preparations: [],
    allocations: [],
    issuedCodes: [],
    locks: [],
  }
}
function colourState() {
  const s = unassignedState(),
    original = s.records[0].snapshot.items[0]
  s.records[0].snapshot.items = ['Red', 'Blue', 'Green'].map(
    (colour, index) => ({
      ...original,
      entryId: String(index + 1),
      title: 'Synthetic cup',
      description: `Synthetic cup ${colour}`,
      sourceSize: '',
      skuProperties: [{ label: 'Color', value: colour }],
    })
  )
  return s
}
function selectedReview(s, entries, orderId = '101') {
  return planPurchaseCodeReview(s, {
    entryRefs: entries.map((entryId) => ({
      accountId: 'local',
      orderId,
      entryId,
    })),
  })
}
function acceptReview(s, review) {
  assert.deepEqual(review.issues, [])
  const preparations = review.plan.preparations.map((preparation) => ({
      ...preparation,
      revision: preparation.revision + 1,
    })),
    packing = activePackingState(preparations, s.allocations, s.issuedCodes)
  return {
    ...s,
    preparations,
    allocations: packing.allocations,
    issuedCodes: packing.issuedCodes,
  }
}

test('selected B retains the complete order A/B/C identity without preparing A or C', () => {
  const s = colourState(),
    before = structuredClone(s),
    review = selectedReview(s, ['2'])
  assert.deepEqual(review.issues, [])
  assert.equal(review.changes[0].after, 'CE26100101B')
  assert.deepEqual(
    review.plan.preparations[0].groups[0].variants.map(
      (variant) => variant.entryIds
    ),
    [['2']]
  )
  assert.deepEqual(s, before)
})

test('title family review needs no manual choice and retains complete revision guards', () => {
  const s = colourState()
  for (const item of s.records[0].snapshot.items) item.productNumber = ''
  const before = structuredClone(s),
    selection = {
      entryRefs: [{ accountId: 'local', orderId: '101', entryId: '2' }],
    },
    unresolved = planPurchaseCodeReview(s, selection),
    joined = planPurchaseCodeReview(s, {
      ...selection,
      familyChoices: [
        {
          accountId: 'local',
          orderId: '101',
          entryIds: ['1', '2', '3'],
          kind: 'family',
        },
      ],
    }),
    separate = planPurchaseCodeReview(s, {
      ...selection,
      familyChoices: [
        {
          accountId: 'local',
          orderId: '101',
          entryIds: ['1', '2', '3'],
          kind: 'standalone',
        },
      ],
    })
  assert.deepEqual(unresolved.issues, [])
  assert.equal(unresolved.plan.preparations.length, 1)
  assert.equal(unresolved.changes[0].after, 'CE26100101B')
  assert.deepEqual(joined.issues, [])
  assert.equal(joined.changes[0].after, 'CE26100101B')
  assert.deepEqual(separate.issues, [])
  assert.equal(separate.changes[0].after, 'CE26100101')
  assert.deepEqual(
    joined.plan.expectedSnapshots,
    unresolved.plan.expectedSnapshots
  )
  assert.deepEqual(joined.expectedRevisions, unresolved.expectedRevisions)
  assert.deepEqual(
    joined.plan.preparations[0].groups.flatMap((group) =>
      group.variants.flatMap((variant) => variant.entryIds)
    ),
    ['2']
  )
  const accepted = acceptReview(s, joined),
    next = selectedReview(accepted, ['3'])
  assert.deepEqual(next.issues, [])
  assert.equal(next.changes[0].after, 'CE26100101C')
  assert.deepEqual(s, before)
})

test('partial title-family inference uses letters from all source siblings', () => {
  const s = unassignedState(),
    original = s.records[0].snapshot.items[0]
  s.records[0].snapshot.items = ['7128F-02', '7128K-01', '7128K-02'].map(
    (productNumber, index) => ({
      ...original,
      entryId: String(index + 1),
      title: 'Synthetic generic decoration',
      description: 'Synthetic generic decoration',
      productNumber,
      sourceSize: '',
      skuProperties: [
        {
          label: '颜色',
          value: ['大号—吻情深-金色', '吉象-金色', '吉象-银色'][index],
        },
        { label: '尺寸', value: '如图所示' },
      ],
    })
  )
  const horse = selectedReview(s, ['1']),
    elephant = selectedReview(s, ['3'])
  assert.deepEqual(horse.issues, [])
  assert.equal(horse.changes[0].after, 'CE26100101A')
  assert.deepEqual(elephant.issues, [])
  assert.equal(elephant.changes[0].after, 'CE26100101C')
  assert.deepEqual(
    elephant.plan.preparations[0].groups[0].variants[0].entryIds,
    ['3']
  )
})

test('separate A then B assignments reuse one product base and preserve assigned A', () => {
  let s = colourState()
  s = acceptReview(s, selectedReview(s, ['1']))
  const first = structuredClone(s.preparations[0].groups[0]),
    review = selectedReview(s, ['2'])
  assert.deepEqual(review.issues, [])
  assert.equal(review.changes[0].after, 'CE26100101B')
  const [group] = review.plan.preparations[0].groups
  assert.equal(group.id, first.id)
  assert.equal(group.baseCode, first.baseCode)
  assert.deepEqual(group.variants[0], first.variants[0])
  assert.deepEqual(
    group.variants.flatMap((variant) => variant.entryIds),
    ['1', '2']
  )
  assert.ok(!group.variants.some((variant) => variant.entryIds.includes('3')))
})

test('later identical source identity reuses custom assigned endings and separately accounted entry membership', () => {
  let s = colourState()
  s.records[0].snapshot.items.push({
    ...structuredClone(s.records[0].snapshot.items[0]),
    entryId: '4',
    quantity: '29',
    price: '3.25',
  })
  s = acceptReview(s, selectedReview(s, ['1']))
  s.preparations[0].groups[0].variants[0].variantSuffix = 'CUSTOM'
  const before = structuredClone(s),
    review = selectedReview(s, ['4'])
  assert.deepEqual(review.issues, [])
  assert.equal(review.changes[0].after, 'CE26100101CUSTOM')
  assert.equal(review.changes[0].quantity, '29')
  assert.equal(review.changes[0].price, '3.25')
  assert.deepEqual(review.plan.preparations[0].groups[0].variants[0].entryIds, [
    '1',
    '4',
  ])
  assert.deepEqual(s, before)
})

test('new selected groups consume consecutive available numbers, not unselected source positions', () => {
  const s = unassignedState(),
    original = s.records[0].snapshot.items[0]
  s.records[0].snapshot.items = [
    'Unselected first',
    'Selected second',
    'Unselected third',
    'Selected fourth',
  ].map((title, index) => ({
    ...original,
    entryId: String(index + 1),
    title,
    productNumber: `SYNTHETIC-PRODUCT-${index + 1}`,
    description: title,
  }))
  const review = selectedReview(s, ['4', '2'])
  assert.deepEqual(review.issues, [])
  assert.deepEqual(
    review.changes.map(({ entryId, after }) => [entryId, after]),
    [
      ['2', 'CE26100101'],
      ['4', 'CE26100102'],
    ]
  )
  const accepted = acceptReview(s, review)
  assert.equal(
    accepted.issuedCodes.filter((code) => code.kind === 'base').length,
    2
  )
  assert.deepEqual(
    accepted.preparations[0].groups.flatMap((group) =>
      group.variants.flatMap((variant) => variant.entryIds)
    ),
    ['2', '4']
  )
})

for (const sourceType of ['1688', 'spreadsheet']) {
  test(`nonadjacent equal ${sourceType} groups keep complete-source numbering when only a later sibling is selected`, () => {
    const s = unassignedState(),
      snapshot = s.records[0].snapshot,
      original = snapshot.items[0]
    if (sourceType === 'spreadsheet')
      Object.assign(snapshot, {
        sourceType: 'spreadsheet',
        store: { key: 'market:100', name: 'Synthetic market' },
      })
    snapshot.items = ['A', 'B', 'A'].map((group, index) => ({
      ...original,
      entryId: String(index + 1),
      title: sourceType === 'spreadsheet' ? `Source row ${index + 1}` : group,
      productNumber: `SYNTHETIC-${group}`,
      description: `Source row ${index + 1}`,
      sourceSize: '',
      skuProperties: [],
      ...(sourceType === 'spreadsheet'
        ? { sourceGroup: group, sourceVariant: 'a' }
        : {}),
    }))
    const firstSibling = selectedReview(s, ['1', '2']),
      laterSibling = selectedReview(s, ['2', '3']),
      suffix = sourceType === 'spreadsheet' ? 'A' : ''
    assert.deepEqual(firstSibling.issues, [])
    assert.deepEqual(laterSibling.issues, [])
    assert.deepEqual(
      firstSibling.changes.map(({ entryId, after }) => [entryId, after]),
      [
        ['1', `CE26100101${suffix}`],
        ['2', `CE26100102${suffix}`],
      ]
    )
    assert.deepEqual(
      laterSibling.changes.map(({ entryId, after }) => [entryId, after]),
      [
        ['3', `CE26100101${suffix}`],
        ['2', `CE26100102${suffix}`],
      ]
    )
    assert.deepEqual(
      laterSibling.plan.preparations[0].groups.flatMap((group) =>
        group.variants.flatMap((variant) => variant.entryIds)
      ),
      ['3', '2']
    )
  })
}

test('multi-order assignment follows purchase date and identity across suppliers/months independently of reference order', () => {
  const source = records(['2026-10', '2026-10', '2026-10', '2026-11'])
  source[0].snapshot.purchasedAt = '2026-10-20'
  source[1].snapshot.purchasedAt = '2026-10-10'
  source[2].snapshot.purchasedAt = '2026-10-25'
  source[2].snapshot.sellerMemberLogin = 'another-factory'
  const s = unassignedState(source),
    refs = source.map(({ snapshot }) => ({
      accountId: snapshot.accountId,
      orderId: snapshot.orderId,
      entryId: '1',
    })),
    values = (review) => {
      assert.deepEqual(review.issues, [])
      return review.changes.map(({ orderId, after }) => [orderId, after])
    }
  assert.deepEqual(
    values(planPurchaseCodeReview(s, { entryRefs: [...refs].reverse() })),
    [
      ['102', 'CE26100101'],
      ['101', 'CE26100102'],
      ['103', 'CE26100201'],
      ['104', 'CE26110101'],
    ]
  )
  assert.deepEqual(
    values(planPurchaseCodeReview(s, { entryRefs: refs })),
    values(planPurchaseCodeReview(s, { entryRefs: [...refs].reverse() }))
  )
})

test('equal purchase dates use account/order identity and source order rather than selection order', () => {
  const source = records(['2026-10', '2026-10']),
    s = unassignedState(source),
    refs = source.map(({ snapshot }) => ({
      accountId: 'local',
      orderId: snapshot.orderId,
      entryId: '1',
    }))
  assert.deepEqual(
    planPurchaseCodeReview(s, { entryRefs: [...refs].reverse() }).changes.map(
      ({ orderId, after }) => [orderId, after]
    ),
    [
      ['101', 'CE26100101'],
      ['102', 'CE26100102'],
    ]
  )
})

test('full-order context keeps explicit spreadsheet endings despite different measurement descriptions', () => {
  const s = colourState()
  Object.assign(s.records[0].snapshot, {
    sourceType: 'spreadsheet',
    store: { key: 'market:100', name: 'Synthetic market' },
  })
  for (const [index, item] of s.records[0].snapshot.items.entries()) {
    item.sourceGroup = '5'
    item.sourceVariant = ['a', 'b', 'c'][index]
    item.description = `Synthetic ${['6寸', '10寸', '20寸'][index]}`
  }
  const review = selectedReview(s, ['2'])
  assert.deepEqual(review.issues, [])
  assert.equal(review.changes[0].after, 'CE26100101B')
})

test('unselected unresolved size in another source group cannot block a valid selected product', () => {
  const s = colourState(),
    item = s.records[0].snapshot.items[0]
  s.records[0].snapshot.items.push({
    ...item,
    entryId: '4',
    title: 'Other group',
    productNumber: 'SYNTHETIC-OTHER',
    description: 'Other group',
    sourceSize: 'unknown-size',
    skuProperties: [],
  })
  const review = selectedReview(s, ['2'])
  assert.deepEqual(review.issues, [])
  assert.equal(review.changes[0].after, 'CE26100101B')
})

test('ambiguous previously separated source groups require review instead of assigning a third base', () => {
  const s = colourState(),
    full = createPreparation(s.records[0].snapshot, '2026-10'),
    original = full.groups[0]
  full.groups = original.variants.slice(0, 2).map((variant) => ({
    ...structuredClone(original),
    id: crypto.randomUUID(),
    variants: [variant],
  }))
  const allocation = allocatePreparation(full, [], [], {
    snapshot: s.records[0].snapshot,
  })
  s.preparations = [allocation.preparation]
  s.allocations = allocation.allocations
  s.issuedCodes = allocation.issuedCodes
  const before = structuredClone(s),
    review = selectedReview(s, ['3'])
  assert.equal(review.plan.preparations.length, 0)
  assert.ok(
    review.issues.some(
      (issue) => issue.code === 'PURCHASE_GROUP_REVIEW_REQUIRED'
    )
  )
  assert.deepEqual(s, before)
})

test('a custom assigned ending remains reserved while a new style receives an unused ending', () => {
  let s = colourState()
  s = acceptReview(s, selectedReview(s, ['1']))
  s.preparations[0].groups[0].variants[0].variantSuffix = 'B'
  const before = structuredClone(s),
    review = selectedReview(s, ['2'])
  assert.deepEqual(review.issues, [])
  const variants = review.plan.preparations[0].groups[0].variants
  assert.equal(variants[0].variantSuffix, 'B')
  assert.equal(variants[1].variantSuffix, 'A')
  assert.equal(
    new Set(variants.map((v) => v.variantSuffix + v.sizeSuffix)).size,
    2
  )
  assert.deepEqual(s, before)
})

test('adding selected members preserves scoped-restore coverage without changing existing scope evidence', () => {
  let s = colourState()
  s = acceptReview(s, selectedReview(s, ['1', '2']))
  s.preparations[0].restoreScopes = [['1'], ['2']]
  const review = selectedReview(s, ['3'])
  assert.deepEqual(review.issues, [])
  assert.deepEqual(review.plan.preparations[0].restoreScopes, [
    ['1'],
    ['2'],
    ['3'],
  ])
})

test('later same-identity source rows retain existing shared group and variant identities', () => {
  const s = linkedState(),
    record = s.records[0],
    old = structuredClone(s.preparations[0].groups[0])
  record.snapshot.items.push({
    ...structuredClone(record.snapshot.items[0]),
    entryId: '2',
    quantity: '35',
    price: '7.25',
  })
  const review = selectedReview(s, ['2'])
  assert.deepEqual(review.issues, [])
  const group = review.plan.preparations[0].groups[0]
  assert.equal(group.id, old.id)
  assert.equal(group.sharedProductId, old.sharedProductId)
  assert.equal(
    group.variants[0].sharedVariantId,
    old.variants[0].sharedVariantId
  )
  assert.equal(review.changes[0].after, barcodeValue(old, old.variants[0]))
  assert.deepEqual(group.variants[0].entryIds, ['1', '2'])
})

test('selected new memberships cannot extend a positively consumed product identity', () => {
  const s = state(['2026-10'])
  s.locks = consumptionLocksForManifest(manifest(s))
  s.records[0].snapshot.items.push({
    ...structuredClone(s.records[0].snapshot.items[0]),
    entryId: '2',
    quantity: '35',
  })
  const before = structuredClone(s),
    review = selectedReview(s, ['2'])
  assert.ok(
    review.issues.some((issue) => issue.code === 'CONSUMED_CODE_LINEAGE')
  )
  assert.equal(review.plan.preparations.length, 0)
  assert.deepEqual(s, before)
})

test('identical selected order and supplier IDs in separate accounts allocate independent namespaces', () => {
  const source = records(['2026-10']),
    foreign = structuredClone(source[0])
  foreign.snapshot.accountId = 'another-account'
  const s = unassignedState([...source, foreign]),
    refs = s.records.map(({ snapshot }) => ({
      accountId: snapshot.accountId,
      orderId: snapshot.orderId,
      entryId: '1',
    })),
    review = planPurchaseCodeReview(s, { entryRefs: refs })
  assert.deepEqual(review.issues, [])
  assert.equal(review.plan.preparations.length, 2)
  assert.deepEqual(
    review.changes.map(({ accountId, after }) => [accountId, after]),
    [
      ['another-account', 'CE26100101'],
      ['local', 'CE26100101'],
    ]
  )
})

function state(months) {
  const source = records(months),
    preparations = []
  let packing = { allocations: [], issuedCodes: [] }
  for (const record of source) {
    const result = allocatePreparation(
      createPreparation(
        record.snapshot,
        record.snapshot.purchasedAt.slice(0, 7)
      ),
      packing.allocations,
      packing.issuedCodes,
      { snapshot: record.snapshot }
    )
    packing = result
    preparations.push({ ...result.preparation, revision: 1 })
  }
  return {
    records: source,
    preparations,
    allocations: packing.allocations,
    issuedCodes: packing.issuedCodes,
    locks: [],
  }
}
const ref = (s, index) => ({
  accountId: 'local',
  orderId: s.preparations[index].orderId,
  groupId: s.preparations[index].groups[0].id,
})
function linkedState() {
  const s = state(),
    plan = planSharedProductLink({ source: ref(s, 1), target: ref(s, 0), ...s })
  const changed = new Map(plan.preparations.map((prep) => [prep.orderId, prep]))
  s.preparations = s.preparations.map(
    (prep) => changed.get(prep.orderId) ?? prep
  )
  const packing = activePackingState(
    s.preparations,
    s.allocations,
    s.issuedCodes
  )
  return {
    ...s,
    allocations: packing.allocations,
    issuedCodes: packing.issuedCodes,
  }
}
function manifest(s, { loaded = true, revisionId = 'C/r1' } = {}) {
  const preparation = s.preparations[0],
    group = preparation.groups[0]
  const product = {
    accountId: 'local',
    orderId: preparation.orderId,
    entryId: '1',
    groupId: group.id,
    barcode: barcodeValue(group, group.variants[0]),
    baseCode: group.baseCode,
    quantity: '1',
    preparation,
    record: s.records[0],
  }
  return {
    container: { id: 'C' },
    revisionId,
    revision: 1,
    draft: false,
    status: 'sealed',
    sealedAt: '2026-11-20T12:00:00Z',
    orders: [
      {
        accountId: 'local',
        orderId: preparation.orderId,
        preparation,
        record: s.records[0],
      },
    ],
    products: loaded ? [product] : [],
    cartons: loaded
      ? [
          {
            id: 'unit-1',
            accountId: 'local',
            orderId: preparation.orderId,
            count: 1,
            state: 'loaded',
            markCode: group.baseCode,
          },
        ]
      : [],
    leftBehind: { products: [product], cartons: [], unprepared: [] },
  }
}
const selection = (record) => ({
  orderRefs: [{ accountId: 'local', orderId: record.snapshot.orderId }],
  entryRefs: [
    { accountId: 'local', orderId: record.snapshot.orderId, entryId: '1' },
  ],
})

test('purchase calendar month preserves literal source date across timezone edges and never uses import/device/shipment date', () => {
  for (const date of [
    '2026-09-30T23:30:00-05:00',
    '2026-09-01T00:30:00+14:00',
    '2026-09-30',
    '2026-09-30T23:30:00Z',
  ])
    assert.equal(
      purchaseMonthForCodes({
        snapshot: { purchasedAt: date, observedAt: '2026-11-01T00:00:00Z' },
      }),
      '2026-09'
    )
  for (const invalid of [
    undefined,
    '',
    '09/10/2026',
    '2026-02-30',
    '2025-02-29',
    '2026-13-01',
    '2026-00-01',
    '2026-09-00',
    '2026-09-30junk',
    '2026-09-30T25:00:00Z',
  ])
    assert.equal(
      purchaseMonthForCodes({
        snapshot: { purchasedAt: invalid, observedAt: '2026-10-01T00:00:00Z' },
      }),
      null
    )
  assert.equal(purchaseMonthForCodes({ purchasedAt: '2024-02-29' }), '2024-02')
})

test('manual-confirmed missing-date resolution is explicit, validated and subordinate to original source date', () => {
  const resolution = {
    date: '2026-08-04',
    provenance: 'manual-confirmed',
    updatedAt: '2026-11-01T00:00:00Z',
  }
  assert.equal(
    purchaseMonthForCodes({ snapshot: {}, purchaseDateResolution: resolution }),
    '2026-08'
  )
  assert.equal(
    purchaseMonthForCodes({
      snapshot: { purchasedAt: '2026-09-30T23:00:00Z' },
      purchaseDateResolution: resolution,
    }),
    '2026-09'
  )
  for (const patch of [
    { provenance: 'inferred' },
    { date: '2026-02-30' },
    { date: '2026-08-04T00:00:00Z' },
    { updatedAt: 'bad' },
  ])
    assert.equal(
      purchaseMonthForCodes({
        snapshot: {},
        purchaseDateResolution: { ...resolution, ...patch },
      }),
      null
    )
})

test('review proposes September codes without reserving and emits exact full source-row barcode/photo and revisions', () => {
  const source = records(['2026-09']),
    s = {
      records: source,
      preparations: [],
      allocations: [],
      issuedCodes: [],
      locks: [],
    },
    before = structuredClone(s)
  const review = planPurchaseCodeReview(s, selection(source[0]))
  assert.deepEqual(review.issues, [])
  assert.equal(review.changes[0].baseCode, 'CE26090101')
  assert.equal(review.changes[0].after, 'CE26090101')
  assert.equal(review.changes[0].before, '')
  assert.deepEqual(review.changes[0].photo, source[0].snapshot.items[0])
  assert.equal(review.changes[0].quantity, '10')
  assert.equal(review.changes[0].price, '2.00')
  assert.deepEqual(review.expectedRevisions, [0])
  assert.ok(
    review.plan.expectedSnapshots[0].sourceRevision.includes('purchasedAt')
  )
  assert.equal(
    planPurchaseCodeReview(s, selection(source[0])).changes[0].after,
    review.changes[0].after
  )
  assert.deepEqual(s, before)
  const existing = state(['2026-09'])
  existing.preparations[0].groups[0].variants[0].variantSuffix = 'A'
  existing.preparations[0].groups[0].variants[0].sizeSuffix = 'S'
  assert.equal(
    planPurchaseCodeReview(existing, selection(existing.records[0])).changes[0]
      .after,
    'CE26090101AS'
  )
})

test('missing/ambiguous date, missing supplier, ineligible rows and stale selection yield no effective allocation', () => {
  const source = records([null]),
    s = { records: source, preparations: [], locks: [] }
  let review = planPurchaseCodeReview(s, selection(source[0]))
  assert.equal(review.plan.preparations.length, 0)
  assert.ok(
    review.issues.some((issue) => issue.code === 'PURCHASE_DATE_REQUIRED')
  )
  source[0].snapshot.purchasedAt = '10/11/2026'
  assert.ok(
    planPurchaseCodeReview(s, selection(source[0])).issues.some(
      (issue) => issue.code === 'PURCHASE_DATE_REQUIRED'
    )
  )
  source[0].snapshot.purchasedAt = '2026-09-30'
  source[0].snapshot.sellerMemberLogin = ''
  assert.ok(
    planPurchaseCodeReview(s, selection(source[0])).issues.some(
      (issue) => issue.code === 'SELLER_IDENTITY_REQUIRED'
    )
  )
  source[0].snapshot.sellerMemberLogin = 'factory-id'
  source[0].inventoryDispositions = {
    1: { kind: 'fee', reason: 'Payment row' },
  }
  assert.ok(
    planPurchaseCodeReview(s, selection(source[0])).issues.some(
      (issue) => issue.code === 'PURCHASE_PRODUCT_INELIGIBLE'
    )
  )
  assert.ok(
    planPurchaseCodeReview(s, {
      entryRefs: [{ accountId: 'local', orderId: '101', entryId: 'missing' }],
    }).issues.some((issue) => issue.code === 'PURCHASE_SOURCE_CHANGED')
  )
})

test('existing legacy codes survive missing dates, carryover and unrelated new purchase month without regeneration', () => {
  const s = state(['2026-09'])
  s.records[0].snapshot.purchasedAt = undefined
  const old = structuredClone(s.preparations[0])
  const review = planPurchaseCodeReview(s, selection(s.records[0]))
  assert.deepEqual(review.issues, [])
  assert.equal(review.changes[0].before, review.changes[0].after)
  assert.equal(
    review.plan.preparations[0].groups[0].baseCode,
    old.groups[0].baseCode
  )
  assertPurchaseCodeMonths({
    records: s.records,
    previous: s.preparations,
    preparations: review.plan.preparations,
  })
  assert.deepEqual(s.preparations[0], old)
})

test('new identity month validation rejects shipment month while valid original month and legacy ownership pass', () => {
  const source = records(['2026-09'])
  const wrong = allocatePreparation(
    createPreparation(source[0].snapshot, '2026-11'),
    [],
    []
  ).preparation
  assert.throws(
    () => assertPurchaseCodeMonths({ records: source, preparations: [wrong] }),
    /original purchase calendar month/
  )
  const right = allocatePreparation(
    createPreparation(source[0].snapshot, '2026-09'),
    [],
    []
  ).preparation
  assert.doesNotThrow(() =>
    assertPurchaseCodeMonths({ records: source, preparations: [right] })
  )
  assert.doesNotThrow(() =>
    assertPurchaseCodeMonths({
      records: source,
      previous: [wrong],
      preparations: [wrong],
    })
  )
})

test('cross-month unconsumed repeat links keep target prefix and distinct quantities/prices then unlink into own purchase month', () => {
  const s = state(),
    before = structuredClone(s.records)
  assert.equal(repeatProductCandidates({ source: ref(s, 1), ...s }).length, 2)
  const plan = planSharedProductLink({
    source: ref(s, 1),
    target: ref(s, 0),
    ...s,
  })
  assert.ok(
    plan.preparations.every((prep) => prep.groups[0].baseCode === 'CE26090101')
  )
  assert.equal(
    plan.preparations.find((prep) => prep.orderId === '102').month,
    '2026-10'
  )
  assert.equal(
    plan.preparations.find((prep) => prep.orderId === '102').groups[0].month,
    '2026-09'
  )
  assert.deepEqual(plan.changes.map((row) => row.price).sort(), [
    '2.00',
    '3.00',
  ])
  assert.deepEqual(s.records, before)
  assert.doesNotThrow(() =>
    assertPurchaseCodeMonths({
      records: s.records,
      previous: s.preparations,
      preparations: plan.preparations,
    })
  )
  const final = { ...s, preparations: plan.preparations }
  const unlink = planSharedProductUnlink({ source: ref(final, 1), ...final })
  assert.equal(unlink.preparations[0].groups[0].month, '2026-10')
  assert.equal(unlink.preparations[0].groups[0].baseCode, '')
})

test('draft and zero-loaded seals do not consume; zero seals retain referenced history without freezing eligible linking', () => {
  const s = state()
  assert.deepEqual(
    consumptionLocksForManifest(
      { ...manifest(s), draft: true, status: 'draft' },
      s
    ),
    []
  )
  const locks = consumptionLocksForManifest(manifest(s, { loaded: false }), s)
  assert.ok(
    locks.length > 0 && locks.every((lock) => lock.kind === 'code-history')
  )
  assert.equal(historicalCodeReservations(locks).length, 2)
  assert.doesNotThrow(() =>
    planSharedProductLink({ source: ref(s, 1), target: ref(s, 0), ...s, locks })
  )
  const plan = planSharedProductLink({
    source: ref(s, 1),
    target: ref(s, 0),
    ...s,
    locks,
  })
  const shared = activePackingState(
    plan.preparations,
    s.allocations,
    s.issuedCodes,
    { historicalReservations: historicalCodeReservations(locks) }
  )
  assert.ok(
    shared.issuedCodes.find(
      (code) => code.code === 'CE26090101' && code.kind === 'base'
    ).members.length === 2
  )
})

test('positive seal permanently freezes unshipped aliases and all prepared groups, not just loaded product rows', () => {
  const s = linkedState()
  const extra = createPreparation(
    {
      ...s.records[0].snapshot,
      items: [
        {
          ...s.records[0].snapshot.items[0],
          entryId: '2',
          title: 'Plate',
          productNumber: 'SYNTHETIC-PLATE',
        },
      ],
    },
    '2026-09'
  ).groups[0]
  extra.baseCode = 'CE26090109'
  extra.month = '2026-09'
  s.preparations[0].groups.push(extra)
  const locks = consumptionLocksForManifest(manifest(s), s),
    consumed = locks.find((lock) => lock.kind === 'code-consumption')
  assert.equal(consumed.lineages.length, 2)
  assert.ok(
    consumed.lineages.some((lineage) =>
      lineage.members.some((member) => member.orderId === '102')
    )
  )
  assert.throws(
    () =>
      planSharedProductLink({
        source: ref(s, 2),
        target: ref(s, 1),
        ...s,
        locks,
      }),
    /consumed code lineage/
  )
  assert.throws(
    () => planSharedProductUnlink({ source: ref(s, 1), ...s, locks }),
    /consumed code lineage/
  )
  assert.equal(
    repeatProductCandidates({ source: ref(s, 2), ...s, locks }).length,
    0
  )
  assert.doesNotThrow(() =>
    assertConsumedCodeChanges({
      previous: s.preparations,
      preparations: s.preparations,
      locks,
    })
  )
})

test('amendments/retries preserve first consumption and history after all loading is released', () => {
  const s = linkedState(),
    initial = consumptionLocksForManifest(manifest(s), s)
  const corrected = {
    ...manifest(s, { loaded: false, revisionId: 'C/r2' }),
    sealedAt: '2026-12-01T00:00:00Z',
  }
  const after = consumptionLocksForManifest(corrected, { ...s, locks: initial })
  const lock = after.find((value) => value.kind === 'code-consumption')
  assert.equal(lock.firstRevisionId, 'C/r1')
  assert.equal(lock.consumedAt, '2026-11-20T12:00:00Z')
  assert.deepEqual(
    consumptionLocksForManifest(corrected, { ...s, locks: after }),
    after
  )
  assert.throws(
    () =>
      assertRepeatCodeEligibility({
        references: [ref(s, 1)],
        preparations: s.preparations,
        locks: after,
      }),
    /consumed/
  )
})

test('consumed code changes reject membership/variant edits; amendment-only code correction never opens lineage to new orders', () => {
  const s = linkedState(),
    locks = consumptionLocksForManifest(manifest(s), s)
  const edited = structuredClone(s.preparations[0])
  edited.groups[0].baseCode = 'CE26090108'
  assert.throws(
    () =>
      assertConsumedCodeChanges({
        previous: s.preparations,
        preparations: [edited],
        locks,
      }),
    /consumed code lineage/
  )
  assert.doesNotThrow(() =>
    assertConsumedCodeChanges({
      previous: s.preparations,
      preparations: [edited],
      locks,
      amendment: true,
    })
  )
  const newMember = structuredClone(s.preparations[2])
  newMember.groups[0] = {
    ...structuredClone(s.preparations[1].groups[0]),
    id: newMember.groups[0].id,
  }
  assert.throws(
    () =>
      assertConsumedCodeChanges({
        previous: s.preparations,
        preparations: [newMember],
        locks,
        amendment: true,
      }),
    /cannot admit new links/
  )
  const mutated = structuredClone(s.preparations[0])
  mutated.groups[0].variants[0].entryIds = ['different']
  assert.throws(
    () =>
      assertConsumedCodeChanges({
        previous: s.preparations,
        preparations: [mutated],
        locks,
        amendment: true,
      }),
    /cannot admit new links/
  )
})

test('referenced historical codes cannot be recycled for unrelated later purchases; inactive checkpoint namespace is ignored', () => {
  const s = state(['2026-09']),
    locks = consumptionLocksForManifest(manifest(s, { loaded: false }), s)
  const later = records(['2026-09'])[0]
  later.snapshot.orderId = '999'
  const review = planPurchaseCodeReview(
    { records: [later], preparations: [], locks },
    selection(later)
  )
  assert.deepEqual(review.issues, [])
  assert.equal(review.changes[0].baseCode, 'CE26090102')
  const ordinary = planPurchaseCodeReview(
    {
      records: [later],
      preparations: [],
      locks: [{ kind: 'checkpoint', lineages: locks[0].lineages }],
    },
    selection(later)
  )
  assert.equal(ordinary.changes[0].baseCode, 'CE26090101')
  const original = planPurchaseCodeReview(
    { ...s, locks },
    selection(s.records[0])
  )
  assert.equal(original.changes[0].baseCode, 'CE26090101')
})

test('historical barcode reservations cover actual referenced variants and accumulate across sealed revisions', () => {
  const s = state(['2026-09']),
    group = s.preparations[0].groups[0]
  group.variants.push({
    ...structuredClone(group.variants[0]),
    id: 'second',
    entryIds: ['2'],
    variantSuffix: 'B',
  })
  const first = consumptionLocksForManifest(manifest(s, { loaded: false }), s)
  assert.equal(
    historicalCodeReservations(first).filter((code) => code.kind === 'barcode')
      .length,
    1
  )
  const next = manifest(s, { loaded: false, revisionId: 'C/r2' })
  next.leftBehind.products[0].barcode = barcodeValue(group, group.variants[1])
  const all = consumptionLocksForManifest(next, { ...s, locks: first })
  assert.equal(
    historicalCodeReservations(all).filter((code) => code.kind === 'barcode')
      .length,
    2
  )
})

test('repeat repository checks current locks and exact source revisions again before final save', async () => {
  const s = state(),
    stored = {
      orders: s.records,
      preparations: s.preparations,
      cartonBatches: [],
      shipmentLocks: [],
    }
  let saves = 0
  const repository = createRepeatProductsRepository({
    read: async (stores, callback) => {
      assert.ok(stores.includes('shipmentLocks'))
      return callback({
        objectStore: (name) => ({
          getAll: () => structuredClone(stored[name]),
        }),
      })
    },
    requested: async (value) => value,
    savePreparations: async (values) => {
      saves++
      return values
    },
  })
  const plan = await repository.previewRepeatProductLink({
    source: ref(s, 1),
    target: ref(s, 0),
  })
  const previewSaves = saves
  stored.orders[0].snapshot.items[0].price = '99.99'
  await assert.rejects(
    () => repository.linkRepeatProduct(plan),
    /source order or preparation changed/
  )
  assert.equal(saves, previewSaves)
  stored.orders[0].snapshot.items[0].price = '2.00'
  stored.shipmentLocks = consumptionLocksForManifest(manifest(s), s)
  await assert.rejects(() => repository.linkRepeatProduct(plan), /consumed/)
  assert.equal(saves, previewSaves)
})

test('reviewed supplier resolution fills missing identity with provenance, preserves source and reveals source disagreement', () => {
  const source = records(['2026-09'])[0]
  delete source.snapshot.sellerMemberLogin
  source.snapshot.sellerUnavailable = true
  const original = structuredClone(source.snapshot)
  assert.equal(purchaseSupplierForCodes(source).sellerId, null)
  source.supplierIdentityResolution = {
    sellerId: 'factory-id',
    provenance: 'manual-confirmed',
    updatedAt: '2026-11-01T00:00:00Z',
    reason: 'Reviewed supplier evidence',
  }
  const resolved = purchaseSupplierForCodes(source)
  assert.equal(resolved.sellerId, 'factory-id')
  assert.equal(resolved.storeId, JSON.stringify(['1688', 'factory-id']))
  assert.equal(resolved.provenance, 'manual-confirmed')
  const review = planPurchaseCodeReview(
    { records: [source], preparations: [] },
    selection(source)
  )
  assert.deepEqual(review.issues, [])
  assert.equal(review.plan.preparations[0].sellerId, 'factory-id')
  assert.equal(
    review.changes[0].supplierIdentity.provenance,
    'manual-confirmed'
  )
  assert.deepEqual(source.snapshot, original)
  source.snapshot.sellerUnavailable = false
  source.snapshot.sellerMemberLogin = 'actual-source-seller'
  assert.equal(
    purchaseSupplierForCodes(source).sellerId,
    'actual-source-seller'
  )
  assert.equal(purchaseSupplierForCodes(source).provenance, 'source')
  assert.equal(purchaseSupplierForCodes(source).conflict, true)
  assert.ok(
    planPurchaseCodeReview(
      { records: [source], preparations: [] },
      selection(source)
    ).issues.some((issue) => issue.code === 'SUPPLIER_IDENTITY_CONFLICT')
  )
})

test('resolved same-store source can link without source mutation while display-name equality alone cannot', () => {
  const source = records(['2026-09', '2026-10'])
  delete source[1].snapshot.sellerMemberLogin
  source[1].snapshot.sellerUnavailable = true
  const noResolution = planPurchaseCodeReview(
    { records: source, preparations: [] },
    {
      orderRefs: source.map((record) => ({
        accountId: 'local',
        orderId: record.snapshot.orderId,
      })),
    }
  )
  assert.ok(
    noResolution.issues.some(
      (issue) => issue.code === 'SELLER_IDENTITY_REQUIRED'
    )
  )
  source[1].supplierIdentityResolution = {
    sellerId: 'factory-id',
    provenance: 'manual-confirmed',
    updatedAt: '2026-11-01T00:00:00Z',
  }
  const review = planPurchaseCodeReview(
    { records: source, preparations: [] },
    {
      orderRefs: source.map((record) => ({
        accountId: 'local',
        orderId: record.snapshot.orderId,
      })),
    }
  )
  assert.deepEqual(review.issues, [])
  const s = { records: source, preparations: review.plan.preparations }
  assert.doesNotThrow(() =>
    planSharedProductLink({ source: ref(s, 1), target: ref(s, 0), ...s })
  )
  source[1].supplierIdentityResolution.sellerId = 'different-reviewed-id'
  assert.equal(repeatProductCandidates({ source: ref(s, 1), ...s }).length, 0)
})

test('partial purchase review preserves unselected old identities and adds only selected new source rows', () => {
  const s = state(['2026-09']),
    existing = structuredClone(s.preparations[0].groups[0])
  s.records[0].snapshot.items.push(
    {
      ...s.records[0].snapshot.items[0],
      entryId: '2',
      title: 'Plate',
      productNumber: 'SYNTHETIC-PLATE',
    },
    {
      ...s.records[0].snapshot.items[0],
      entryId: '3',
      title: 'Fork',
      productNumber: 'SYNTHETIC-FORK',
    }
  )
  const review = planPurchaseCodeReview(s, {
    orderRefs: [{ accountId: 'local', orderId: '101' }],
    entryRefs: [{ accountId: 'local', orderId: '101', entryId: '2' }],
  })
  assert.deepEqual(review.issues, [])
  assert.deepEqual(
    review.changes.map((row) => row.entryId),
    ['2']
  )
  assert.deepEqual(
    review.plan.preparations[0].groups.find(
      (group) => group.id === existing.id
    ),
    existing
  )
  assert.ok(
    review.plan.preparations[0].groups.some((group) =>
      group.variants.some((variant) => variant.entryIds.includes('2'))
    )
  )
  assert.ok(
    !review.plan.preparations[0].groups.some((group) =>
      group.variants.some((variant) => variant.entryIds.includes('3'))
    )
  )
})

test('positive order consumption exists without prepared codes and an unchanged unresolved group remains valid evidence', () => {
  const blank = consumptionLocksForManifest(
    {
      container: { id: 'C' },
      revisionId: 'C/r1',
      sealedAt: '2026-11-20T12:00:00Z',
      draft: false,
      status: 'sealed',
      cartons: [
        {
          id: 'unit',
          orderId: '101',
          accountId: 'local',
          count: 1,
          state: 'loaded',
        },
      ],
      products: [],
      leftBehind: { products: [] },
    },
    { preparations: [] }
  )
  assert.equal(blank.length, 1)
  assert.equal(blank[0].kind, 'code-consumption')
  assert.deepEqual(blank[0].lineages, [])
  const s = state()
  assert.throws(
    () =>
      assertRepeatCodeEligibility({
        references: [ref(s, 0)],
        preparations: s.preparations,
        locks: blank,
      }),
    /consumed/
  )
  const unknown = structuredClone(s.preparations[0].groups[0])
  unknown.id = 'unresolved'
  unknown.baseCode = 'CE26090109'
  unknown.variants[0].id = 'unresolved-variant'
  unknown.variants[0].entryIds = ['2']
  unknown.variants[0].needsSizeMapping = true
  s.preparations[0].groups.push(unknown)
  s.records[0].snapshot.items.push({
    ...s.records[0].snapshot.items[0],
    entryId: '2',
  })
  const locks = consumptionLocksForManifest(manifest(s), s)
  assert.doesNotThrow(() =>
    assertConsumedCodeChanges({
      previous: s.preparations,
      preparations: s.preparations,
      locks,
    })
  )
})

test('supplier resolution drift is rejected by repeat wrapper even before its source observation changes', async () => {
  const s = state(),
    stored = {
      orders: s.records,
      preparations: s.preparations,
      cartonBatches: [],
      shipmentLocks: [],
    }
  let saved = 0
  const repository = createRepeatProductsRepository({
    read: async (stores, callback) =>
      callback({
        objectStore: (name) => ({
          getAll: () => structuredClone(stored[name]),
        }),
      }),
    requested: async (value) => value,
    savePreparations: async (values) => {
      saved++
      return values
    },
  })
  const plan = await repository.previewRepeatProductLink({
    source: ref(s, 1),
    target: ref(s, 0),
  })
  stored.orders[1].supplierIdentityResolution = {
    sellerId: 'wrong',
    provenance: 'manual-confirmed',
    updatedAt: '2026-11-01T00:00:00Z',
  }
  const count = saved
  await assert.rejects(
    () => repository.linkRepeatProduct(plan),
    /source order or preparation changed/
  )
  assert.equal(saved, count)
})

test('calendar property: all source months in the supported century ignore offset-induced neighbouring UTC days', () => {
  let count = 0
  for (let year = 2000; year <= 2099; year++)
    for (let month = 1; month <= 12; month++) {
      const m = String(month).padStart(2, '0'),
        last = new Date(Date.UTC(year, month, 0)).getUTCDate()
      for (const [day, time] of [
        [1, '00:01:00+14:00'],
        [last, '23:59:00-12:00'],
      ]) {
        assert.equal(
          purchaseMonthForCodes({
            purchasedAt: `${year}-${m}-${String(day).padStart(2, '0')}T${time}`,
          }),
          `${year}-${m}`
        )
        count++
      }
    }
  assert.equal(count, 2400)
})

test('unreviewed legacy display-owner/canonical supplier mismatch holds linking and preserves codes, owner and history', () => {
  const s = state()
  s.preparations[0].sellerId = 'Legacy displayed owner'
  for (const allocation of s.allocations.filter(
    (value) => value.month === '2026-09'
  ))
    for (const group of allocation.groups)
      group.sellerId = 'Legacy displayed owner'
  for (const reservation of s.issuedCodes.filter(
    (value) => value.month === '2026-09'
  ))
    reservation.sellerId = 'Legacy displayed owner'
  const locks = consumptionLocksForManifest(manifest(s, { loaded: false }), s)
  const original = structuredClone({ ...s, locks })
  const review = planPurchaseCodeReview(
    { ...s, locks },
    selection(s.records[0])
  )
  assert.ok(
    review.issues.some(
      (issue) => issue.code === 'LEGACY_SUPPLIER_IDENTITY_REVIEW_REQUIRED'
    )
  )
  assert.equal(review.plan.preparations.length, 0)
  assert.throws(
    () =>
      planSharedProductLink({
        source: ref(s, 1),
        target: ref(s, 0),
        ...s,
        locks,
      }),
    /legacy supplier code identity/
  )
  assert.equal(
    repeatProductCandidates({ source: ref(s, 1), ...s, locks }).some(
      (candidate) => candidate.orderId === '101'
    ),
    false
  )
  assert.equal(s.preparations[0].groups[0].baseCode, 'CE26090101')
  assert.equal(
    s.issuedCodes.find(
      (value) => value.code === 'CE26090101' && value.kind === 'base'
    ).sellerId,
    'Legacy displayed owner'
  )
  assert.deepEqual({ ...s, locks }, original)
})

test('malformed permanent lock identity/member ownership fails closed instead of freeing a lineage', () => {
  const s = state(),
    locks = consumptionLocksForManifest(manifest(s), s)
  for (const mutate of [
    (lock) => {
      delete lock.accountId
    },
    (lock) => {
      lock.id = 'wrong'
    },
    (lock) => {
      lock.lineages[0].members[0].accountId = 'other'
    },
    (lock) => {
      lock.lineages[0].members = []
    },
    (lock) => {
      lock.lineages[0].reservations = []
    },
  ]) {
    const copied = structuredClone(locks),
      consumed = copied.find((lock) => lock.kind === 'code-consumption')
    mutate(consumed)
    assert.throws(() => historicalCodeReservations(copied), /Historical code/)
    assert.throws(
      () =>
        assertRepeatCodeEligibility({
          references: [ref(s, 0)],
          preparations: s.preparations,
          locks: copied,
        }),
      /Historical code/
    )
  }
})

function legacyOwnerState() {
  const s = state()
  s.preparations[0].sellerId = 'Legacy displayed owner'
  for (const allocation of s.allocations.filter(
    (value) => value.month === '2026-09'
  ))
    for (const group of allocation.groups)
      group.sellerId = 'Legacy displayed owner'
  for (const reservation of s.issuedCodes.filter(
    (value) => value.month === '2026-09'
  ))
    reservation.sellerId = 'Legacy displayed owner'
  return s
}

test('legacy refusal -> one reasoned attestation -> eligible same-store link preserves original code namespace and source bytes', () => {
  const s = legacyOwnerState(),
    before = structuredClone(s)
  assert.throws(
    () => planSharedProductLink({ source: ref(s, 1), target: ref(s, 0), ...s }),
    /legacy supplier code identity/
  )
  const review = planLegacySupplierIdentityReview(s, {
    accountId: 'local',
    orderId: '101',
  })
  assert.equal(review.changes[0].before, 'Legacy displayed owner')
  assert.equal(review.changes[0].after, 'factory-id')
  assert.equal(review.changes[0].codeOwners[0].baseCode, 'CE26090101')
  assert.throws(
    () =>
      applyLegacySupplierIdentityReview({
        state: s,
        plan: review.plan,
        confirmed: true,
        updatedAt: '2026-11-02T00:00:00Z',
        reason: ' ',
      }),
    /reason/
  )
  const confirmed = applyLegacySupplierIdentityReview({
    state: s,
    plan: review.plan,
    confirmed: true,
    updatedAt: '2026-11-02T00:00:00Z',
    reason: 'Reviewed original supplier identity',
  })
  assert.deepEqual(confirmed.snapshot, before.records[0].snapshot)
  assert.equal(
    confirmed.supplierCodeIdentityReview.provenance,
    'manual-confirmed'
  )
  assert.deepEqual(s.issuedCodes, before.issuedCodes)
  assert.deepEqual(s.preparations, before.preparations)
  s.records[0] = confirmed
  assert.ok(
    repeatProductCandidates({ source: ref(s, 1), ...s }).some(
      (candidate) => candidate.orderId === '101'
    )
  )
  const linked = planSharedProductLink({
    source: ref(s, 1),
    target: ref(s, 0),
    ...s,
  })
  const packing = activePackingState(
    linked.preparations,
    s.allocations,
    s.issuedCodes,
    {
      supplierIdentityEquivalences: supplierCodeIdentityEquivalences(s.records),
    }
  )
  assert.equal(
    packing.issuedCodes.find(
      (code) => code.kind === 'base' && code.code === 'CE26090101'
    ).sellerId,
    'Legacy displayed owner'
  )
  assert.ok(
    packing.issuedCodes.every((code) => code.code.startsWith('CE26090101'))
  )
  assert.equal(
    linked.preparations.find((prep) => prep.orderId === '102').sellerId,
    'factory-id'
  )
  for (const prep of linked.preparations)
    validatePreparationReservations({ ...prep, revision: 1 }, packing)
  const code = packing.issuedCodes.find((code) => code.kind === 'barcode'),
    source = linked.preparations.find((prep) => prep.orderId === '102')
  assert.equal(
    codeOwnerEvidence(code, source, packing.issuedCodes).currentGroup.id,
    source.groups[0].id
  )
  const restored = JSON.parse(
    JSON.stringify({
      ...s,
      preparations: linked.preparations,
      allocations: packing.allocations,
      issuedCodes: packing.issuedCodes,
    })
  )
  assert.deepEqual(
    activePackingState(
      restored.preparations,
      restored.allocations,
      restored.issuedCodes
    ),
    packing
  )
  assert.deepEqual(
    restored.records.map((record) => record.snapshot),
    before.records.map((record) => record.snapshot)
  )
  assert.equal(
    restored.records[0].supplierCodeIdentityReview.reason,
    'Reviewed original supplier identity'
  )
})

test('legacy attestation rejects stale source/preparation/equivalence and consumed confirmation requires amendment without unlocking links', () => {
  const s = legacyOwnerState(),
    review = planLegacySupplierIdentityReview(s, {
      accountId: 'local',
      orderId: '101',
    })
  for (const mutate of [
    (value) => {
      value.records[0].snapshot.items[0].price = '100.00'
    },
    (value) => {
      value.preparations[0].revision++
    },
    (value) => {
      value.records[0].supplierCodeIdentityReview = { changed: true }
    },
    (value) => {
      value.records[0].supplierIdentityResolution = {
        sellerId: 'factory-id',
        provenance: 'manual-confirmed',
        updatedAt: '2026-11-01T00:00:00Z',
      }
    },
  ]) {
    const changed = structuredClone(s)
    mutate(changed)
    assert.throws(
      () =>
        applyLegacySupplierIdentityReview({
          state: changed,
          plan: review.plan,
          confirmed: true,
          updatedAt: '2026-11-02T00:00:00Z',
          reason: 'Operator review',
        }),
      /source or preparation changed/
    )
  }
  const locks = consumptionLocksForManifest(manifest(s), s),
    consumed = { ...s, locks }
  const sealedReview = planLegacySupplierIdentityReview(consumed, {
    accountId: 'local',
    orderId: '101',
  })
  assert.equal(sealedReview.requiresAmendment, true)
  assert.throws(
    () =>
      applyLegacySupplierIdentityReview({
        state: consumed,
        plan: sealedReview.plan,
        confirmed: true,
        updatedAt: '2026-11-22T00:00:00Z',
        reason: 'Historical correction',
      }),
    /versioned container amendment/
  )
  const corrected = applyLegacySupplierIdentityReview({
    state: consumed,
    plan: sealedReview.plan,
    confirmed: true,
    amendment: true,
    updatedAt: '2026-11-22T00:00:00Z',
    reason: 'Historical correction',
  })
  assert.throws(
    () =>
      planSharedProductLink({
        source: ref(s, 1),
        target: ref(s, 0),
        ...consumed,
        records: [corrected, ...s.records.slice(1)],
      }),
    /consumed/
  )
  assert.deepEqual(consumed.locks, locks)
})

test('typed packing archives retain reviewed legacy owner equivalence and source values for full and scoped restore', () => {
  const s = legacyOwnerState()
  // Transport fixtures follow the existing 1688 China-time contract. The
  // October literal is September in UTC, so a UTC conversion would be wrong.
  s.records[0].snapshot.purchasedAt = '2026-09-30T23:30:00+08:00'
  s.records[1].snapshot.purchasedAt = '2026-10-01T07:30:00+08:00'
  assert.deepEqual(s.records.slice(0, 2).map(purchaseMonthForCodes), [
    '2026-09',
    '2026-10',
  ])
  assert.equal(
    new Date(s.records[1].snapshot.purchasedAt).toISOString().slice(0, 7),
    '2026-09'
  )
  assert.deepEqual(
    s.preparations
      .slice(0, 2)
      .map((preparation) => preparation.groups[0].baseCode.slice(2, 6)),
    ['2609', '2610']
  )
  for (const record of s.records) {
    const snapshot = record.snapshot,
      amount = `${BigInt(snapshot.items[0].quantity) * BigInt(snapshot.items[0].price.split('.')[0])}.00`
    Object.assign(snapshot, {
      schemaVersion: 1,
      observedAt: new Date(snapshot.observedAt).toISOString(),
      sourceUrl: `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${snapshot.orderId}`,
      status: 'Completed',
      totals: {
        goodsGross: amount,
        goodsNet: amount,
        payable: amount,
        sourceDiscount: '0.00',
        shipping: '0.00',
        orderAdjustment: '0.00',
      },
    })
    Object.assign(snapshot.items[0], {
      thumbnail: '',
      sourceDiscount: '0.00',
      allocatedDiscount: '0.00',
      discount: '0.00',
    })
    Object.assign(record, {
      notes: '',
      tags: [],
      changedEntryIds: [],
      removedEntryIds: [],
      changedAt: snapshot.observedAt,
      lastCheckedAt: snapshot.observedAt,
    })
  }
  for (const reservation of s.issuedCodes)
    if (reservation.ownerSnapshot) reservation.ownerSnapshot.photos = []
  const review = planLegacySupplierIdentityReview(s, {
    accountId: 'local',
    orderId: '101',
  })
  s.records[0] = applyLegacySupplierIdentityReview({
    state: s,
    plan: review.plan,
    confirmed: true,
    updatedAt: '2026-11-02T00:00:00.000Z',
    reason: 'Recorded original supplier/code owner equivalence',
  })
  s.records[0].supplierCodeIdentityReviewUpdatedAt =
    s.records[0].supplierCodeIdentityReview.updatedAt
  const link = planSharedProductLink({
    source: ref(s, 1),
    target: ref(s, 0),
    ...s,
  })
  const packing = activePackingState(
    link.preparations,
    s.allocations,
    s.issuedCodes,
    {
      supplierIdentityEquivalences: supplierCodeIdentityEquivalences(s.records),
    }
  )
  const backup = {
    format: '1688-order-library',
    version: 3,
    exportedAt: '2026-11-03T00:00:00Z',
    orders: s.records,
    preparations: link.preparations,
    history: [],
    images: [],
    ...packing,
  }
  const archive = createPackingBackup(backup, {
    months: ['2026-09'],
    orders: [
      { accountId: 'local', orderId: '101', entryIds: ['1'] },
      { accountId: 'local', orderId: '102', entryIds: ['1'] },
    ],
  })
  const restored = validateBackup(JSON.parse(JSON.stringify(archive)))
  assert.equal(
    hasReviewedSupplierCodeIdentity(
      restored.orders.find((record) => record.snapshot.orderId === '101'),
      restored.preparations.find((preparation) => preparation.orderId === '101')
    ),
    true
  )
  assert.deepEqual(
    restored.orders.find((record) => record.snapshot.orderId === '101')
      .supplierCodeIdentityReview,
    s.records[0].supplierCodeIdentityReview
  )
  assert.equal(
    restored.orders.find((record) => record.snapshot.orderId === '101')
      .supplierCodeIdentityReviewUpdatedAt,
    s.records[0].supplierCodeIdentityReviewUpdatedAt
  )
  assert.deepEqual(
    restored.orders.map((record) => record.snapshot.purchasedAt),
    s.records.slice(0, 2).map((record) => record.snapshot.purchasedAt)
  )
  assert.deepEqual(
    restored.orders.map((record) => record.snapshot.items[0].price),
    ['2.00', '3.00']
  )
  assert.deepEqual(
    restored.preparations.map((prep) => prep.groups[0].baseCode),
    ['CE26090101', 'CE26090101']
  )
  assert.ok(
    restored.issuedCodes.every(
      (code) => code.sellerId === 'Legacy displayed owner'
    )
  )
  const scoped = createPackingBackup(backup, {
    months: ['2026-09'],
    orders: [{ accountId: 'local', orderId: '102', entryIds: ['1'] }],
  })
  const selected = validateBackup(JSON.parse(JSON.stringify(scoped)))
  assert.equal(selected.orders.length, 1)
  assert.equal(selected.orders[0].snapshot.items[0].quantity, '20')
  assert.equal(selected.orders[0].snapshot.items[0].price, '3.00')
  assert.ok(
    selected.issuedCodes.every(
      (code) =>
        code.sellerId === 'Legacy displayed owner' &&
        code.members.length === 1 &&
        code.orderId === '102'
    )
  )
})

test('legacy review routing is exact supplied evidence and key ordering cannot create a false stale review', () => {
  const s = legacyOwnerState()
  s.affectedShipmentRevisions = [
    { containerId: 'C', revisionId: 'C/r1', orderId: '101' },
    { containerId: 'other', revisionId: 'other/r3', orderId: '102' },
  ]
  const reviewed = planLegacySupplierIdentityReview(s, {
    accountId: 'local',
    orderId: '101',
  })
  assert.deepEqual(reviewed.affectedShipmentRevisions, [
    s.affectedShipmentRevisions[0],
  ])
  const reordered = Object.fromEntries(Object.entries(reviewed.plan).reverse())
  assert.doesNotThrow(() =>
    applyLegacySupplierIdentityReview({
      state: s,
      plan: reordered,
      confirmed: true,
      reason: 'Confirmed immutable owner equivalence',
      updatedAt: '2026-11-02T00:00:00Z',
    })
  )
})
