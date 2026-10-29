import { element as el } from './ui.js'
import { message as m, bindText, bindAttribute } from './i18n.js'
import { createVirtualList } from './virtual-list.js'
import { normalizePrice } from './money.js'

export function storeUpdatePriceDifference(before, after) {
  const [a, af] = normalizePrice(before).split('.'),
    [b, bf] = normalizePrice(after).split('.'),
    digits = Math.max(af.length, bf.length),
    difference =
      BigInt(b + bf.padEnd(digits, '0')) - BigInt(a + af.padEnd(digits, '0')),
    absolute = difference < 0n ? -difference : difference,
    value = String(absolute).padStart(digits + 1, '0')
  return `${difference < 0n ? '-' : difference > 0n ? '+' : ''}${value.slice(0, -digits)}.${value.slice(-digits)}`
}

/** Display the same blocker once, retaining each affected row/batch context. */
export function storeUpdateReviewIssues(review) {
  const unique = new Map()
  for (const issue of review.issues || []) {
    const batchId = issue.batchId || issue.detail?.batchId,
      batch = review.cartonBatchChanges?.find(
        (change) => (change.before || change.after)?.id === batchId
      ),
      affected = new Set(
        issue.entryIds ||
          batch?.before?.contents?.map((item) => item.entryId) ||
          []
      ),
      row = review.rowChanges?.find((change) =>
        (issue.incomingRow ?? issue.row) != null
          ? change.incomingRow === (issue.incomingRow ?? issue.row)
          : change.before?.entryIds.some((id) => affected.has(id))
      ),
      entries = new Set(row?.after?.entryIds || row?.before?.entryIds || []),
      group = review.preparation?.groups.find((value) =>
        value.variants.some((variant) =>
          variant.entryIds.some((id) => entries.has(id))
        )
      ),
      contextual = {
        ...issue,
        ...(row
          ? {
              incomingRow: row.incomingRow,
              previousRow: row.previousRow,
              sourceGroup: (row.after || row.before)?.group,
              ...(group && !issue.groupId ? { groupId: group.id } : {}),
            }
          : {}),
      },
      key = JSON.stringify([
        contextual.code,
        contextual.message,
        contextual.severity,
        contextual.incomingRow ?? contextual.row,
        contextual.previousRow,
        batchId,
        contextual.groupId,
        contextual.variantId,
        contextual.field,
        contextual.params,
        contextual.values,
        contextual.conflict,
        contextual.containerIds,
        contextual.containerNames,
        contextual.detail,
        contextual.beforeCount,
        contextual.afterCount,
        contextual.received,
        contextual.loaded,
      ])
    if (!unique.has(key)) unique.set(key, contextual)
  }
  return [...unique.values()]
}

export function storeUpdateIssueContext(issue) {
  if (issue.sourceGroup && issue.incomingRow != null)
    return m(' · Group {group} · Excel row {row}', {
      group: issue.sourceGroup,
      row: issue.incomingRow,
    })
  if (issue.sourceGroup && issue.previousRow != null)
    return m(' · Group {group} · Saved row {row}', {
      group: issue.sourceGroup,
      row: issue.previousRow,
    })
  if (issue.sourceGroup) return m(' · Group {0}', { 0: issue.sourceGroup })
  if ((issue.incomingRow ?? issue.row) != null)
    return m(' · Excel row {0}', { 0: issue.incomingRow ?? issue.row })
  return ''
}

export function storeUpdateOperationalContext(issue) {
  if (issue.afterCount == null) return ''
  return m(
    ' · Received: {received} · Loaded: {loaded} · Updated cartons: {count}',
    {
      received: issue.received ?? m('Not supplied'),
      loaded: issue.loaded ?? m('Not supplied'),
      count: issue.afterCount,
    }
  )
}

/** Count physical identities rather than inferring additions from quantities. */
export function storeUpdateCartonChanges(review, row) {
  const ids =
    row &&
    new Set([...(row.before?.entryIds || []), ...(row.after?.entryIds || [])])
  return (review.cartonBatchChanges || []).flatMap(({ before, after }) => {
    if (
      ids &&
      ![...(before?.contents || []), ...(after?.contents || [])].some((item) =>
        ids.has(item.entryId)
      )
    )
      return []
    const indices = (batch) =>
        !batch || batch.deletedAt
          ? []
          : batch.entitlementIndices ||
            Array.from({ length: batch.count || 0 }, (_, index) => index),
      previous = indices(before),
      next = indices(after),
      previousSet = new Set(previous),
      nextSet = new Set(next),
      retired = previous.filter((index) => !nextSet.has(index)).length,
      added = next.filter((index) => !previousSet.has(index)).length
    return added || retired
      ? [{ before: previous.length, after: next.length, added, retired }]
      : []
  })
}

