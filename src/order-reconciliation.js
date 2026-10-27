import {
  centsToMoney,
  lineGrossCents,
  moneyToCents,
  normalizePrice,
} from './money.js'

const orderDiscountLabels = new Set(['店铺优惠', '活动优惠', '跨店满减'])
const reviewMessage =
  'The order total balances, but the discount allocation needs your review.'
const canonicalMoney = (value) => centsToMoney(moneyToCents(value))
const automaticRule = 'separate-seller-reduction'

function invalidReview() {
  return new Error('The saved discount review does not match this order.')
}

/** Preserve normalized, explicitly displayed footer evidence, without HTML. */
export function normalizeReconciliationSource(input) {
  if (!input || !Array.isArray(input.fields) || !input.fields.length)
    throw invalidReview()
  const labels = new Set()
  const fields = input.fields.map((field) => {
    const label = field?.label
    if (
      typeof label !== 'string' ||
      !label ||
      label.length > 160 ||
      /[\s\u0000-\u001f]/.test(label) ||
      labels.has(label)
    )
      throw invalidReview()
    labels.add(label)
    if (label === '外币支付手续费') {
      if (field.unspecified !== true || field.amount !== undefined)
        throw invalidReview()
      return { label, unspecified: true }
    }
    if (
      !['原价总计', '运费', '定制服务', '红包', '商品改价', '元宝'].includes(
        label
      ) &&
      !label.includes('优惠') &&
      !orderDiscountLabels.has(label)
    )
      throw invalidReview()
    const amount = canonicalMoney(field.amount)
    if (moneyToCents(amount) < 0n && label !== '商品改价') throw invalidReview()
    if (
      field.unspecified !== undefined ||
      (field.unsigned !== undefined &&
        (label !== '商品改价' || field.unsigned !== true)) ||
      (field.unsigned && moneyToCents(amount) < 0n)
    )
      throw invalidReview()
    return { label, amount, ...(field.unsigned ? { unsigned: true } : {}) }
  })
  if (!labels.has('原价总计') || !labels.has('运费')) throw invalidReview()
  const payable = canonicalMoney(input.payable)
  if (moneyToCents(payable) < 0n) throw invalidReview()
  const result = {
    fields: fields.sort((a, b) =>
      a.label < b.label ? -1 : a.label > b.label ? 1 : 0
    ),
    payable,
  }
  if (input.discountSummary !== undefined) {
    const summary = canonicalMoney(input.discountSummary)
    const breakdown = fields.reduce(
      (sum, field) =>
        sum +
        (field.label.includes('优惠') ||
        orderDiscountLabels.has(field.label) ||
        field.label === '元宝'
          ? moneyToCents(field.amount)
          : 0n),
      0n
    )
    const redPacket = moneyToCents(
      fields.find((field) => field.label === '红包')?.amount || '0.00'
    )
    if (![breakdown, breakdown + redPacket].includes(moneyToCents(summary)))
      throw invalidReview()
    // This optional display repeats the authoritative breakdown. Validate it,
    // but do not make a hidden/reshown summary change the financial identity.
  }
  return result
}

function sourceAmounts(source) {
  const totals = { sourceDiscount: 0n, orderAdjustment: 0n }
  let orderEligibleDiscount = 0n,
    wholesaleDiscount = 0n,
    unsignedAdjustment
  for (const field of source.fields) {
    const amount = field.unspecified ? undefined : moneyToCents(field.amount)
    if (field.label === '原价总计') totals.goodsGross = amount
    else if (field.label === '运费') totals.shipping = amount
    else if (field.label === '定制服务') totals.customizationService = amount
    else if (field.label === '红包') totals.redPacketDiscount = amount
    else if (field.label === '商品改价') {
      if (field.unsigned) unsignedAdjustment = amount
      else totals.orderAdjustment = amount
    } else if (!field.unspecified) {
      totals.sourceDiscount += amount
      if (orderDiscountLabels.has(field.label)) orderEligibleDiscount += amount
      if (field.label === '批发优惠') wholesaleDiscount += amount
    }
  }
  totals.payable = moneyToCents(source.payable)
  return {
    totals,
    orderEligibleDiscount,
    wholesaleDiscount,
    unsignedAdjustment,
  }
}

