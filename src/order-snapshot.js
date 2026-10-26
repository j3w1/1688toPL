import { deepQuery } from './dom.js'
import { extractOrder, findOrderTable } from './extract.js'
import { purchaseTimestamp } from './order-date.js'
import { centsToMoney, moneyToCents, normalizePrice } from './money.js'
import {
  discountReviewRequired,
  planOrderReconciliation,
  reuseOrderReconciliation,
} from './order-reconciliation.js'
export {
  allocateOrderAdjustment,
  confirmOrderReconciliation,
} from './order-reconciliation.js'

const detailOrigin = 'https://air.1688.com'
const detailPath = '/app/ctf-page/trade-order-detail/index.html'
const amountPattern = '(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?'
const orderDiscountLabels = new Set(['店铺优惠', '活动优惠', '跨店满减'])
const text = (node) => node?.textContent?.trim() || ''
const compact = (value) => value.replace(/\s+/g, '')

function one(query, selector, name) {
  const matches = query.all(selector)
  if (matches.length !== 1)
    throw new Error(
      `${name} is missing or ambiguous. Refresh the order and try again.`
    )
  return matches[0]
}

function readAmount(value, name, { signed = false } = {}) {
  const match = value
    .trim()
    .match(
      new RegExp(
        `^(${signed ? '(?:减少|增加|减|增|加|[+−-])?' : ''})\\s*[¥￥]?\\s*(${amountPattern})\\s*(?:元)?$`
      )
    )
  if (!match) throw new Error(`${name} is missing or invalid.`)
  if (signed && !match[1])
    throw new Error(`${name} has no explicit increase or reduction sign.`)
  const amount = moneyToCents(match[2].replaceAll(',', ''))
  // Signed values use positive reductions and negative increases.
  return /[增加+]/.test(match[1]) ? -amount : amount
}

function orderIdentity(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('The order detail URL is invalid.')
  }
  if (
    !(
      (parsed.origin === detailOrigin && parsed.pathname === detailPath) ||
      (parsed.origin === 'https://trade.1688.com' &&
        parsed.pathname === '/order/new_step_order_detail.htm')
    ) ||
    parsed.searchParams.getAll('orderId').length !== 1 ||
    !/^[1-9]\d*$/.test(parsed.searchParams.get('orderId'))
  )
    throw new Error(
      'A supported order detail URL with a full order ID is required.'
    )
  const orderId = parsed.searchParams.get('orderId')
  return {
    orderId,
    sourceUrl: `${detailOrigin}${detailPath}?orderId=${orderId}`,
  }
}

function validateDisplayedIdentity(appQuery, orderId) {
  const fields = appQuery
    .all('.order-info-receipt-content-item')
    .filter(
      (item) => compact(text(item.querySelector('.field-name'))) === '订单号：'
    )
  if (
    fields.length !== 1 ||
    text(fields[0].querySelectorAll('span')[1]) !== orderId
  )
    throw new Error(
      'The displayed order ID is missing or does not match this page.'
    )
}

function entryIdentity(row, index) {
  const goods = deepQuery(row).one('order-table-goods')?.shadowRoot
  const ids = new Set()
  for (const anchor of deepQuery(goods).all('a[href]')) {
    let url
    try {
      url = new URL(anchor.getAttribute('href'), detailOrigin)
    } catch {
      continue
    }
    if (!url.searchParams.has('order_entry_id')) continue
    const id = url.searchParams.get('order_entry_id')
    if (
      url.origin !== 'https://trade.1688.com' ||
      url.pathname !== '/order/offer_snapshot.htm' ||
      url.searchParams.getAll('order_entry_id').length !== 1 ||
      !/^[1-9]\d*$/.test(id)
    )
      throw new Error(`Row ${index + 1}: product entry ID is invalid.`)
    ids.add(id)
  }
  if (ids.size !== 1)
    throw new Error(
      `Row ${index + 1}: product entry ID is missing or ambiguous.`
    )
  return [...ids][0]
}