const fieldLabels = {
  group: 'Group',
  description: 'Description',
  title: 'Source product title',
  skuProperties: 'Source product attributes',
  productNumber: 'Article number',
  variants: 'Workbook declaration',
  allocations: 'Variant quantities',
  boxes: 'Cartons',
  perbox: 'Pcs/box',
  quantity: 'Quantity',
  price: 'Unit price',
  amount: 'Product amount',
  kg: 'kg/carton',
  cbm: 'm³/carton',
  sourceCbm: 'Supplier m³/carton',
  len: 'Length · cm',
  wid: 'Width · cm',
  ht: 'Height · cm',
  photos: 'Photos',
}
const statusLabels = {
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
  unchanged: 'Unchanged',
  unresolved: 'Match required',
}
const physicalLabels = {
  count: 'Cartons',
  len: 'Length · cm',
  wid: 'Width · cm',
  ht: 'Height · cm',
  weight: 'Weight · kg',
  suppliedCbm: 'Volume · m³',
  weightBasis: 'Weight basis',
  volumeBasis: 'Volume basis',
}
const samePhysicalValue = (a, b) => {
  const normalize = (value) =>
    value == null || value === ''
      ? ''
      : String(value)
          .replace(/(\.\d*?)0+$/, '$1')
          .replace(/\.$/, '')
  return normalize(a) === normalize(b)
}
export function storeUpdatePhysicalFields(review, row) {
  const ids = new Set(row.before?.entryIds || []),
    result = []
  if (!ids.size) return result
  for (const change of review.cartonBatchChanges || []) {
    const before = change.before,
      after = change.after
    if (!before || !before.contents?.some((item) => ids.has(item.entryId)))
      continue
    if (after.deletedAt) continue
    for (const [key, label] of Object.entries(physicalLabels))
      if (
        !samePhysicalValue(before[key], after[key]) ||
        (key === 'weightBasis' &&
          !samePhysicalValue(before.weight, after.weight)) ||
        (key === 'volumeBasis' &&
          !samePhysicalValue(before.suppliedCbm, after.suppliedCbm))
      )
        result.push({ field: label, before: before[key], after: after[key] })
    for (const key of ['unitContents', 'unitMeasurements']) {
      const previous = Object.keys(before[key] || {}).length,
        next = Object.keys(after[key] || {}).length
      if (previous !== next)
        result.push({
          field:
            key === 'unitContents'
              ? 'Individual-carton contents overrides'
              : 'Individual-carton measurement overrides',
          before: previous,
          after: next,
        })
    }
  }
  return result
}
const valueText = (value, field) => {
  if (value === null || value === undefined || value === '')
    return m('Not supplied')
  if (field === 'Weight basis' || field === 'Volume basis')
    return m(
      value === 'carton'
        ? 'Per carton'
        : value === 'batch'
          ? 'Whole batch'
          : 'Not supplied'
    )
  if (field === 'variants')
    return (
      value.map((v) => `${v.variant || ''}${v.size || ''}`).join(' / ') ||
      m('Not supplied')
    )
  if (field === 'allocations')
    return value
      .map(
        (v) => `${v.variant || ''}${v.size || ''}: ${v.quantity} · ¥${v.amount}`
      )
      .join(' / ')
  if (field === 'skuProperties')
    return (
      value
        .map(
          (property) =>
            `${property.label}: ${property.value}${property.raw && property.raw !== property.value ? ` (${property.raw})` : ''}`
        )
        .join(' · ') || m('Not supplied')
    )
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

/** Display filters never change the complete source replacement. */
export function storeUpdateRowsForFilter(rows, filter) {
  if (filter === 'prices')
    return rows.filter((row) =>
      ['increased', 'decreased'].includes(row.priceStatus)
    )
  if (filter === 'all') return rows
  if (filter === 'added' || filter === 'removed')
    return rows.filter((row) => row.status === filter)
  return rows.filter((row) => row.status !== 'unchanged')
}

/** One bounded comparison view; the draft and mappings belong to the parent dialog. */
export function mountStoreImportUpdateReview(
  host,
  {
    review: initial,
    repository,
    onMappingChange,
    onIdentityConfirmation,
    sourceRows = [],
  }
) {
  let review = initial,
    filter = 'changes',
    windowed,
    disposed = false
  const assets = new Map(),
    assetRequests = new Map(),
    heading = el('h3', m('Review spreadsheet changes')),
    guidance = el(
      'p',
      m(
        'The workbook replaces this purchase’s imported data and current unsealed carton facts. Existing codes and authored product details are preserved for matched products.'
      )
    ),
    totals = el('div', undefined, 'store-update-totals'),
    highlights = el('div', undefined, 'store-update-highlights'),
    issues = el('div', undefined, 'store-update-issues'),
    filters = el('div', undefined, 'store-update-filters'),
    list = el('div', undefined, 'store-update-list'),
    empty = el('p', m('No products in this view.'))
  heading.tabIndex = -1
  host.dataset.action = 'store-import-update-review'
  totals.dataset.action = 'store-update-totals'
  highlights.setAttribute('role', 'status')
  issues.setAttribute('role', 'status')
  issues.tabIndex = -1
  list.setAttribute('role', 'list')
  list.tabIndex = -1
  bindAttribute(list, 'aria-label', m('Spreadsheet changes by product group'))
  filters.setAttribute('role', 'group')
  bindAttribute(filters, 'aria-label', m('Filter spreadsheet changes'))
  const options = [
    ['changes', 'Changes'],
    ['prices', 'Price changes'],
    ['added', 'Added'],
    ['removed', 'Removed'],
    ['all', 'All products'],
  ]
  for (const [key, label] of options) {
    const button = el('button', m(label))
    button.type = 'button'
    button.dataset.updateFilter = key
    button.addEventListener('click', () => {
      filter = key
      paintRows()
    })
    filters.append(button)
  }
  host.append(
    heading,
    guidance,
    totals,
    highlights,
    issues,
    filters,
    empty,
    list
  )

  async function imageSource(url) {
    if (!url?.startsWith('local-image:')) return url
    if (assets.has(url)) return assets.get(url)
    if (!assetRequests.has(url))
      assetRequests.set(
        url,
        (async () => {
          try {
            const asset = await repository.getImage?.(url)
            if (asset?.dataUrl) assets.set(url, asset.dataUrl)
            return asset?.dataUrl
          } catch {
            return undefined
          }
        })()
      )
    return assetRequests.get(url)
  }
  function photo(url, label) {
    const figure = el('figure'),
      image = el('img'),
      caption = el('figcaption', m(label))
    image.alt = ''
    image.loading = 'lazy'
    figure.append(image, caption)
    void (async () => {
      const source = await imageSource(url)
      if (!disposed && source) image.src = source
    })()
    return figure
  }
  function render({ change, heading: isHeading, group }) {
    if (isHeading) return el('h4', m('Group {0}', { 0: group }))
    const before = change.before,
      after = change.after,
      row = after || before,
      card = el('article', undefined, 'store-update-product'),
      title = el('header', undefined, 'store-update-product-heading'),
      status = el(
        'span',
        m(statusLabels[change.status] || 'Changed'),
        `store-update-badge is-${change.status}`
      ),
      content = el('div', undefined, 'store-update-product-content')
    card.dataset.incomingRow = String(change.incomingRow ?? '')
    card.dataset.previousRow = String(change.previousRow ?? '')
    card.dataset.sourceGroup = String(row?.group || '')
    card.setAttribute('role', 'listitem')
    title.append(el('strong', m('Group {0}', { 0: row?.group || '—' })), status)
    content.append(title, el('p', row?.description || row?.productNumber || ''))
    const references = el(
      'small',
      m('Saved row {before} → Excel row {after}', {
        before: change.previousRow ?? '—',
        after: change.incomingRow ?? '—',
      })
    )
    content.append(references)
    const cells = Object.values(
      sourceRows.find((source) => source.row === change.incomingRow)?.cells ||
        {}
    )
      .flat()
      .filter(Boolean)
    if (cells.length)
      content.append(
        el('small', m('Source cells {0}', { 0: cells.join(', ') }))
      )
    const oldCodes = before?.codes?.join(' · ') || '—',
      newCodes = after?.codes?.join(' · ') || '—'
    if (oldCodes !== '—' || newCodes !== '—')
      content.append(
        el(
          'p',
          oldCodes === newCodes ? oldCodes : `${oldCodes} → ${newCodes}`,
          'store-update-codes'
        )
      )
    const photos = el('div', undefined, 'store-update-photos'),
      oldPhoto = before?.photos?.[0],
      newPhoto = after?.photos?.[0]
    if (oldPhoto && newPhoto && oldPhoto !== newPhoto)
      photos.append(
        photo(oldPhoto, 'Current photo'),
        photo(newPhoto, 'Updated photo')
      )
    else if (newPhoto || oldPhoto)
      photos.append(
        photo(newPhoto || oldPhoto, after ? 'Workbook photo' : 'Current photo')
      )
    const priceLabel =
      change.status === 'added'
        ? 'New price'
        : change.priceStatus === 'increased'
          ? '↑ Unit price increased'
          : change.priceStatus === 'decreased'
            ? '↓ Unit price decreased'
            : change.status === 'removed'
              ? 'Removed'
              : 'Unit price unchanged'
    const price = el(
      'p',
      undefined,
      `store-update-price is-${change.priceStatus || change.status}`
    )
    price.append(
      el('strong', m(priceLabel)),
      el(
        'span',
        ` ${before ? `¥${before.price}` : '—'} → ${after ? `¥${after.price}` : '—'}`
      )
    )
    if (['increased', 'decreased'].includes(change.priceStatus)) {
      price.append(
        el(
          'small',
          m('Difference: ¥{0}', {
            0: storeUpdatePriceDifference(before.price, after.price),
          })
        )
      )
    }
    content.append(price)
    for (const cartons of storeUpdateCartonChanges(review, change)) {
      const note = el('p', undefined, 'store-update-cartons')
      if (cartons.before !== cartons.after)
        note.append(
          el(
            'strong',
            m(
              cartons.after < cartons.before
                ? 'Cartons reduced: {before} → {after}'
                : 'Cartons increased: {before} → {after}',
              cartons
            )
          )
        )
      note.append(
        el(
          'small',
          m('{added} cartons added · {retired} cartons retired', cartons)
        )
      )
      content.append(note)
    }
    if (change.status === 'unresolved') {
      const label = el('label', m('Match this Excel row to')),
        select = el('select'),
        id = `store-update-mapping-${change.incomingRow}`
      select.id = id
      label.htmlFor = id
      select.name = `update-mapping-${change.incomingRow}`
      select.setAttribute('aria-invalid', 'true')
      const choices = [el('option', m('Choose an existing row or add as new'))]
      choices[0].value = ''
      for (const choice of change.choices || []) {
        const option = el(
          'option',
          `${m('Row {0}', { 0: choice.row })} · ${choice.description || choice.group}`
        )
        option.value = String(choice.row)
        choices.push(option)
      }
      const fresh = el('option', m('Add as new product row'))
      fresh.value = 'new'
      choices.push(fresh)
      select.append(...choices)
      select.addEventListener('change', () => {
        if (select.value)
          void onMappingChange(
            change.incomingRow,
            select.value === 'new' ? 'new' : Number(select.value)
          )
      })
      const note = el('small', m('Resolve this match before continuing.'))
      note.id = `${id}-error`
      select.setAttribute('aria-describedby', note.id)
      content.append(label, select, note)
    }
    const fields = change.fields || [],
      table = el('table', undefined, 'store-update-fields'),
      thead = el('thead'),
      head = el('tr'),
      tbody = el('tbody')
    for (const name of ['Field', 'Current', 'Updated']) {
      const cell = el('th', m(name))
      cell.scope = 'col'
      head.append(cell)
    }
    thead.append(head)
    const shown = fields.filter(
      (field) =>
        field.field !== 'photos' &&
        field.field !== 'price' &&
        (field.field !== 'sourceCbm' ||
          !samePhysicalValue(before?.sourceCbm, before?.cbm) ||
          !samePhysicalValue(after?.sourceCbm, after?.cbm))
    )
    if (shown.length) {
      for (const field of shown) {
        const tr = el('tr')
        tr.append(
          el('th', m(fieldLabels[field.field] || field.field)),
          el('td', valueText(field.before, field.field)),
          el('td', valueText(field.after, field.field))
        )
        tbody.append(tr)
      }
      table.append(thead, tbody)
      content.append(table)
    } else if (change.status === 'unchanged')
      content.append(el('p', m('Source values unchanged.')))
    const unchanged = [
      'variants',
      'quantity',
      'boxes',
      'perbox',
      'kg',
      'cbm',
      'len',
      'wid',
      'ht',
    ].filter((field) => !fields.some((value) => value.field === field))
    if (row && unchanged.length) {
      const details = el('details'),
        table = el('table', undefined, 'store-update-fields'),
        body = el('tbody')
      details.append(el('summary', m('Other source values')))
      for (const field of unchanged) {
        const tr = el('tr')
        tr.append(
          el('th', m(fieldLabels[field])),
          el('td', valueText(row[field], field))
        )
        body.append(tr)
      }
      table.append(body)
      details.append(table)
      content.append(details)
    }
    if (change.physicalFields?.length) {
      const physical = el('table', undefined, 'store-update-fields'),
        caption = el('caption', m('Current carton facts replaced by Excel')),
        body = el('tbody'),
        header = el('thead'),
        cells = el('tr')
      for (const text of ['Field', 'Current', 'Updated']) {
        const cell = el('th', m(text))
        cell.scope = 'col'
        cells.append(cell)
      }
      header.append(cells)
      for (const field of change.physicalFields) {
        const tr = el('tr')
        tr.append(
          el('th', m(field.field)),
          el('td', valueText(field.before, field.field)),
          el('td', valueText(field.after, field.field))
        )
        body.append(tr)
      }
      physical.append(caption, header, body)
      content.append(physical)
    }
    card.append(photos, content)
    return card
  }
  function paintRows() {
    windowed?.destroy()
    list.replaceChildren()
    for (const button of filters.querySelectorAll('button'))
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.updateFilter === filter)
      )
    const visible = (review.rowChanges || []).map((row) => {
      const physicalFields = storeUpdatePhysicalFields(review, row)
      return {
        ...row,
        physicalFields,
        status:
          physicalFields.length && row.status === 'unchanged'
            ? 'changed'
            : row.status,
      }
    })
    const changes = storeUpdateRowsForFilter(visible, filter)
    empty.hidden = Boolean(changes.length)
    list.dataset.rowCount = String(changes.length)
    list.scrollTop = 0
    const groups = new Map()
    for (const [index, change] of changes.entries()) {
      const group = String((change.after || change.before)?.group || '—')
      if (!groups.has(group)) groups.set(group, [])
      groups.get(group).push({
        key: `update-${change.incomingRow ?? 'removed'}-${change.previousRow ?? index}`,
        change,
      })
    }
    const sections = [...groups].map(([group, entries]) => {
      const section = el('section', undefined, 'store-update-group')
      list.append(section)
      return {
        element: section,
        entries: [
          { key: `heading-${group}`, group, heading: true },
          ...entries,
        ],
      }
    })
    windowed = createVirtualList({
      scroller: list,
      sections,
      render,
      limit: 16,
    })
    windowed.update()
  }
  function paint() {
    for (const image of review.sourceCandidate?.images ||
      review.candidate?.images ||
      [])
      assets.set(image.url, image.dataUrl)
    totals.replaceChildren()
    const summary = review.summary || {}
    for (const [key, label] of [
      ['products', 'Included rows'],
      ['groups', 'Product groups'],
      ['pieces', 'Quantity'],
      ['cartons', 'Cartons'],
      ['total', 'Total · CNY'],
    ]) {
      const item = el('div'),
        before = summary.before?.[key] ?? '—',
        after = summary.after?.[key] ?? '—'
      item.append(el('small', m(label)), el('strong', `${before} → ${after}`))
      totals.append(item)
    }
    highlights.replaceChildren(
      el(
        'strong',
        summary.priceChanges
          ? summary.priceChanges === 1
            ? m('1 unit price changed')
            : m('{0} unit prices changed', { 0: summary.priceChanges })
          : summary.unchangedPrices
            ? m('All {0} unit prices unchanged', {
                0: summary.unchangedPrices ?? 0,
              })
            : m('No matched unit prices to compare')
      ),
      el(
        'span',
        m('{added} added · {removed} removed · {changed} changed', {
          added: summary.added ?? 0,
          removed: summary.removed ?? 0,
          changed: summary.changed ?? 0,
        })
      ),
      el(
        'span',
        m('{0} rows gain weight/volume data', {
          0: summary.measurementsAdded ?? 0,
        })
      )
    )
    if (!summary.hasChanges)
      highlights.append(el('strong', m('No changes to apply')))
    for (const change of review.sourceMetadataChanges || [])
      highlights.append(
        el(
          'span',
          m('{field}: {before} → {after}', {
            field: m(
              change.field === 'filename' ? 'Workbook filename' : 'Sheet'
            ),
            before: change.before,
            after: change.after,
          })
        )
      )
    if (review.cartonBatchChanges?.length)
      highlights.append(
        el(
          'span',
          m('{0} carton batches updated', {
            0: review.cartonBatchChanges.length,
          })
        )
      )
    if (summary.before?.total === summary.after?.total)
      highlights.append(
        el(
          'span',
          m('Total unchanged: ¥{0}', {
            0: String(summary.after.total).replace(
              /\B(?=(\d{3})+(?!\d))/g,
              ','
            ),
          })
        )
      )
    if (review.identityChanges?.length) {
      const label = el(
          'label',
          undefined,
          'store-update-identity-confirmation'
        ),
        input = el('input')
      input.type = 'checkbox'
      input.name = 'identityChangesConfirmed'
      input.required = true
      input.checked = Boolean(review.identityChangesConfirmed)
      input.addEventListener('change', () =>
        onIdentityConfirmation?.(input.checked)
      )
      label.append(
        input,
        el(
          'span',
          m(
            'I reviewed the changed group/variant declarations and will review the resulting code corrections.'
          )
        )
      )
      highlights.append(label)
    }
    issues.replaceChildren()
    const problems = storeUpdateReviewIssues(review)
      .filter((issue) => ['error', 'warning'].includes(issue.severity))
      .sort(
        (a, b) =>
          Number(a.severity === 'warning') - Number(b.severity === 'warning')
      )
    issues.hidden = !problems.length
    for (const issue of problems) {
      const button = el('button', m(issue.message, issue.params))
      button.append(el('span', storeUpdateIssueContext(issue)))
      button.append(el('small', storeUpdateOperationalContext(issue)))
      button.classList.toggle('is-warning', issue.severity === 'warning')
      button.dataset.blocking = String(issue.severity === 'error')
      if (issue.code === 'STORE_UPDATE_PAYMENT_REVIEW') {
        button.append(
          el(
            'span',
            m(' · Linked purchase {0}', {
              0: issue.orderId || issue.sourceOrderId || '—',
            })
          )
        )
        for (const [key, label] of [
          ['amount', 'Product amount'],
          ['payable', 'Payable'],
          ['shipping', 'Shipping'],
        ]) {
          if (issue.reviewed?.[key] !== issue.current?.[key])
            button.append(
              el(
                'small',
                m('{field}: ¥{before} → ¥{after}', {
                  field: m(label),
                  before: issue.reviewed?.[key] ?? '—',
                  after: issue.current?.[key] ?? '—',
                })
              )
            )
        }
        button.append(
          el(
            'small',
            m(
              'This warning does not block the update. Review linked payments in Orders.'
            )
          )
        )
      }
      if (issue.containerNames?.length)
        button.append(el('span', ` · ${issue.containerNames.join(', ')}`))
      button.type = 'button'
      button.addEventListener('click', () => {
        if (issue.code === 'STORE_UPDATE_IDENTITY_REVIEW_REQUIRED') {
          host.querySelector('input[name="identityChangesConfirmed"]')?.focus()
          return
        }
        filter = 'all'
        paintRows()
        const index = (review.rowChanges || []).findIndex((row) =>
          (issue.incomingRow ?? issue.row) != null
            ? row.incomingRow === (issue.incomingRow ?? issue.row)
            : issue.previousRow != null && row.previousRow === issue.previousRow
        )
        const change = review.rowChanges?.[index]
        const node =
          change &&
          windowed.ensureVisible(
            `update-${change.incomingRow ?? 'removed'}-${change.previousRow ?? index}`
          )
        if (node) {
          node.tabIndex = -1
          ;(node.querySelector('select') || node).focus()
        } else heading.focus()
      })
      issues.append(button)
    }
    paintRows()
  }
  paint()
  return {
    get review() {
      return review
    },
    setReview(next) {
      review = next
      paint()
    },
    update() {
      windowed?.update()
    },
    showErrors() {
      issues.querySelector('[data-blocking="true"]')?.click()
    },
    destroy() {
      disposed = true
      windowed?.destroy()
      host.replaceChildren()
    },
  }
}