/** Allocate a signed reduction in exact cents, preserving source item order. */
export function allocateOrderAdjustment(items, adjustment) {
  const amount = moneyToCents(adjustment)
  const ids = new Set()
  const entries = items.map((item) => {
    if (
      typeof item.entryId !== 'string' ||
      !/^[1-9]\d*$/.test(item.entryId) ||
      ids.has(item.entryId)
    )
      throw new Error('Product entry IDs must be unique decimal strings.')
    ids.add(item.entryId)
    const sourceDiscount = moneyToCents(item.sourceDiscount)
    const weight = lineGrossCents(item.price, item.quantity) - sourceDiscount
    if (sourceDiscount < 0n || weight < 0n)
      throw new Error('A product discount exceeds its original row value.')
    return { entryId: item.entryId, weight, cents: 0n, remainder: 0n }
  })
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0n)
  if (amount > total || (amount !== 0n && total === 0n))
    throw new Error(
      'The order adjustment cannot be allocated to its product values.'
    )
  if (amount === 0n) return entries.map(() => '0.00')
  const absolute = amount < 0n ? -amount : amount
  for (const entry of entries) {
    const numerator = absolute * entry.weight
    entry.cents = numerator / total
    entry.remainder = numerator % total
  }
  let remaining =
    absolute - entries.reduce((sum, entry) => sum + entry.cents, 0n)
  const ranked = [...entries].sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1
    return a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0
  })
  for (const entry of ranked) {
    if (remaining === 0n) break
    entry.cents += 1n
    remaining -= 1n
  }
  return entries.map((entry) =>
    centsToMoney(amount < 0n ? -entry.cents : entry.cents)
  )
}

function financialEvidence(snapshot, sourceTotals) {
  if (
    typeof snapshot.accountId !== 'string' ||
    !snapshot.accountId ||
    typeof snapshot.orderId !== 'string' ||
    !/^[1-9]\d*$/.test(snapshot.orderId) ||
    !Array.isArray(snapshot.items) ||
    !snapshot.items.length
  )
    throw invalidReview()
  // Exact canonical evidence is the key: no lossy hash or floating tolerance.
  return JSON.stringify({
    version: 1,
    accountId: snapshot.accountId,
    orderId: snapshot.orderId,
    items: snapshot.items
      .map((item) => ({
        entryId: item.entryId,
        price: normalizePrice(item.price),
        quantity: String(BigInt(item.quantity)),
        sourceDiscount: canonicalMoney(item.sourceDiscount),
      }))
      .sort((a, b) => a.entryId.localeCompare(b.entryId, 'en')),
    sourceTotals,
  })
}

function candidateId(candidate) {
  return [
    candidate.orderAdjustment === 0n
      ? 'no-seller-change'
      : candidate.orderAdjustment < 0n
        ? 'seller-increase-additional'
        : candidate.rowIncludedAdjustment > 0n
          ? 'seller-reduction-in-rows'
          : 'seller-reduction-additional',
    candidate.priceIncludedDiscount > 0n
      ? 'wholesale-in-prices'
      : 'wholesale-in-rows',
    candidate.grossIncludedCustomization > 0n
      ? 'customization-in-gross'
      : 'customization-separate',
  ].join('|')
}