function readPurchaseDate(appQuery) {
  // The first timeline event is order creation, before buyer payment. Never
  // substitute subsequent payment/shipping dates or this import's timestamp.
  const steps = appQuery.all(
    'q-step.order-stage-step-item[order="1"][title="等待买家付款"]'
  )
  const dates = new Set(
    steps.map((step) =>
      purchaseTimestamp(
        text(step.querySelector('.order-stage-step-item-content'))
      )
    )
  )
  return dates.size === 1 ? [...dates][0] : undefined
}

function readTotals(appQuery) {
  const host = one(appQuery, 'order-total-price', 'Order totals')
  if (!host.shadowRoot) throw new Error('Order totals are not ready.')
  const query = deepQuery(host.shadowRoot)
  const fields = query.all('.detail-price dl')
  const totals = { sourceDiscount: 0n, orderAdjustment: 0n }
  let unsignedAdjustment
  let foreignCurrencyFeeUnspecified = false
  const labels = new Set()
  for (const field of fields) {
    if (
      field.querySelectorAll('dt').length !== 1 ||
      field.querySelectorAll('dd').length !== 1
    )
      throw new Error('The order total field is missing or ambiguous.')
    const label = compact(text(field.querySelector('dt')))
    const value = text(field.querySelector('dd'))
    if (!label || labels.has(label))
      throw new Error('The order total labels are missing or ambiguous.')
    labels.add(label)
    if (label === '原价总计') totals.goodsGross = readAmount(value, label)
    else if (label === '运费') totals.shipping = readAmount(value, label)
    else if (label === '定制服务')
      totals.customizationService = readAmount(value, 'Customization service')
    else if (label === '外币支付手续费') {
      // The page can show a conversion placeholder with no fee amount.
      // Preserve that uncertainty separately; never manufacture a zero fee.
      if (!['（≈）', '(≈)'].includes(compact(value)))
        throw new Error(
          'The foreign-currency payment fee display is not supported.'
        )
      foreignCurrencyFeeUnspecified = true
    } else if (label === '红包') {
      const discount = readAmount(value, 'Red-packet discount', {
        signed: true,
      })
      if (!/^(?:减少|减|[−-])/.test(value.trim()) || discount < 0n)
        throw new Error('Red-packet discount is not an explicit reduction.')
      totals.redPacketDiscount = discount
    } else if (label === '商品改价') {
      if (/^(?:减少|增加|减|增|加|[+−-])/.test(value.trim()))
        totals.orderAdjustment = readAmount(value, label, { signed: true })
      else unsignedAdjustment = readAmount(value, label)
    } else if (
      label.includes('优惠') ||
      label === '元宝' ||
      orderDiscountLabels.has(label)
    ) {
      const discount = readAmount(value, label, { signed: true })
      if (discount < 0n) throw new Error(`${label} is not a reduction.`)
      totals.sourceDiscount += discount
    } else
      throw Object.assign(new Error(`Unsupported order total: ${label}.`), {
        retryable: false,
      })
  }
  if (totals.goodsGross === undefined || totals.shipping === undefined)
    throw new Error('The original goods total or shipping total is missing.')

  const summaries = query.all('.total-discount')
  if (summaries.length > 1) throw new Error('The discount total is ambiguous.')
  // This optional presentation field can include labels or be empty/hidden.
  // Read an unambiguous amount when available; the authoritative breakdown,
  // product discounts, and payable total are independently reconciled below.
  const summaryAmounts =
    compact(text(summaries[0])).match(new RegExp(amountPattern, 'g')) || []
  if (totals.redPacketDiscount !== undefined && summaryAmounts.length > 1)
    throw new Error('The order discount total is ambiguous.')
  if (
    summaryAmounts.length === 1 &&
    ![
      totals.sourceDiscount,
      totals.sourceDiscount + (totals.redPacketDiscount ?? 0n),
    ].includes(readAmount(summaryAmounts[0], 'Discount total'))
  )
    throw new Error('The order discount total does not match its breakdown.')

  const payable = one(query, '.total-sum-pay', 'Payable total')
  const label = compact(
    text(one(deepQuery(payable), '.sum-pay-label', 'Payable label'))
  )
  if (!['实付款', '待付款'].includes(label))
    throw new Error(
      'This payment total is not supported. A full-order total is required.'
    )
  const value = compact(
    [...payable.childNodes]
      .filter(
        (node) =>
          // Direct comment nodes contain framework markers, not payment text.
          (node.nodeType === 1 || node.nodeType === 3) &&
          !node.classList?.contains('sum-pay-label') &&
          !node.classList?.contains('ask-icon-box')
      )
      .map((node) => node.textContent)
      .join('')
  )
  // Some orders also display a USD conversion. Only the explicitly marked
  // CNY amount participates in reconciliation.
  const match = value.match(
    new RegExp(`^[¥￥](${amountPattern})(?:\\(\\$${amountPattern}\\))?$`)
  )
  if (!match) throw new Error('The CNY payable amount is missing or ambiguous.')
  totals.payable = moneyToCents(match[1].replaceAll(',', ''))
  return {
    foreignCurrencyFeeUnspecified,
    sourceTotals: {
      fields: fields.map((field) => {
        const label = compact(text(field.querySelector('dt')))
        const value = text(field.querySelector('dd'))
        if (label === '外币支付手续费') return { label, unspecified: true }
        const signed =
          label === '红包' ||
          label.includes('优惠') ||
          orderDiscountLabels.has(label) ||
          label === '元宝' ||
          (label === '商品改价' && unsignedAdjustment === undefined)
        return {
          label,
          amount: centsToMoney(readAmount(value, label, { signed })),
          ...(label === '商品改价' && unsignedAdjustment !== undefined
            ? { unsigned: true }
            : {}),
        }
      }),
      payable: centsToMoney(totals.payable),
      ...(summaryAmounts.length === 1
        ? {
            discountSummary: centsToMoney(
              readAmount(summaryAmounts[0], 'Discount total')
            ),
          }
        : {}),
    },
  }
}

