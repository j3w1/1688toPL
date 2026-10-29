import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createPreparation,
  allocatePreparation,
  barcodeValue,
  validatePreparation,
} from '../src/packing-model.js'
import {
  planProductFamilies,
  validateProductFamilies,
  productFamilySourceKey,
  productFamilySourceMatches,
} from '../src/product-families.js'
import { planPurchaseCodeReview } from '../src/purchase-codes.js'

function source(rows, extra = {}) {
  return {
    accountId: 'local',
    orderId: '201',
    sellerName: 'Synthetic supplier',
    sellerMemberLogin: 'synthetic-supplier',
    purchasedAt: '2026-10-05',
    observedAt: '2026-10-26T00:00:00Z',
    items: rows.map(
      ([productNumber, value, title = 'Synthetic family'], index) => ({
        entryId: String(index + 1),
        productNumber,
        title,
        description: title,
        quantity: '10',
        price: '2.00',
        discount: '0.00',
        skuProperties: [{ label: '颜色', value }],
      })
    ),
    ...extra,
  }
}
const endings = (preparation) =>
  preparation.groups.map((group) =>
    group.variants.map((variant) => variant.variantSuffix + variant.sizeSuffix)
  )

test('uninterrupted model series suggests actual red/pink short/long hat combinations only', () => {
  const snapshot = source([
      ['HAT01401', '红色(短)'],
      ['HAT01403', '红色(长)'],
      ['HAT01402', '粉色(短)'],
    ]),
    before = structuredClone(snapshot)
  const plan = planProductFamilies(snapshot)
  assert.deepEqual(plan.issues, [])
  assert.deepEqual(
    plan.families.map((family) => family.entryIds),
    [['1', '2', '3']]
  )
  const preparation = createPreparation(snapshot, '2026-10')
  assert.deepEqual(endings(preparation), [['AS', 'AL', 'BS']])
  assert.deepEqual(snapshot, before)
})

test('article tokens and explicitly labelled packaging dimensions do not create new cat styles or product sizes', () => {
  const snapshot = source([
    ['9137Y-01', '金色小号(包装尺寸19*14*28.5)'],
    ['9137Y-02', '金色中号(包装尺寸21*16*32)'],
    ['9137Y-03', '金色大号(包装尺寸25*18*40)'],
    ['9137Y-04', '黑色小号'],
    ['9137Y-05', '黑色中号'],
    ['9137Y-06', '黑色大号'],
    ['9137Y-10', '木纹9137Y-10小号'],
    ['9137Y-11', '木纹9137Y-11中号'],
    ['9137Y-12', '木纹9137Y-12大号'],
  ])
  assert.deepEqual(endings(createPreparation(snapshot, '2026-10')), [
    ['AS', 'AM', 'AL', 'BS', 'BM', 'BL', 'CS', 'CM', 'CL'],
  ])
})

test('legacy description-only packaging attributes follow the same product identity exclusion', () => {
  const snapshot = source([
    ['MODEL22A-01', ''],
    ['MODEL22A-01', ''],
  ])
  snapshot.items.forEach((item, index) => {
    delete item.skuProperties
    item.description = `${item.title}\n颜色:红色;包装尺寸:${index ? '20x30x40' : '10x20x30'}cm`
  })
  const draft = createPreparation(snapshot, '2026-10')
  assert.deepEqual(endings(draft), [['']])
  assert.deepEqual(draft.groups[0].variants[0].entryIds, ['1', '2'])
  assert.equal(draft.groups[0].variants[0].size, '')
})

test('description-only family evidence changes with source attributes while older portable keys remain readable', () => {
  const snapshot = source([
    ['MODEL22A-01', ''],
    ['MODEL22A-02', ''],
  ])
  snapshot.items.forEach((item, index) => {
    delete item.skuProperties
    item.description = `${item.title}\n颜色:${index ? 'blue' : 'red'}`
  })
  const key = productFamilySourceKey(snapshot),
    legacy = JSON.parse(key)
  legacy[3].forEach((row) => {
    row[3] = []
  })
  const legacyKey = JSON.stringify(legacy)
  assert.equal(productFamilySourceMatches(snapshot, legacyKey), true)
  const changed = structuredClone(snapshot)
  changed.items[0].description = `${changed.items[0].title}\n颜色:green`
  assert.notEqual(productFamilySourceKey(changed), key)
  const prep = {
    groups: [],
    productFamilies: {
      version: 1,
      sourceKey: legacyKey,
      families: [{ kind: 'family', entryIds: ['1', '2'] }],
    },
  }
  const rebuilt = planProductFamilies(changed, { preparation: prep })
  assert.equal(rebuilt.evidence.sourceKey, productFamilySourceKey(changed))
  assert.equal(rebuilt.families[0].provenance, 'title')
  assert.equal(rebuilt.families[0].identities[0].style, 'green')
})