/** Enumerate supported interpretations, including those retained by v1 receipts. */
export function planOrderReconciliationCandidates(snapshot, rawSourceTotals) {
  const sourceTotals = normalizeReconciliationSource(rawSourceTotals)
  const {
    totals,
    orderEligibleDiscount,
    wholesaleDiscount,
    unsignedAdjustment,
  } = sourceAmounts(sourceTotals)
  const items = snapshot.items
  const actualGross = items.reduce(
    (sum, item) => sum + lineGrossCents(item.price, item.quantity),
    0n
  )
  const actualDiscount = items.reduce(
    (sum, item) => sum + moneyToCents(item.sourceDiscount),
    0n
  )
  const grossCandidates = [
    0n,
    ...(totals.customizationService > 0n ? [totals.customizationService] : []),
  ]
    .map((grossIncludedCustomization) => ({
      grossIncludedCustomization,
      priceIncludedDiscount:
        totals.goodsGross - actualGross - grossIncludedCustomization,
    }))
    .filter(
      ({ priceIncludedDiscount }) =>
        priceIncludedDiscount === 0n ||
        priceIncludedDiscount === wholesaleDiscount
    )
  if (!grossCandidates.length)
    throw new Error(
      'Product rows do not reconcile with the order totals. The order may be incomplete.'
    )
  const adjustments =
    unsignedAdjustment === undefined
      ? [totals.orderAdjustment]
      : [...new Set([unsignedAdjustment, -unsignedAdjustment])]
  const candidates = adjustments.flatMap((orderAdjustment) =>
    grossCandidates.flatMap((gross) =>
      [0n, ...(orderAdjustment > 0n ? [orderAdjustment] : [])]
        .map((rowIncludedAdjustment) => {
          const orderDiscount =
            totals.sourceDiscount -
            gross.priceIncludedDiscount +
            rowIncludedAdjustment -
            actualDiscount
          return {
            ...gross,
            orderAdjustment,
            rowIncludedAdjustment,
            orderDiscount,
            goodsNet:
              actualGross -
              actualDiscount -
              (orderAdjustment - rowIncludedAdjustment) -
              orderDiscount,
          }
        })
        .filter(
          ({ orderDiscount, rowIncludedAdjustment }) =>
            orderDiscount >= 0n &&
            orderDiscount <= orderEligibleDiscount &&
            rowIncludedAdjustment <= actualDiscount
        )
    )
  )
  if (!candidates.length)
    throw new Error(
      'Product rows do not reconcile unambiguously with the order totals. The order may be incomplete.'
    )
  const reconciled = candidates.filter(
    ({ goodsNet }) =>
      goodsNet >= 0n &&
      totals.payable >= 0n &&
      goodsNet +
        totals.shipping +
        (totals.customizationService ?? 0n) -
        (totals.redPacketDiscount ?? 0n) ===
        totals.payable
  )
  if (!reconciled.length)
    throw new Error(
      'The payable amount does not reconcile with the order totals.'
    )
  const planned = reconciled.map((candidate) => {
    const resultTotals = {
      ...totals,
      sourceDiscount: actualDiscount,
      orderAdjustment: candidate.orderAdjustment,
      goodsNet: candidate.goodsNet,
    }
    for (const key of [
      'grossIncludedCustomization',
      'priceIncludedDiscount',
      'rowIncludedAdjustment',
      'orderDiscount',
    ])
      if (candidate[key] > 0n) resultTotals[key] = candidate[key]
    const allocations = allocateOrderAdjustment(
      items,
      centsToMoney(candidate.orderAdjustment - candidate.rowIncludedAdjustment)
    )
    const {
      reconciliationReview: ignored,
      foreignCurrencyFeeUnspecified: ignoredFee,
      ...base
    } = snapshot
    return {
      id: candidateId(candidate),
      snapshot: {
        ...base,
        ...(sourceTotals.fields.some((field) => field.unspecified)
          ? { foreignCurrencyFeeUnspecified: true }
          : {}),
        items: items.map((item, index) => ({
          ...item,
          allocatedDiscount: allocations[index],
          discount: centsToMoney(
            moneyToCents(item.sourceDiscount) + moneyToCents(allocations[index])
          ),
        })),
        totals: Object.fromEntries(
          Object.entries(resultTotals).map(([name, amount]) => [
            name,
            centsToMoney(amount),
          ])
        ),
      },
    }
  })
  if (planned.length === 1)
    return { status: 'ready', snapshot: planned[0].snapshot }
  const review = {
    version: 1,
    accountId: snapshot.accountId,
    orderId: snapshot.orderId,
    evidenceKey: financialEvidence(snapshot, sourceTotals),
    sourceTotals,
    candidates: planned,
  }
  const suggested = planned.find(
    (candidate) =>
      !candidate.snapshot.totals.rowIncludedAdjustment &&
      moneyToCents(candidate.snapshot.totals.orderAdjustment) > 0n &&
      actualDiscount ===
        totals.sourceDiscount -
          moneyToCents(
            candidate.snapshot.totals.priceIncludedDiscount || '0.00'
          )
  )
  if (suggested) review.suggestedChoice = suggested.id
  return { status: 'review-required', review }
}