/** Read current source evidence and plan all supported complete interpretations. */
export function reviewOrderSnapshot(
  document,
  url,
  { observedAt = new Date().toISOString(), reconciliationReview } = {}
) {
  if (
    typeof observedAt !== 'string' ||
    !Number.isFinite(Date.parse(observedAt))
  )
    throw new Error('The observation timestamp is invalid.')
  const identity = orderIdentity(url)
  const order = extractOrder(document, url)
  const appQuery = deepQuery(document.querySelector('app-root').shadowRoot)
  validateDisplayedIdentity(appQuery, identity.orderId)
  const status = text(
    one(appQuery, '.step-detail-header .stress', 'Order status')
  )
  if (!status) throw new Error('Order status is missing.')
  const sellerUnavailable =
    !order.sellerName || order.sellerName === 'Unknown Seller'
  const rows = deepQuery(findOrderTable(document)).all('tr.table-row')
  const items = order.dataRows.map(({ discount, ...row }, index) => ({
    entryId: entryIdentity(rows[index], index),
    ...row,
    price: normalizePrice(row.price),
    sourceDiscount: discount,
  }))
  const { sourceTotals, foreignCurrencyFeeUnspecified } = readTotals(appQuery)
  const purchasedAt = readPurchaseDate(appQuery)
  const base = {
    schemaVersion: 1,
    accountId: 'local',
    ...identity,
    sellerName: sellerUnavailable ? 'Seller unavailable' : order.sellerName,
    ...(sellerUnavailable ? { sellerUnavailable: true } : {}),
    ...(order.sellerMemberLogin
      ? { sellerMemberLogin: order.sellerMemberLogin }
      : {}),
    ...(order.sellerShopOrigin
      ? { sellerShopOrigin: order.sellerShopOrigin }
      : {}),
    status,
    ...(foreignCurrencyFeeUnspecified
      ? { foreignCurrencyFeeUnspecified: true }
      : {}),
    observedAt: new Date(observedAt).toISOString(),
    ...(purchasedAt ? { purchasedAt } : {}),
    items,
  }
  return reuseOrderReconciliation(
    planOrderReconciliation(base, sourceTotals),
    reconciliationReview
  )
}

/** Existing programmatic callers remain strict until an exact review is supplied. */
export function extractOrderSnapshot(document, url, options = {}) {
  const plan = reviewOrderSnapshot(document, url, options)
  if (plan.status === 'review-required')
    throw discountReviewRequired(plan.review)
  return plan.snapshot
}