test('color values in a size field remain styles and a common product size adds no ending', () => {
  const snapshot = source([
    ['MODEL22A-01', '蓝色'],
    ['MODEL22A-02', '粉色'],
  ])
  snapshot.items.forEach((item) => {
    item.skuProperties[0].label = '尺寸'
    item.skuProperties.push({ label: '容量', value: '58ml' })
  })
  assert.deepEqual(endings(createPreparation(snapshot, '2026-10')), [
    ['A', 'B'],
  ])
  assert.deepEqual(
    endings(
      createPreparation(
        source([
          ['MODEL22F-01', '大号'],
          ['MODEL22K-01', '如图所示'],
        ]),
        '2026-10'
      )
    ),
    [['A', 'B']]
  )
})

test('generic article names never merge different titles and numeric siblings need no review', () => {
  const snapshot = source([
    ['玻璃装饰', '金色', 'Synthetic tree'],
    ['玻璃装饰', '金色', 'Synthetic stand'],
  ])
  assert.equal(planProductFamilies(snapshot).families.length, 2)
  assert.deepEqual(
    planProductFamilies(
      source([
        ['100-01', '甲'],
        ['100-02', '乙'],
      ])
    ).issues,
    []
  )
})

test('mixed alphanumeric model series support uninterrupted prefixes without universal numeric stripping', () => {
  for (const articles of [
    ['31PCGJ135', '31PCGJ136'],
    ['09SDCZ03', '09SDCZ04'],
  ]) {
    const snapshot = source(
      articles.map((article, index) => [article, `style ${index + 1}`])
    )
    assert.equal(planProductFamilies(snapshot).families.length, 1)
    assert.deepEqual(planProductFamilies(snapshot).issues, [])
  }
  assert.equal(
    planProductFamilies(
      source([
        ['NUM-01', '甲'],
        ['NUM-02', '乙'],
      ])
    ).issues.length,
    0
  )
})

test('joining a proposed article family without editing identities retains its style disambiguation', () => {
  const snapshot = source([
    ['MODEL22A-01', '金色大号'],
    ['MODEL22A-02', '金色大号'],
  ])
  const draft = createPreparation(snapshot, '2026-10', undefined, undefined, {
    familyChoices: [{ kind: 'family', entryIds: ['1', '2'] }],
  })
  assert.deepEqual(endings(draft), [['A', 'B']])
})

test('identical normalized source identities retain separate accounting rows with one barcode', () => {
  const snapshot = source([
    ['MODEL22A-01', '红色 1cm'],
    ['MODEL22A-01', '红色 10mm'],
  ])
  const prep = createPreparation(snapshot, '2026-10')
  assert.deepEqual(prep.groups[0].variants[0].entryIds, ['1', '2'])
  assert.equal(prep.groups[0].variants.length, 1)
  assert.equal(prep.groups[0].variants[0].needsSizeMapping, false)
})

test('reviewed coding modes and identities are portable version 2 while old version 1 remains valid', () => {
  const snapshot = source([
    ['MODEL22A-01', 'red short'],
    ['MODEL22A-02', 'pink long'],
  ])
  const choices = [
    {
      entryIds: ['1', '2'],
      kind: 'family',
      mode: 'sizes',
      identities: [
        { entryId: '1', style: '', size: 'S' },
        { entryId: '2', style: '', size: 'L' },
      ],
    },
  ]
  const draft = createPreparation(snapshot, '2026-10', undefined, undefined, {
    familyChoices: choices,
  })
  assert.deepEqual(endings(draft), [['S', 'L']])
  assert.equal(validatePreparation(draft).productFamilies.version, 2)
  const old = {
    version: 1,
    sourceKey: productFamilySourceKey(snapshot),
    families: [{ entryIds: ['1', '2'], kind: 'family' }],
  }
  assert.deepEqual(validateProductFamilies(old), old)
  for (const patch of [
    { mode: 'invented' },
    { identities: [{ entryId: '8', style: '', size: '' }] },
    { identities: [{ entryId: '1', style: '', size: '', sizeSuffix: 12 }] },
  ])
    assert.throws(
      () =>
        validateProductFamilies({
          version: 2,
          sourceKey: old.sourceKey,
          families: [{ ...choices[0], ...patch }],
        }),
      /family/
    )
})

test('historical cross-title group cannot merge different titles in a newly prepared purchase', () => {
  const original = source(
    [
      ['PLUSH11A-01', '55cm', 'Synthetic lion'],
      ['PLUSH11B-01', '65cm', 'Synthetic bear'],
      ['PLUSH11C-01', '95cm', 'Synthetic giraffe'],
    ],
    { orderId: '101' }
  )
  const previous = createPreparation(
    original,
    '2026-10',
    undefined,
    undefined,
    {
      familyChoices: [
        { kind: 'family', entryIds: ['1', '2', '3'], mode: 'sizes' },
      ],
    }
  )
  const allocated = allocatePreparation(previous, [], []).preparation
  const current = structuredClone(original)
  current.orderId = '202'
  const state = {
    records: [{ snapshot: original }, { snapshot: current }],
    preparations: [allocated],
    preferences: {},
  }
  const review = planPurchaseCodeReview(state, {
    entryRefs: [{ accountId: 'local', orderId: '202', entryId: '2' }],
  })
  assert.deepEqual(review.issues, [])
  const proposed = review.plan.preparations[0],
    group = proposed.groups[0]
  assert.equal(group.variants.length, 1)
  assert.equal(group.variants[0].sizeSuffix, '')
  assert.equal(group.variants[0].size, '65cm')
  assert.notEqual(group.baseCode, allocated.groups[0].baseCode)
  assert.deepEqual(group.variants[0].entryIds, ['2'])
  assert.equal(review.familyReview[0].families[0].provenance, 'title')
  assert.equal(review.familyReview[0].families.length, 3)
  assert.equal(barcodeValue(group, group.variants[0]), group.baseCode)
})