function readyCandidate(snapshot) {
  return {
    id: candidateId(
      Object.fromEntries(
        [
          'orderAdjustment',
          'rowIncludedAdjustment',
          'priceIncludedDiscount',
          'grossIncludedCustomization',
        ].map((field) => [
          field,
          moneyToCents(snapshot.totals[field] || '0.00'),
        ])
      )
    ),
    snapshot,
  }
}

/** Keep a separately itemized seller reduction outside the observed row discounts. */
export function planOrderReconciliation(snapshot, rawSourceTotals) {
  const plan = planOrderReconciliationCandidates(snapshot, rawSourceTotals)
  const sourceTotals = normalizeReconciliationSource(rawSourceTotals)
  const sellerChange = sourceTotals.fields.find(
    (field) => field.label === '商品改价'
  )
  if (
    !sellerChange ||
    sellerChange.unsigned ||
    moneyToCents(sellerChange.amount) <= 0n
  )
    return plan
  const { totals } = sourceAmounts(sourceTotals)
  const rowDiscount = snapshot.items.reduce(
    (sum, item) => sum + moneyToCents(item.sourceDiscount),
    0n
  )
  const candidates =
    plan.status === 'review-required'
      ? plan.review.candidates
      : [readyCandidate(plan.snapshot)]
  const eligible = candidates.filter(
    ({ snapshot: candidate }) =>
      !moneyToCents(candidate.totals.rowIncludedAdjustment || '0.00') &&
      moneyToCents(candidate.totals.orderAdjustment) ===
        moneyToCents(sellerChange.amount) &&
      rowDiscount ===
        totals.sourceDiscount -
          moneyToCents(candidate.totals.priceIncludedDiscount || '0.00')
  )
  if (eligible.length !== 1) return plan
  const selected = eligible[0]
  const resolvedAt = new Date(snapshot.observedAt || Date.now()).toISOString()
  return {
    status: 'ready',
    snapshot: {
      ...selected.snapshot,
      items: selected.snapshot.items.map((item) => ({
        ...item,
        allocatedDiscount: '0.00',
        discount: canonicalMoney(item.sourceDiscount),
      })),
      totals: {
        ...selected.snapshot.totals,
        orderLevelAdjustment: canonicalMoney(sellerChange.amount),
      },
      reconciliationReview: {
        version: 2,
        mode: 'automatic',
        rule: automaticRule,
        choice: selected.id,
        resolvedAt,
        evidenceKey: financialEvidence(snapshot, sourceTotals),
        sourceTotals,
      },
    },
  }
}

export function discountReviewRequired(review) {
  return Object.assign(new Error(reviewMessage), {
    code: 'ORDER_DISCOUNT_REVIEW_REQUIRED',
    retryable: false,
    review,
  })
}

/** The caller must supply a newly read review before accepting a UI choice. */
export function confirmOrderReconciliation(
  review,
  { choice, evidenceKey, reviewedAt = new Date().toISOString() } = {}
) {
  if (
    review?.version !== 1 ||
    !Array.isArray(review.candidates) ||
    review.candidates.length < 2 ||
    typeof evidenceKey !== 'string' ||
    evidenceKey !== review.evidenceKey ||
    typeof reviewedAt !== 'string' ||
    !Number.isFinite(Date.parse(reviewedAt))
  )
    throw invalidReview()
  const selected = review.candidates.find(
    (candidate) => candidate.id === choice
  )
  if (!selected) throw invalidReview()
  const regenerated = planOrderReconciliationCandidates(
    selected.snapshot,
    review.sourceTotals
  )
  if (
    regenerated.status !== 'review-required' ||
    regenerated.review.evidenceKey !== evidenceKey
  )
    throw invalidReview()
  const candidate = regenerated.review.candidates.find(
    (item) => item.id === choice
  )
  if (!candidate) throw invalidReview()
  return {
    ...candidate.snapshot,
    reconciliationReview: {
      version: 1,
      choice,
      reviewedAt: new Date(reviewedAt).toISOString(),
      evidenceKey,
      sourceTotals: regenerated.review.sourceTotals,
    },
  }
}

