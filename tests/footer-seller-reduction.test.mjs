import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { buildDiscountReviewFixture } from './fixtures/discount-review-fixture.mjs'
import {
  reviewOrderSnapshot,
  extractOrderSnapshot,
} from '../src/order-snapshot.js'
import {
  confirmOrderReconciliation,
  planOrderReconciliation,
  planOrderReconciliationCandidates,
  reuseOrderReconciliation,
  validateReconciliationReview,
} from '../src/order-reconciliation.js'
import { centsToMoney, lineGrossCents, moneyToCents } from '../src/money.js'

const orderId = '9990000000000000001'
const url = `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${orderId}`
const observedAt = '2026-10-27T05:00:00.000Z'
const sum = (items, field) =>
  centsToMoney(items.reduce((n, item) => n + moneyToCents(item[field]), 0n))
function fixture() {
  const { document } = parseHTML('<!doctype html><html><body></body></html>')
  const source = buildDiscountReviewFixture(document, orderId, {
    signedAdjustment: true,
  })
  source.fields['商品改价'].textContent = '减 ¥ 4.50'
  return { document, ...source }
}
const read = (source, options = {}) =>
  reviewOrderSnapshot(source.document, url, { observedAt, ...options })

test('the complete fifteen-row signed footer reduction imports automatically without changing the displayed product discounts', () => {
  const source = fixture()
  const plan = read(source)
  assert.equal(plan.status, 'ready')
  const snapshot = extractOrderSnapshot(source.document, url, { observedAt })
  assert.equal(snapshot.items.length, 15)
  assert.equal(snapshot.totals.goodsGross, '6210.00')
  assert.equal(snapshot.totals.sourceDiscount, '315.50')
  assert.equal(snapshot.totals.orderAdjustment, '4.50')
  assert.equal(snapshot.totals.orderLevelAdjustment, '4.50')
  assert.equal(snapshot.totals.orderDiscount, undefined)
  assert.equal(snapshot.totals.rowIncludedAdjustment, undefined)
  assert.equal(snapshot.totals.goodsNet, '5890.00')
  assert.equal(snapshot.totals.payable, '5960.00')
  assert.equal(sum(snapshot.items, 'allocatedDiscount'), '0.00')
  assert.equal(sum(snapshot.items, 'discount'), '315.50')
  assert.equal(
    centsToMoney(
      snapshot.items.reduce(
        (n, item) =>
          n +
          lineGrossCents(item.price, item.quantity) -
          moneyToCents(item.discount),
        0n
      )
    ),
    '5894.50'
  )
  assert.equal(snapshot.reconciliationReview.version, 2)
  assert.equal(snapshot.reconciliationReview.mode, 'automatic')
  assert.equal(snapshot.reconciliationReview.rule, 'separate-seller-reduction')
  assert.equal(snapshot.reconciliationReview.resolvedAt, observedAt)
  assert.equal(snapshot.reconciliationReview.reviewedAt, undefined)
  assert.deepEqual(
    validateReconciliationReview(snapshot),
    snapshot.reconciliationReview
  )
})

test('the automatic rule follows exact source amounts rather than hardcoding the incident reduction', () => {
  for (const adjustment of ['0.01', '1.25', '9.50']) {
    const source = fixture()
    source.setAmounts({ adjustment })
    source.fields['商品改价'].textContent = `减 ¥ ${adjustment}`
    const plan = read(source)
    assert.equal(plan.status, 'ready')
    assert.equal(plan.snapshot.totals.orderLevelAdjustment, adjustment)
    assert.equal(sum(plan.snapshot.items, 'allocatedDiscount'), '0.00')
    assert.equal(
      moneyToCents(plan.snapshot.totals.payable),
      596450n - moneyToCents(adjustment)
    )
  }
})

test('unsigned adjustments and signed reductions with an unmatched discount breakdown retain explicit review', () => {
  const unsigned = fixture()
  unsigned.fields['商品改价'].textContent = '¥ 4.50'
  const unresolvedSign = read(unsigned)
  assert.equal(unresolvedSign.status, 'review-required')
  assert.equal(unresolvedSign.review.candidates.length, 2)
  assert.throws(
    () => extractOrderSnapshot(unsigned.document, url, { observedAt }),
    { code: 'ORDER_DISCOUNT_REVIEW_REQUIRED' }
  )

  const unmatched = fixture()
  unmatched.fields['PLUS价优惠'].textContent = '减 ¥ 310.75'
  unmatched.total.shadowRoot.querySelector('.total-discount').textContent =
    '345.75'
  unmatched.payable.textContent = '¥ 5959.75'
  const unresolvedAllocation = read(unmatched)
  assert.equal(unresolvedAllocation.status, 'review-required')
  assert.equal(unresolvedAllocation.review.candidates.length, 2)
})

test('price increases keep existing handling and cannot become automatic seller reductions', () => {
  const source = fixture()
  source.fields['商品改价'].textContent = '增 ¥ 2.50'
  source.payable.textContent = '¥ 5967.00'
  const plan = read(source)
  assert.equal(plan.status, 'ready')
  assert.equal(plan.snapshot.totals.orderAdjustment, '-2.50')
  assert.equal(plan.snapshot.totals.orderLevelAdjustment, undefined)
  assert.equal(sum(plan.snapshot.items, 'allocatedDiscount'), '-2.50')
})