test('other purchases cannot impose historical group splits or block a new title family', () => {
  const snapshot = source([
    ['MODEL22A-01', 'red'],
    ['MODEL22A-02', 'blue'],
  ])
  const earlier = { ...structuredClone(snapshot), orderId: '101' }
  const prep = createPreparation(earlier, '2026-10')
  const separate = structuredClone(prep)
  separate.orderId = '102'
  separate.groups = prep.groups.flatMap((group) =>
    group.variants.map((variant) => ({
      ...group,
      id: variant.id,
      variants: [variant],
    }))
  )
  const alternate = { ...structuredClone(earlier), orderId: '102' }
  const state = {
    records: [{ snapshot: earlier }, { snapshot: alternate }],
    preparations: [prep, separate],
  }
  assert.deepEqual(planProductFamilies(snapshot, state).issues, [])
  assert.equal(planProductFamilies(snapshot, state).families.length, 1)
  for (const extra of [
    { accountId: 'other' },
    { sellerMemberLogin: 'other-supplier' },
  ]) {
    const plan = planProductFamilies({ ...snapshot, ...extra }, state)
    assert.ok(
      plan.families.every((family) => family.provenance !== 'historical')
    )
  }
})

test('measurement formatting and generic quality wording cannot create extra option identities', () => {
  const snapshot = source([
    ['MODEL22A-01', '红色 10*20(cm)【优质】'],
    ['MODEL22A-01', '红色 10×20cm【品质】'],
  ])
  const draft = createPreparation(snapshot, '2026-10')
  assert.equal(draft.groups.length, 1)
  assert.equal(draft.groups[0].variants.length, 1)
  assert.deepEqual(draft.groups[0].variants[0].entryIds, ['1', '2'])
  assert.deepEqual(endings(draft), [['']])
})

test('a legacy title containing punctuation remains a title rather than a SKU field', () => {
  const snapshot = source([
    ['', 'red'],
    ['', 'blue'],
  ])
  for (const item of snapshot.items) {
    delete item.title
    item.description = `Synthetic vase: glass\n颜色:${item.skuProperties[0].value}`
  }
  const plan = planProductFamilies(snapshot)
  assert.deepEqual(plan.issues, [])
  assert.equal(plan.families[0].title, 'Synthetic vase: glass')
  assert.deepEqual(endings(createPreparation(snapshot, '2026-10')), [
    ['A', 'B'],
  ])
})

test('portable variants-only mode distinguishes complete size options and later selected siblings', () => {
  const snapshot = source([
    ['DEMO-1', 'red S'],
    ['DEMO-2', 'red L'],
  ])
  const familyChoices = [
    {
      accountId: 'local',
      orderId: snapshot.orderId,
      kind: 'family',
      entryIds: ['1', '2'],
      mode: 'variants',
      identities: [
        { entryId: '1', style: 'red', size: 'S' },
        { entryId: '2', style: 'red', size: 'L' },
      ],
    },
  ]
  const draft = createPreparation(snapshot, '2026-10', undefined, undefined, {
    familyChoices,
  })
  assert.deepEqual(endings(draft), [['A', 'B']])
  const state = { records: [{ snapshot }], preparations: [], preferences: {} }
  const first = planPurchaseCodeReview(state, {
    entryRefs: [
      { accountId: 'local', orderId: snapshot.orderId, entryId: '1' },
    ],
    familyChoices,
  })
  assert.deepEqual(first.issues, [])
  assert.equal(first.changes[0].after, 'CE26100101A')
  const assigned = allocatePreparation(first.plan.preparations[0], [], [], {
    snapshot,
  })
  const later = planPurchaseCodeReview(
    {
      ...state,
      preparations: [assigned.preparation],
      allocations: assigned.allocations,
      issuedCodes: assigned.issuedCodes,
    },
    {
      entryRefs: [
        { accountId: 'local', orderId: snapshot.orderId, entryId: '2' },
      ],
    }
  )
  assert.deepEqual(later.issues, [])
  assert.equal(later.changes[0].after, 'CE26100101B')
  assert.deepEqual(
    later.plan.preparations[0].groups[0].variants[0],
    assigned.preparation.groups[0].variants[0]
  )
})