export function reuseOrderReconciliation(plan, receipt) {
  if (!receipt) return plan
  try {
    const context =
      plan.status === 'review-required'
        ? {
            snapshot: plan.review.candidates[0].snapshot,
            sourceTotals: plan.review.sourceTotals,
          }
        : plan.snapshot.reconciliationReview?.version === 2
          ? {
              snapshot: plan.snapshot,
              sourceTotals: plan.snapshot.reconciliationReview.sourceTotals,
            }
          : null
    if (
      !context ||
      JSON.stringify(normalizeReconciliationSource(receipt.sourceTotals)) !==
        JSON.stringify(context.sourceTotals)
    )
      return plan
    if (receipt.version === 2) {
      const snapshot = { ...context.snapshot, reconciliationReview: receipt }
      const saved = validateReconciliationReview(snapshot)
      return {
        status: 'ready',
        snapshot: { ...snapshot, reconciliationReview: saved },
      }
    }
    if (receipt.version !== 1 || typeof receipt.reviewedAt !== 'string')
      return plan
    const historical = planOrderReconciliationCandidates(
      context.snapshot,
      context.sourceTotals
    )
    if (historical.status !== 'review-required') return plan
    const snapshot = confirmOrderReconciliation(historical.review, receipt)
    return { status: 'ready', snapshot }
  } catch {
    return plan
  }
}

function interpretedOutput(value) {
  return {
    totals: Object.fromEntries(
      Object.entries(value.totals)
        .sort(([a], [b]) => a.localeCompare(b, 'en'))
        .map(([name, amount]) => [name, canonicalMoney(amount)])
    ),
    items: value.items.map((item) => ({
      entryId: item.entryId,
      allocatedDiscount: canonicalMoney(item.allocatedDiscount),
      discount: canonicalMoney(item.discount),
    })),
  }
}

/** Rebuild every interpreted amount before accepting receipt-bearing storage. */
export function validateReconciliationReview(snapshot) {
  const receipt = snapshot.reconciliationReview
  if (receipt === undefined) {
    if (moneyToCents(snapshot.totals?.orderLevelAdjustment || '0.00') !== 0n)
      throw invalidReview()
    return undefined
  }
  if (snapshot.source === 'other' || snapshot.sourceType === 'spreadsheet')
    throw invalidReview()
  if (!receipt || ![1, 2].includes(receipt.version)) throw invalidReview()
  const source = normalizeReconciliationSource(receipt.sourceTotals)
  if (
    Boolean(snapshot.foreignCurrencyFeeUnspecified) !==
    source.fields.some((field) => field.unspecified)
  )
    throw invalidReview()
  if (receipt.version === 2) {
    if (
      receipt.mode !== 'automatic' ||
      receipt.rule !== automaticRule ||
      typeof receipt.resolvedAt !== 'string' ||
      !Number.isFinite(Date.parse(receipt.resolvedAt))
    )
      throw invalidReview()
    const automatic = planOrderReconciliation(snapshot, source)
    const expected =
      automatic.status === 'ready' && automatic.snapshot.reconciliationReview
    if (
      !expected ||
      expected.version !== 2 ||
      receipt.choice !== expected.choice ||
      receipt.evidenceKey !== expected.evidenceKey ||
      JSON.stringify(interpretedOutput(snapshot)) !==
        JSON.stringify(interpretedOutput(automatic.snapshot))
    )
      throw invalidReview()
    return {
      ...expected,
      resolvedAt: new Date(receipt.resolvedAt).toISOString(),
    }
  }
  if (typeof receipt.reviewedAt !== 'string') throw invalidReview()
  const plan = planOrderReconciliationCandidates(snapshot, receipt.sourceTotals)
  if (plan.status !== 'review-required') throw invalidReview()
  const reviewed = confirmOrderReconciliation(plan.review, receipt)
  if (
    JSON.stringify(interpretedOutput(snapshot)) !==
    JSON.stringify(interpretedOutput(reviewed))
  )
    throw invalidReview()
  return reviewed.reconciliationReview
}