test('wholesale reductions already in source prices remain independent from the order-level seller reduction', () => {
  const snapshot = {
    accountId: 'local',
    orderId,
    observedAt,
    items: [
      { entryId: '1', price: '8.00', quantity: '10', sourceDiscount: '5.00' },
    ],
  }
  const source = {
    fields: [
      { label: '原价总计', amount: '100.00' },
      { label: '运费', amount: '0.00' },
      { label: '批发优惠', amount: '20.00' },
      { label: '店铺优惠', amount: '5.00' },
      { label: '商品改价', amount: '4.50' },
    ],
    payable: '70.50',
  }
  const before = structuredClone({ snapshot, source })
  const plan = planOrderReconciliation(snapshot, source)
  assert.equal(plan.status, 'ready')
  assert.equal(plan.snapshot.totals.priceIncludedDiscount, '20.00')
  assert.equal(plan.snapshot.totals.orderLevelAdjustment, '4.50')
  assert.equal(plan.snapshot.items[0].discount, '5.00')
  assert.equal(plan.snapshot.items[0].allocatedDiscount, '0.00')
  assert.equal(plan.snapshot.totals.goodsNet, '70.50')
  assert.deepEqual({ snapshot, source }, before)
})

test('an automatic receipt survives exact-evidence rereads without authoring a new resolution time', () => {
  const source = fixture()
  const first = read(source).snapshot
  source.fields['PLUS价优惠'].textContent = '减 ¥310.500'
  const second = read(source, {
    observedAt: '2026-10-27T06:00:00.000Z',
    reconciliationReview: first.reconciliationReview,
  })
  assert.equal(second.status, 'ready')
  assert.equal(second.snapshot.observedAt, '2026-10-27T06:00:00.000Z')
  assert.deepEqual(
    second.snapshot.reconciliationReview,
    first.reconciliationReview
  )
  assert.deepEqual(second.snapshot.items, first.items)
  source.setAmounts({ adjustment: '1.25' })
  source.fields['商品改价'].textContent = '减 ¥ 1.25'
  const changed = read(source, {
    observedAt: '2026-10-27T07:00:00.000Z',
    reconciliationReview: first.reconciliationReview,
  })
  assert.equal(changed.status, 'ready')
  assert.equal(changed.snapshot.totals.orderLevelAdjustment, '1.25')
  assert.notEqual(
    changed.snapshot.reconciliationReview.evidenceKey,
    first.reconciliationReview.evidenceKey
  )
  assert.equal(
    changed.snapshot.reconciliationReview.resolvedAt,
    '2026-10-27T07:00:00.000Z'
  )
})

test('both historical signed v1 manual choices remain valid and are reused without recosting saved products', () => {
  const automatic = read(fixture())
  const raw = planOrderReconciliationCandidates(
    automatic.snapshot,
    automatic.snapshot.reconciliationReview.sourceTotals
  )
  assert.equal(raw.status, 'review-required')
  for (const candidate of raw.review.candidates) {
    const old = confirmOrderReconciliation(raw.review, {
      choice: candidate.id,
      evidenceKey: raw.review.evidenceKey,
      reviewedAt: observedAt,
    })
    const before = structuredClone(old)
    assert.equal(old.totals.orderLevelAdjustment, undefined)
    assert.equal(old.reconciliationReview.version, 1)
    assert.deepEqual(
      validateReconciliationReview(old),
      old.reconciliationReview
    )
    const reused = reuseOrderReconciliation(automatic, old.reconciliationReview)
    assert.equal(reused.status, 'ready')
    assert.deepEqual(reused.snapshot, old)
    assert.deepEqual(old, before)
  }
})

test('automatic receipts reject forged identity, evidence, interpretation and implied human confirmation', () => {
  const snapshot = read(fixture()).snapshot
  for (const mutate of [
    (value) => {
      value.reconciliationReview.mode = 'manual'
    },
    (value) => {
      value.reconciliationReview.rule = 'other-rule'
    },
    (value) => {
      value.reconciliationReview.choice =
        'seller-reduction-in-rows|wholesale-in-rows|customization-separate'
    },
    (value) => {
      value.reconciliationReview.evidenceKey += 'stale'
    },
    (value) => {
      value.reconciliationReview.resolvedAt = 'invalid'
    },
    (value) => {
      value.reconciliationReview.sourceTotals.payable = '5960.01'
    },
    (value) => {
      value.accountId = 'another-account'
    },
    (value) => {
      value.orderId = '9990000000000000002'
    },
    (value) => {
      value.items[0].entryId = '9990000000000000003'
    },
    (value) => {
      value.totals.orderLevelAdjustment = '1.00'
    },
    (value) => {
      value.items[0].allocatedDiscount = '0.01'
      value.items[0].discount = '15.56'
    },
    (value) => {
      delete value.reconciliationReview
    },
  ]) {
    const forged = structuredClone(snapshot)
    mutate(forged)
    assert.throws(() => validateReconciliationReview(forged))
  }
})

test('incomplete rows and inconsistent payable remain rejected before automatic treatment', () => {
  const snapshot = read(fixture()).snapshot
  const source = snapshot.reconciliationReview.sourceTotals
  assert.throws(
    () =>
      planOrderReconciliation(
        { ...snapshot, items: snapshot.items.slice(1) },
        source
      ),
    /Product rows/
  )
  assert.throws(
    () => planOrderReconciliation(snapshot, { ...source, payable: '5960.01' }),
    /payable/
  )
})
