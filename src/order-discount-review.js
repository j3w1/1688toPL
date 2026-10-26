import {
  bindAttribute,
  bindText,
  createLanguageScope,
  getLanguage,
  message as m,
  setLanguage,
} from './i18n.js'
import { centsToMoney, lineGrossCents, moneyToCents } from './money.js'
import { mountPanelAppearance } from './panel-appearance.js'

const pageSize = 40
const amount = (value = '0.00') => `¥${centsToMoney(moneyToCents(value))}`
const positive = (value) => moneyToCents(value ?? '0.00') > 0n
function focusedElement(document) {
  let active = document.activeElement
  while (active?.shadowRoot?.activeElement)
    active = active.shadowRoot.activeElement
  return active
}

/** A local draft only. The caller rereads source evidence and owns persistence. */
export function openOrderDiscountReview({
  document = globalThis.document,
  review,
  readReview,
  onConfirm,
  opener = focusedElement(document),
  language,
  signal,
  unambiguousMessage = 'This order no longer needs discount review. Cancel and save the order again.',
}) {
  const host = document.createElement('div')
  host.dataset.orderDiscountReview = ''
  const root = host.attachShadow({ mode: 'open' })
  createLanguageScope(host, language ?? getLanguage(opener))
  const releaseAppearance = mountPanelAppearance(host)
  function element(tag, parent = root, source, className) {
    const node = document.createElement(tag)
    if (className) node.className = className
    parent.append(node)
    if (source !== undefined) bindText(node, source)
    return node
  }
  element('style').textContent = `
    :host { all: initial; font: 14px/1.45 system-ui,sans-serif; color: var(--text); }
    * { box-sizing: border-box; }
    dialog { inline-size: min(780px,calc(100vw - 24px)); max-inline-size: calc(100vw - 24px);
      max-block-size: calc(100dvh - 24px); margin: auto; padding: 0; border: 1px solid var(--border);
      border-radius: 12px; color: var(--text); background: var(--surface); font: inherit; }
    dialog[open] { display: flex; flex-direction: column; }
    dialog::backdrop { background: #100d099e; }
    .body { padding: 20px; overflow: auto; min-block-size: 0; }
    h2 { margin: 0 0 10px; font-size: 20px; } h3 { margin: 18px 0 8px; font-size: 15px; }
    p { margin: 8px 0; overflow-wrap: anywhere; } fieldset { padding: 10px; border: 1px solid var(--border); min-inline-size: 0; }
    .source { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; margin: 8px 0; }
    .source dd { margin: 0; text-align: end; font-variant-numeric: tabular-nums; }
    .choice { border-block-end: 1px solid var(--border); padding: 10px 0; }
    .choice:last-child { border: 0; }
    label { display: flex; gap: 8px; align-items: flex-start; overflow-wrap: anywhere; }
    input { flex: 0 0 auto; margin-block-start: 4px; accent-color: var(--accent); }
    .choice dl { margin-inline-start: 24px; } .hint { color: var(--muted); font-size: 12px; }
    .table-wrap { overflow-x: auto; border: 1px solid var(--border); margin-block: 10px; }
    table { border-collapse: collapse; inline-size: 100%; min-inline-size: 540px; font-size: 12px; }
    th,td { padding: 7px; text-align: start; border-block-end: 1px solid var(--border); }
    th { background: var(--field); } .money { text-align: end; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .description { min-inline-size: 120px; max-inline-size: 240px; overflow-wrap: anywhere; white-space: pre-wrap; }
    .pager { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .actions { flex: 0 0 auto; display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px;
      border-block-start: 1px solid var(--border); background: var(--surface); }
    button,select { font: inherit; padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px;
      color: var(--text); background: var(--field); max-inline-size: 100%; }
    button { cursor: pointer; } button.primary { background: var(--accent); color: var(--on-accent); }
    button:disabled { opacity: .6; cursor: default; } :focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
    .language { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-block-end: 12px; }
    .status { margin-block: 12px 0; } .status[data-error] { color: var(--danger-text); }
    @media (max-width: 480px) { .body { padding: 14px; } .actions { padding: 10px 14px; } h2 { font-size: 18px; } }
  `
  const dialog = element('dialog')
  bindAttribute(dialog, 'aria-label', m('Review discounts'))
  const body = element('div', dialog, undefined, 'body')
  const languageLabel = element('label', body, m('Language'), 'language')
  const languageSelect = element('select', languageLabel)
  languageSelect.dataset.action = 'discount-review-language'
  bindAttribute(languageSelect, 'aria-label', m('Language'))
  for (const [value, label] of [
    ['en', 'English'],
    ['es', 'Español'],
    ['zh', '中文'],
  ]) {
    const option = element('option', languageSelect)
    option.value = value
    option.textContent = label
  }
  languageSelect.value = getLanguage(host)
  languageSelect.addEventListener('change', () =>
    setLanguage(languageSelect.value, { scope: host, persist: false })
  )
  element('h2', body, m('Review discounts'))
  const orderLabel = element('p', body, undefined, 'hint')
  element(
    'p',
    body,
    m(
      'The order total balances, but the discount allocation needs your review.'
    )
  )
  element(
    'p',
    body,
    m(
      'Choose how the seller reduction is applied. Both treatments match the payable; product costs differ.'
    )
  )
  element('h3', body, m('Source amounts'))
  const source = element('dl', body, undefined, 'source')
  const form = element('form', body)
  form.noValidate = true
  const choices = element('fieldset', form)
  element('legend', choices, m('Discount treatment'))
  const optionList = element('div', choices)
  const payable = element('p', body)
  element('h3', body, m('Product-cost comparison'))
  element(
    'p',
    body,
    m(
      'Product net excludes shipping, red packets and discounts remaining at order level.'
    ),
    'hint'
  )
  const tableWrap = element('div', body, undefined, 'table-wrap')
  tableWrap.tabIndex = 0
  bindAttribute(tableWrap, 'aria-label', m('Product-cost comparison'))
  const table = element('table', tableWrap)
  const head = element('tr', element('thead', table))
  for (const label of [
    'Source row',
    'Description',
    'Quantity',
    'Row discount',
    'Allocated seller change',
    'Product net',
  ])
    element('th', head, m(label))
  const rows = element('tbody', table)
  element(
    'p',
    body,
    m(
      'Positive allocated changes reduce product cost; negative changes increase it.'
    ),
    'hint'
  )
  const pager = element('div', body, undefined, 'pager')
  const previous = element('button', pager, m('Previous'))
  const pageStatus = element('span', pager)
  const next = element('button', pager, m('Next'))
  previous.dataset.action = 'discount-review-previous'
  next.dataset.action = 'discount-review-next'
  previous.type = next.type = 'button'
  const status = element('p', body, undefined, 'status')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  status.tabIndex = -1
  const actions = element('div', dialog, undefined, 'actions')
  const cancel = element('button', actions, m('Cancel'))
  const confirm = element('button', actions, m('Confirm and save'), 'primary')
  cancel.type = confirm.type = 'button'
  cancel.dataset.action = 'cancel-discount-review'
  confirm.dataset.action = 'confirm-discount-review'
  let current = review,
    selected = review.suggestedChoice || '',
    page = 0,
    saving = false,
    saved = false,
    unavailable = false

  function pair(parent, label, value, raw = false) {
    const term = element('dt', parent)
    if (raw) term.textContent = label
    else bindText(term, m(label))
    element('dd', parent).textContent = value
  }
  function currentCandidate() {
    return current.candidates.find((candidate) => candidate.id === selected)
  }
  function paintRows() {
    const candidate = currentCandidate() ?? current.candidates[0]
    const items = candidate.snapshot.items
    const last = Math.max(0, Math.ceil(items.length / pageSize) - 1)
    page = Math.min(page, last)
    rows.replaceChildren()
    for (const [offset, item] of items
      .slice(page * pageSize, (page + 1) * pageSize)
      .entries()) {
      const row = element('tr', rows)
      element('td', row).textContent = String(page * pageSize + offset + 1)
      element('td', row, undefined, 'description').textContent =
        item.description
      element('td', row, undefined, 'money').textContent = item.quantity
      element('td', row, undefined, 'money').textContent = amount(
        item.sourceDiscount
      )
      element('td', row, undefined, 'money').textContent = amount(
        item.allocatedDiscount
      )
      element('td', row, undefined, 'money').textContent = amount(
        centsToMoney(
          lineGrossCents(item.price, item.quantity) -
            moneyToCents(item.discount)
        )
      )
    }
    bindText(
      pageStatus,
      m('Rows {start}–{end} of {total}', {
        start: items.length ? page * pageSize + 1 : 0,
        end: Math.min((page + 1) * pageSize, items.length),
        total: items.length,
      })
    )
    previous.disabled = page === 0 || saving
    next.disabled = page === last || saving
    pager.hidden = items.length <= pageSize
  }
  function paintReview() {
    bindText(orderLabel, m('Order {orderId}', { orderId: current.orderId }))
    source.replaceChildren()
    for (const field of current.sourceTotals.fields)
      pair(
        source,
        field.label,
        field.unspecified ? '—' : amount(field.amount),
        true
      )
    pair(
      source,
      'Row discounts',
      amount(current.candidates[0].snapshot.totals.sourceDiscount)
    )
    optionList.replaceChildren()
    const hasWholesale = current.sourceTotals.fields.some(
      (field) => field.label === '批发优惠' && positive(field.amount)
    )
    const hasCustomization = current.sourceTotals.fields.some(
      (field) => field.label === '定制服务' && positive(field.amount)
    )
    for (const candidate of current.candidates) {
      const totals = candidate.snapshot.totals
      const sellerChange = moneyToCents(totals.orderAdjustment)
      const sellerLabel =
        sellerChange === 0n
          ? 'No seller price change'
          : sellerChange < 0n
            ? 'Seller price increase is additional'
            : positive(totals.rowIncludedAdjustment)
              ? 'Seller reduction is already included in row discounts'
              : 'Seller reduction is additional to row discounts'
      const allocated =
        sellerChange - moneyToCents(totals.rowIncludedAdjustment ?? '0.00')
      const details = [
        [
          sellerChange < 0n
            ? 'Additional seller increase allocated to products'
            : sellerChange > 0n
              ? 'Additional seller reduction allocated to products'
              : 'Seller change allocated to products',
          amount(centsToMoney(allocated < 0n ? -allocated : allocated)),
        ],
        ['Discount remaining at order level', amount(totals.orderDiscount)],
        ...(hasWholesale
          ? [
              [
                'Wholesale reduction already in row prices',
                amount(totals.priceIncludedDiscount),
              ],
            ]
          : []),
        ...(hasCustomization
          ? [
              [
                'Customization included in original total',
                amount(totals.grossIncludedCustomization),
              ],
            ]
          : []),
      ]
      const choice = element('div', optionList, undefined, 'choice')
      const label = element('label', choice)
      const input = element('input', label)
      input.type = 'radio'
      input.name = 'discount-treatment'
      input.value = candidate.id
      input.dataset.discountChoice = candidate.id
      input.checked = selected === candidate.id
      bindAttribute(input, 'aria-description', () =>
        [
          ...details.map(([label, value]) => `${m(label)}: ${value}`),
          m('Payable remains {amount}', { amount: amount(totals.payable) }),
        ].join('; ')
      )
      element('span', label, m(sellerLabel))
      input.addEventListener('change', () => {
        selected = candidate.id
        status.removeAttribute('data-error')
        bindText(status, '')
        paintRows()
      })
      if (candidate.id === current.suggestedChoice)
        element(
          'p',
          choice,
          m(
            'Suggested from the matching source discounts; confirmation is still required.'
          ),
          'hint'
        )
      const detail = element('dl', choice, undefined, 'source')
      for (const [label, value] of details) pair(detail, label, value)
    }
    bindText(
      payable,
      m('Payable remains {amount}', {
        amount: amount(current.candidates[0].snapshot.totals.payable),
      })
    )
    paintRows()
  }
  previous.addEventListener('click', () => {
    page--
    paintRows()
  })
  next.addEventListener('click', () => {
    page++
    paintRows()
  })
  cancel.addEventListener('click', () => {
    if (!saving) dialog.close()
  })
  dialog.addEventListener('cancel', (event) => {
    if (saving) event.preventDefault()
  })
  async function submit(event) {
    event?.preventDefault()
    if (saving || unavailable) return
    if (!currentCandidate()) {
      bindText(status, m('Choose a discount treatment before saving.'))
      status.dataset.error = 'true'
      optionList.querySelector('input')?.focus()
      return
    }
    saving = true
    choices.disabled =
      cancel.disabled =
      confirm.disabled =
      languageSelect.disabled =
        true
    dialog.setAttribute('aria-busy', 'true')
    bindText(status, m('Confirming discounts and saving…'))
    status.removeAttribute('data-error')
    paintRows()
    try {
      const result = await readReview()
      if (signal?.aborted) return
      if (result.status === 'ready') {
        unavailable = true
        bindText(status, m(unambiguousMessage))
        status.dataset.error = 'true'
        status.focus()
        return
      }
      const fresh = result.review ?? result
      if (fresh.evidenceKey !== current.evidenceKey) {
        current = fresh
        selected = fresh.suggestedChoice || ''
        page = 0
        paintReview()
        bindText(
          status,
          m(
            'The order amounts changed. Review the updated choices and confirm again.'
          )
        )
        status.dataset.error = 'true'
        status.focus()
        return
      }
      await onConfirm(fresh, selected)
      saved = true
      dialog.close()
    } catch (error) {
      bindText(status, error.message)
      status.dataset.error = 'true'
      status.focus()
    } finally {
      saving = false
      choices.disabled = cancel.disabled = languageSelect.disabled = false
      confirm.disabled = unavailable
      dialog.removeAttribute('aria-busy')
      paintRows()
      if (signal?.aborted) dialog.close()
    }
  }
  form.addEventListener('submit', submit)
  confirm.addEventListener('click', submit)
  const abort = () => {
    if (!saving) dialog.close()
  }
  signal?.addEventListener('abort', abort)
  const done = new Promise((resolve) =>
    dialog.addEventListener(
      'close',
      () => {
        signal?.removeEventListener('abort', abort)
        releaseAppearance()
        host.dispatchEvent(new document.defaultView.Event('close'))
        host.remove()
        opener?.isConnected && opener.focus()
        resolve(saved)
      },
      { once: true }
    )
  )
  document.body.append(host)
  paintReview()
  dialog.showModal()
  cancel.focus()
  if (signal?.aborted) abort()
  return done
}
