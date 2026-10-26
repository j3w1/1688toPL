import { buildOrderFixture } from './order-fixture.mjs'

/** Numeric regression evidence only: descriptions, identities and images are synthetic. */
export function buildDiscountReviewFixture(document, orderId, options = {}) {
  const pattern = [
    ['5.10', '60', '15.55'],
    ['4.60', '60', '14.02'],
    ['9.20', '60', '28.04'],
    ['5.30', '30', '8.08'],
    ['5.30', '30', '8.08'],
    ['6.60', '60', '20.12'],
    ['22.80', '20', '23.17'],
    ['22.80', '20', '23.17'],
    ['4.20', '30', '6.40'],
    ['24.00', '24', '29.26'],
    ['24.00', '24', '29.26'],
    ['24.00', '24', '29.27'],
    ['10.80', '60', '32.92'],
    ['6.80', '60', '20.73'],
    ['9.00', '60', '27.43'],
  ]
  const rowCount = options.rowCount ?? 15
  const cents = (value) => BigInt(String(value).replace('.', ''))
  const money = (value) =>
    `${value / 100n}.${String(value % 100n).padStart(2, '0')}`
  const rows = Array.from({ length: rowCount }, (_, index) => {
    const [price, quantity, discount] = pattern[index % pattern.length]
    return {
      title: `Synthetic product ${index + 1}`,
      sku: `款式：${index + 1}`,
      productNumber: `货号：SYN-${index + 1}`,
      price,
      quantity,
      discounts: [],
      discountSummary: `优惠共${discount}元`,
      sourceDiscount: discount,
    }
  })
  const built = buildOrderFixture(document, {
    sellerName: 'Synthetic discount supplier',
    rows,
  })
  const app = built.appRoot.shadowRoot
  const identity = document.createElement('div')
  identity.className = 'order-info-receipt-content-item'
  identity.innerHTML = `<span class="field-name">订单号：</span><span>${orderId}</span>`
  built.orderInfo.shadowRoot.append(identity)
  const status = document.createElement('div')
  status.className = 'step-detail-header'
  status.innerHTML = '<span class="stress">等待卖家发货</span>'
  app.append(status)
  const stage = document.createElement('q-step')
  stage.className = 'order-stage-step-item'
  stage.setAttribute('order', '1')
  stage.setAttribute('title', '等待买家付款')
  stage.innerHTML =
    '<span class="order-stage-step-item-content">2026-10-20 10:00:00</span>'
  app.append(stage)
  const sourceDomain =
    options.sourceDomain ??
    (document.location?.hostname?.endsWith('.test') ? 'test' : 'com')
  for (const [index, cell] of built.cells.entries())
    cell.goods.root
      .querySelector('goods-content')
      .shadowRoot.querySelector('a').href =
      `https://trade.1688.${sourceDomain}/order/offer_snapshot.htm?order_entry_id=${orderId}${index + 1}`
  const total = document.createElement('order-total-price')
  total.attachShadow({ mode: 'open' })
  total.shadowRoot.innerHTML =
    '<div class="detail-price"></div><div class="total-discount"></div><div class="total-sum-pay"><span class="sum-pay-label">实付款</span><span data-payable></span></div>'
  app.append(total)
  const fields = {}
  function field(label, value) {
    const entry = document.createElement('dl')
    const name = document.createElement('dt')
    name.textContent = label
    const amount = document.createElement('dd')
    amount.textContent = value
    entry.append(name, amount)
    total.shadowRoot.querySelector('.detail-price').append(entry)
    fields[label] = amount
  }
  const gross = rows.reduce(
    (sum, row) => sum + cents(row.price) * BigInt(row.quantity),
    0n
  )
  const rowDiscount = rows.reduce(
    (sum, row) => sum + cents(row.sourceDiscount),
    0n
  )
  const state = {
    adjustment: options.ambiguous === false ? '0.00' : '4.50',
    shop: '5.00',
    shipping: '100.00',
    redPacket: '30.00',
    ...options.amounts,
  }
  field('原价总计', `¥ ${money(gross)}`)
  field('运费', '')
  field('商品改价', '')
  field('PLUS价优惠', '')
  field('店铺优惠', '')
  field('红包', '')
  const payable = total.shadowRoot.querySelector('[data-payable]')
  function setAmounts(changes = {}) {
    Object.assign(state, changes)
    fields['运费'].textContent = `¥ ${state.shipping}`
    fields['商品改价'].textContent = `减 ¥ ${state.adjustment}`
    fields['PLUS价优惠'].textContent =
      `减 ¥ ${money(rowDiscount - cents(state.shop))}`
    fields['店铺优惠'].textContent = `减 ¥ ${state.shop}`
    fields['红包'].textContent = `减 ¥ ${state.redPacket}`
    total.shadowRoot.querySelector('.total-discount').textContent = money(
      rowDiscount + cents(state.redPacket)
    )
    payable.textContent = `¥ ${money(gross - rowDiscount - cents(state.adjustment) + cents(state.shipping) - cents(state.redPacket))}`
  }
  setAmounts()
  return { ...built, fields, payable, total, setAmounts }
}
