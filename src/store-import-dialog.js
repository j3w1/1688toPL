import { element as el } from './ui.js'
import { message as m, bindText, bindAttribute } from './i18n.js'
import { decorateIcon } from './icons.js'
import { mountStoreSpreadsheetGuide } from './store-spreadsheet-guide.js'
import { readStoreWorkbookAsync } from './store-workbook-client.js'
import { analyzeStoreSheet } from './store-workbook-model.js'
import { findMatchingStoreImports } from './store-import-matches.js'
import { createPhotoViewer } from './photo-viewer.js'
import { squareProductPhoto } from './product-photo.js'
import { popupLanguageToggle } from './popup-language-toggle.js'
import { photoCopyTile } from './photo-copy.js'
import { copySingleImage } from './clipboard.js'
import { mountStoreImportCodeReview } from './store-import-code-review.js'
import { mountStoreImportUpdateReview } from './store-import-update-review.js'

const positiveInteger = (value) =>
  /^\d+$/.test(String(value ?? '')) &&
  Number.isSafeInteger(Number(value)) &&
  Number(value) > 0

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  )
}

/** Review gate shared by the dialog and focused regression tests. No writes. */
export function validateStoreImportReview(analysis, review) {
  const issues = []
  if (!analysis?.rows?.length)
    issues.push({
      message: 'Choose a workbook with at least one included product row.',
    })
  if (!validDate(review.purchaseDate ?? ''))
    issues.push({ message: 'Confirm the purchase date before importing.' })
  if (!review.storeName?.trim())
    issues.push({ message: 'Enter the store or factory name.' })
  if (!review.photosReviewed)
    issues.push({
      message: 'Review the product photos and source totals before importing.',
    })
  for (const [index, issue] of (analysis?.issues ?? []).entries()) {
    if (issue.severity === 'error') issues.push(issue)
    else if (
      issue.code !== 'variant-allocation' &&
      !review.reviewedIssues?.has(String(index))
    )
      issues.push({
        ...issue,
        message: 'Confirm each highlighted review item before importing.',
      })
  }
  const rows = (analysis?.rows ?? []).map((row) => {
    if ((row.variants?.length ?? 0) <= 1) return row
    const values = review.allocations?.get(String(row.row)) ?? []
    if (
      values.length !== row.variants.length ||
      values.some((quantity) => !positiveInteger(quantity)) ||
      values.reduce((sum, quantity) => sum + Number(quantity), 0) !==
        Number(row.quantity)
    ) {
      issues.push({
        message:
          'Row {0}: enter a positive quantity for every variant; the sum must be {1}.',
        params: { 0: row.row, 1: row.quantity },
        row: row.row,
      })
      return row
    }
    return {
      ...row,
      variantAllocations: row.variants.map((variant, index) => ({
        ...variant,
        quantity: Number(values[index]),
      })),
    }
  })
  return { valid: issues.length === 0, issues, rows }
}

function field(label, input, help) {
  const root = el('div', undefined, 'store-import-field'),
    id = `store-import-field-${crypto.randomUUID()}`,
    caption = el('label', m(label))
  input.id = id
  caption.htmlFor = id
  root.append(caption, input)
  if (help) {
    const note = el('small', m(help))
    note.id = `${id}-help`
    input.setAttribute('aria-describedby', note.id)
    root.append(note)
  }
  return root
}

function textInput(name, type = 'text') {
  const input = el('input')
  input.name = name
  input.type = type
  return input
}

const issueMessage = (issue) =>
  m(issue.message, {
    ...issue.params,
    ...(issue.params?.reason ? { reason: m(issue.params.reason) } : {}),
  })

const issueTitles = {
  'photo-shared': 'Shared product photo',
  'photo-missing': 'Missing product photo',
  'photo-unresolved': 'Unreadable photo',
  'variant-allocation': 'Split variant quantities',
  'quantity-mismatch': 'Quantity mismatch',
  'amount-mismatch': 'Product amount mismatch',
  'total-mismatch': 'Order total mismatch',
  'incomplete-dimensions': 'Incomplete carton dimensions',
}
const issueInstructions = {
  'photo-shared': 'Confirm these rows share this photo.',
  'photo-missing': 'Paste a picture into this row’s pic cell in Excel.',
  'photo-unresolved': 'Replace this picture with an embedded image in Excel.',
  'variant-allocation':
    'Allocate the combined quantity in the product row below.',
  'quantity-mismatch': 'Correct qty, boxes or perbox in Excel.',
  'amount-mismatch': 'Correct price, qty or amount in Excel.',
  'total-mismatch': 'Correct the product rows or the seller’s total in Excel.',
}

function issueContext(issue, analysis, sheet) {
  const addresses = new Set(issue.cells ?? [])
  const rows = (analysis?.rows ?? []).filter(
    (row) =>
      row.row === issue.row ||
      Object.values(row.cells)
        .flat()
        .some((cell) => addresses.has(cell))
  )
  const photos = [...new Set(rows.flatMap((row) => row.photos))]
  // Keep anchored visual evidence available for issues without an assigned photo.
  const assigned = photos.length > 0
  for (const image of sheet?.images ?? []) {
    if (assigned || !image.dataUrl || !image.from) continue
    const to = image.to || image.from,
      last = to.row - (to.row > image.from.row && to.rowOffset === 0 ? 1 : 0),
      lastColumn =
        to.col - (to.col > image.from.col && to.colOffset === 0 ? 1 : 0)
    if (
      rows.some((row) => {
        const column = [...(row.cells.pic?.match(/^[A-Z]+/)?.[0] || '')].reduce(
          (value, letter) => value * 26 + letter.charCodeAt(0) - 64,
          0
        )
        return (
          row.row >= image.from.row &&
          row.row <= last &&
          column >= image.from.col &&
          column <= lastColumn
        )
      }) &&
      !photos.includes(image.dataUrl)
    )
      photos.push(image.dataUrl)
  }
  const values = new Map(
    (sheet?.rows ?? []).flatMap((row) =>
      row.cells.map((cell) => [cell.address, cell.error || cell.value])
    )
  )
  return { rows, photos, values }
}

function appendIssue(host, issue, { check, index, context, openPhoto } = {}) {
  const item = el(
      'li',
      undefined,
      `store-import-issue is-${issue.severity ?? 'error'}`
    ),
    detail = el('div', undefined, 'store-import-issue-detail'),
    heading = el('div', undefined, 'store-import-issue-heading'),
    title = el(
      'strong',
      m(
        issueTitles[issue.code] ||
          (issue.severity === 'review' ? 'Review' : 'Fix in workbook')
      )
    )
  item.dataset.issueCode = issue.code
  heading.append(title)
  let input, checkCaption
  if (check) {
    const label = el('label', undefined, 'store-import-review-check'),
      control = textInput(`review-${index}`, 'checkbox')
    input = control
    bindAttribute(
      control,
      'aria-label',
      m('Confirm review {0}', { 0: index + 1 })
    )
    control.addEventListener('change', () => check(control.checked))
    checkCaption = el('span', m('Review'))
    label.append(control, checkCaption)
    heading.append(label)
  } else {
    heading.append(
      el(
        'span',
        m(issue.severity === 'error' ? 'Blocked' : 'Manual'),
        'store-import-issue-state'
      )
    )
  }
  detail.append(heading)
  if (context?.rows.length) {
    const identity = el('div', undefined, 'store-import-issue-identity')
    for (const group of new Set(context.rows.map((row) => row.group)))
      identity.append(el('code', m('Group {0}', { 0: group })))
    identity.append(
      el(
        'span',
        m('Rows {0}', { 0: context.rows.map((row) => row.row).join(', ') })
      )
    )
    detail.append(identity)
  }
  const visual = el('div', undefined, 'store-import-issue-visual')
  if (context?.photos.length) {
    const photos = el('div', undefined, 'store-import-issue-photos')
    for (const [photoIndex, source] of context.photos.slice(0, 3).entries()) {
      const row = context.rows.find((row) => row.photos.includes(source)),
        tile = el(row ? 'button' : 'span'),
        image = el('img')
      image.src = source
      image.loading = 'lazy'
      bindAttribute(image, 'alt', m('Review photo {0}', { 0: photoIndex + 1 }))
      if (row) {
        tile.type = 'button'
        const index = row.photos.indexOf(source)
        bindAttribute(
          tile,
          'aria-label',
          m('View review photo for row {0}, photo {1}', {
            0: row.row,
            1: index + 1,
          })
        )
        tile.onclick = () => openPhoto?.(row, index)
      }
      tile.append(image)
      photos.append(photoCopyTile(tile, () => copySingleImage(source)))
    }
    visual.append(photos)
  }
  const explanation = el('div', undefined, 'store-import-issue-explanation')
  explanation.append(
    el(
      'p',
      issueInstructions[issue.code]
        ? m(issueInstructions[issue.code])
        : issueMessage(issue)
    )
  )
  if (context?.rows.length) {
    const description = [
      ...new Set(context.rows.map((row) => row.description).filter(Boolean)),
    ].join(' · ')
    if (description)
      explanation.append(
        el('span', description, 'store-import-issue-description')
      )
    const facts = el('div', undefined, 'store-import-issue-facts'),
      sum = (key) =>
        context.rows.every((row) => Number.isSafeInteger(row[key]))
          ? context.rows
              .reduce((total, row) => total + BigInt(row[key]), 0n)
              .toString()
          : '—'
    facts.append(
      fact('Quantity', sum('quantity')),
      fact('Cartons', sum('boxes'))
    )
    explanation.append(facts)
  }
  visual.append(explanation)
  detail.append(visual)
  const mismatch = {
    'quantity-mismatch': [
      'Source qty',
      issue.params?.quantity,
      issue.params?.expected,
    ],
    'amount-mismatch': [
      'Source amount',
      issue.params?.amount,
      issue.params?.expected,
    ],
    'total-mismatch': [
      'Seller total',
      issue.params?.total,
      issue.params?.computedTotal,
    ],
  }[issue.code]
  if (mismatch) {
    const comparison = el('div', undefined, 'store-import-issue-comparison'),
      currency = issue.code !== 'quantity-mismatch',
      value = (source) => `${currency ? '¥' : ''}${source ?? '—'}`
    comparison.append(
      fact(mismatch[0], value(mismatch[1])),
      el('span', '→'),
      fact('Calculated', value(mismatch[2]))
    )
    detail.append(comparison)
    const formula =
      issue.code === 'quantity-mismatch'
        ? `${issue.params.boxes} × ${issue.params.perbox} = ${issue.params.expected}`
        : issue.code === 'amount-mismatch'
          ? `¥${issue.params.price} × ${issue.params.quantity} = ¥${issue.params.expected}`
          : null
    if (formula)
      detail.append(el('code', formula, 'store-import-issue-formula'))
  }
  if (issue.cells?.length) {
    const cells = el('div', undefined, 'store-import-cells')
    for (const address of issue.cells) {
      const cell = el('span'),
        value = context?.values.get(address)
      cell.append(el('code', String(address)))
      if (value !== null && value !== undefined && String(value).trim())
        cell.append(el('span', String(value)))
      cells.append(cell)
    }
    detail.append(cells)
  }
  item.append(detail)
  host.append(item)
  return { input, item, checkCaption }
}

function fact(label, value) {
  const item = el('span', undefined, 'store-import-fact')
  item.append(el('small', m(label)), el('strong', String(value ?? '—')))
  return item
}

/** File parsing and review stay local; only a fully valid submission is saved. */
export function openStoreImportDialog({
  repository,
  onImported = () => {},
  getSizeClassifier,
  accountId = 'local',
}) {
  const dialog = el('dialog', undefined, 'store-import-dialog'),
    form = el('form', undefined, 'store-import-form'),
    header = el('header', undefined, 'store-import-header'),
    heading = el('div'),
    title = el('h2', m('Import store spreadsheet')),
    subtitle = el(
      'p',
      m('Review the workbook, then review and assign its product codes.')
    ),
    actions = el('div', undefined, 'store-import-actions'),
    submit = el('button', m('Review products and codes'), 'primary'),
    back = el('button', m('Back')),
    resetCodes = el('button', m('Reset to suggested')),
    cancelCodes = el('button', m('Cancel')),
    close = decorateIcon(el('button', m('Close import')), 'close', {
      iconOnly: true,
    }),
    layout = el('div', undefined, 'store-import-layout'),
    body = el('div', undefined, 'store-import-body'),
    workbookReview = el('div', undefined, 'store-import-workbook-review'),
    changeReview = el('fieldset', undefined, 'store-import-change-review'),
    codeReview = el('fieldset', undefined, 'store-import-code-review'),
    guide = el('aside', undefined, 'store-import-sidebar'),
    guideTitle = el('h3', m('Workbook guide')),
    setup = el('section', undefined, 'store-import-setup'),
    file = textInput('workbook', 'file'),
    sheet = el('select'),
    storeName = textInput('storeName'),
    purchaseDate = textInput('purchaseDate', 'date'),
    importMode = el('select'),
    updatePurchase = el('select'),
    updateSetup = el('section', undefined, 'store-import-update-setup'),
    identity = el('p', undefined, 'store-import-identity'),
    status = el(
      'p',
      m('Choose the marked .xlsx or .xls file to begin.'),
      'store-import-status'
    ),
    updateContext = el('p', undefined, 'store-import-update-context'),
    issues = el('ul', undefined, 'store-import-issues'),
    duplicateNotice = el('p', undefined, 'store-import-warning'),
    checksHeader = el('div', undefined, 'store-import-checks-header'),
    checksTitle = el('h3', m('Workbook checks')),
    checksStatus = el('span', undefined, 'store-import-checks-status'),
    allReviews = textInput('allReviews', 'checkbox'),
    allReviewsLabel = el('label', undefined, 'store-import-check-all'),
    summary = el('div', undefined, 'store-import-summary'),
    products = el('div', undefined, 'store-import-products'),
    reviewLabel = el('label', undefined, 'store-import-final-review'),
    photosReviewed = textInput('photosReviewed', 'checkbox')
  let workbook,
    analysis,
    generation = 0,
    busy = false,
    saveLocked = false,
    readingController,
    submitted = false,
    codeView,
    codeFingerprint,
    codeIntent,
    updateView,
    updateDraft,
    identityChangesConfirmed = false,
    purchases = [],
    reviewingChanges = false,
    reviewingCodes = false,
    codeValidity = { pending: false, valid: false }
  const allocations = new Map(),
    reviewedIssues = new Set(),
    reviewChecks = new Map()
  const updateReviews = () => {
    const checked = reviewedIssues.size,
      total = reviewChecks.size
    allReviews.checked = Boolean(total && checked === total)
    allReviews.indeterminate = checked > 0 && checked < total
    allReviews.disabled = busy || !total
    allReviewsLabel.hidden = !total
    for (const [index, { input, item, checkCaption }] of reviewChecks) {
      input.checked = reviewedIssues.has(index)
      input.disabled = busy
      item.classList.toggle('is-checked', input.checked)
      bindText(checkCaption, m(input.checked ? 'Checked' : 'Review'))
    }
    const blocking =
      analysis?.issues.filter((issue) => issue.severity === 'error').length ?? 0
    bindText(
      checksStatus,
      m('{checked}/{total} reviews checked · {blocking} blocking', {
        checked,
        total,
        blocking,
      })
    )
    checksStatus.classList.toggle('has-blockers', blocking > 0)
  }
  allReviews.addEventListener('change', () => {
    for (const index of reviewChecks.keys())
      if (allReviews.checked) reviewedIssues.add(index)
      else reviewedIssues.delete(index)
    updateReviews()
  })
  const photoViewer = createPhotoViewer(async (source) => source, {
    getSizeClassifier,
    onEdit: async (row, { photoIndex, thumbnail, edit }) => {
      row.photoEdits = { ...row.photoEdits, [photoIndex]: edit }
      if (photoIndex === 0) row.thumbnail = thumbnail
      const preview = products.querySelector(
        `[data-source-row="${row.row}"] .store-import-photos img[data-photo-index="${photoIndex}"]`
      )
      if (preview) preview.src = thumbnail
    },
  })
  title.id = `store-import-title-${crypto.randomUUID()}`
  dialog.setAttribute('aria-labelledby', title.id)
  status.id = `store-import-status-${crypto.randomUUID()}`
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  status.tabIndex = -1
  updatePurchase.setAttribute('aria-describedby', status.id)
  updatePurchase.setAttribute('aria-errormessage', status.id)
  duplicateNotice.hidden = true
  updateContext.hidden = true
  updateContext.dataset.action = 'store-import-update-context'
  duplicateNotice.dataset.action = 'duplicate-import-warning'
  duplicateNotice.setAttribute('role', 'status')
  form.noValidate = true
  submit.type = 'submit'
  submit.dataset.action = 'review-import-codes'
  codeReview.dataset.action = 'store-import-code-review'
  codeReview.hidden = true
  changeReview.hidden = true
  importMode.name = 'importMode'
  updatePurchase.name = 'updatePurchase'
  for (const [value, label] of [
    ['update', 'Update existing purchase'],
    ['new', 'Create new purchase'],
  ]) {
    const option = el('option', m(label))
    option.value = value
    importMode.append(option)
  }
  updateSetup.hidden = true
  updateSetup.append(
    field('Import action', importMode),
    field('Purchase to update', updatePurchase)
  )
  for (const button of [back, resetCodes, cancelCodes]) {
    button.type = 'button'
    button.hidden = true
  }
  back.dataset.action = 'back-import-workbook'
  resetCodes.dataset.action = 'reset-import-codes'
  close.type = 'button'
  close.addEventListener('click', () => dialog.close())
  file.accept = '.xlsx,.xls'
  sheet.name = 'sheet'
  sheet.disabled = true
  storeName.required = true
  purchaseDate.required = true
  for (const input of [storeName, purchaseDate]) {
    input.setAttribute('aria-errormessage', status.id)
    input.addEventListener('input', () => {
      if (input.hasAttribute('aria-invalid'))
        input.setAttribute(
          'aria-invalid',
          String(
            input === storeName
              ? !storeName.value.trim()
              : !validDate(purchaseDate.value)
          )
        )
    })
  }
  heading.append(title, subtitle)
  decorateIcon(submit, 'upload')
  actions.append(
    popupLanguageToggle(dialog),
    back,
    resetCodes,
    cancelCodes,
    submit,
    close
  )
  header.append(heading, actions)
  const dateField = field('Purchase date', purchaseDate)
  dateField.classList.add('store-import-date-field')
  setup.append(
    field('Workbook', file),
    field('Sheet', sheet),
    field('Store or factory name', storeName),
    dateField
  )
  const template = decorateIcon(
    el('a', m('Download template'), 'button store-import-template'),
    'download',
    { iconOnly: true }
  )
  template.href = 'assets/store-order-template.xlsx'
  template.download = 'store-order-template.xlsx'
  bindAttribute(
    template,
    'title',
    m(
      'Download an editable workbook with ready import markers, formatted product rows and formulas.'
    )
  )
  dateField.append(template)
  reviewLabel.append(
    photosReviewed,
    el('span', m('I checked the product photos, quantities and order total.'))
  )
  reviewLabel.hidden = true
  guideTitle.id = `store-import-guide-heading-${crypto.randomUUID()}`
  guide.setAttribute('aria-labelledby', guideTitle.id)
  guide.append(guideTitle)
  mountStoreSpreadsheetGuide(guide, { initialSection: 'markers' })
  allReviewsLabel.append(allReviews, el('span', m('Check all reviews')))
  bindAttribute(
    allReviews,
    'aria-description',
    m(
      'Confirms review warnings only. Workbook errors, variant quantities and the final photo check still need attention.'
    )
  )
  bindAttribute(
    allReviewsLabel,
    'title',
    m(
      'Confirms review warnings only. Workbook errors, variant quantities and the final photo check still need attention.'
    )
  )
  checksStatus.setAttribute('role', 'status')
  checksHeader.append(checksTitle, checksStatus, allReviewsLabel)
  checksHeader.hidden = true
  workbookReview.append(
    setup,
    updateSetup,
    identity,
    duplicateNotice,
    checksHeader,
    issues,
    summary,
    products,
    reviewLabel
  )
  body.append(status, updateContext, workbookReview, changeReview, codeReview)
  layout.append(body, guide)
  form.append(header, layout)
  dialog.append(form)

  const targetPurchase = () =>
    importMode.value === 'update'
      ? purchases.find(
          ({ snapshot }) =>
            `${snapshot.accountId}/${snapshot.orderId}` === updatePurchase.value
        )
      : undefined
  const updateMode = () => !updateSetup.hidden && importMode.value === 'update'
  const updateSubmit = () => {
    submit.disabled =
      busy ||
      submitted ||
      (reviewingChanges &&
        (!updateView?.review.summary?.hasChanges ||
          updateView.review.issues?.some((issue) =>
            [
              'STORE_UPDATE_MAPPING_REQUIRED',
              'STORE_UPDATE_IDENTITY_REVIEW_REQUIRED',
            ].includes(issue.code)
          ))) ||
      (reviewingCodes && (codeValidity.pending || !codeValidity.valid))
    resetCodes.disabled = busy || codeValidity.pending
    back.disabled = busy || codeValidity.resetting
    codeReview.disabled = busy || codeValidity.resetting
    changeReview.disabled = busy
    cancelCodes.disabled = saveLocked
  }
  const setCodeStage = (value) => {
    reviewingChanges = false
    reviewingCodes = value
    workbookReview.hidden = value
    changeReview.hidden = true
    codeReview.hidden = !value
    for (const button of [back, resetCodes, cancelCodes]) button.hidden = !value
    bindText(
      submit,
      m(
        value
          ? updateMode()
            ? 'Update purchase'
            : 'Import and assign codes'
          : updateMode()
            ? 'Review changes'
            : 'Review products and codes'
      )
    )
    if (value) {
      if (updateMode()) submit.dataset.action = 'update-store-purchase'
      else submit.dataset.action = 'import-and-assign-codes'
    } else if (updateMode()) submit.dataset.action = 'review-import-changes'
    else submit.dataset.action = 'review-import-codes'
    updateSubmit()
    body.scrollTop = 0
    if (value) {
      codeView?.update()
      codeReview.querySelector('input')?.focus()
    } else purchaseDate.focus()
  }
  const setChangeStage = () => {
    reviewingChanges = true
    reviewingCodes = false
    workbookReview.hidden = true
    codeReview.hidden = true
    changeReview.hidden = false
    back.hidden = cancelCodes.hidden = false
    resetCodes.hidden = true
    bindText(submit, m('Review products and codes'))
    submit.dataset.action = 'review-update-codes'
    bindText(
      status,
      m('Review all replacements before updating this purchase.')
    )
    body.scrollTop = 0
    updateView?.update()
    updateSubmit()
  }
  const discardCodes = () => {
    codeView?.destroy()
    codeView = undefined
    codeFingerprint = undefined
    codeIntent = undefined
    updateView?.destroy()
    updateView = undefined
    updateDraft = undefined
    identityChangesConfirmed = false
    codeValidity = { pending: false, valid: false }
    setCodeStage(false)
  }
  back.addEventListener('click', () => {
    if (reviewingCodes && updateMode()) {
      updateDraft = codeView.review
      updateView?.setReview(updateDraft)
      setChangeStage()
    } else setCodeStage(false)
  })
  cancelCodes.addEventListener('click', () => dialog.close())
  resetCodes.addEventListener('click', () => {
    void codeView?.validate({ resetCodes: true })
  })
  const setBusy = (value, { saving = false } = {}) => {
    busy = value
    saveLocked = value && saving
    updateSubmit()
    close.disabled = saveLocked
    file.disabled = value
    sheet.disabled = value || !workbook
    storeName.disabled = purchaseDate.disabled =
      value || Boolean(targetPurchase())
    photosReviewed.disabled = value
    importMode.disabled = value
    updatePurchase.disabled = value || !updateMode()
    for (const control of products.querySelectorAll('input,button'))
      control.disabled = value
    form.setAttribute('aria-busy', String(value))
    updateReviews()
  }
  const fail = (error) => {
    bindText(
      status,
      m(
        error.message ||
          'Could not read this workbook. Check the file and try again.'
      )
    )
    status.classList.add('is-error')
    status.focus()
  }
  const render = () => {
    discardCodes()
    issues.replaceChildren()
    summary.replaceChildren()
    products.replaceChildren()
    allocations.clear()
    reviewedIssues.clear()
    reviewChecks.clear()
    checksHeader.hidden = !analysis?.issues.length
    updateReviews()
    photosReviewed.checked = false
    reviewLabel.hidden = !analysis?.rows?.length
    if (!analysis) {
      identity.replaceChildren()
      storeName.value = ''
      return
    }
    storeName.value = analysis.store.name ?? ''
    bindText(
      identity,
      analysis.store.number
        ? m('Store number {0} · Each import creates a separate order.', {
            0: analysis.store.number,
          })
        : m('Factory · No store number · Each import creates a separate order.')
    )
    for (const [index, issue] of analysis.issues.entries()) {
      const controls = appendIssue(issues, issue, {
        index,
        context: issueContext(
          issue,
          analysis,
          workbook?.sheets.find((sheet) => sheet.name === analysis.sheetName)
        ),
        openPhoto: (row, index) => {
          void photoViewer.open(row, analysis.rows, index)
        },
        check:
          issue.severity === 'review' && issue.code !== 'variant-allocation'
            ? (checked) => {
                checked
                  ? reviewedIssues.add(String(index))
                  : reviewedIssues.delete(String(index))
                updateReviews()
              }
            : null,
      })
      if (controls.input) reviewChecks.set(String(index), controls)
    }
    updateReviews()
    const groupCount = new Set(analysis.rows.map((row) => row.group)).size
    summary.append(
      fact('Included rows', analysis.rows.length),
      fact('Skipped rows', analysis.skippedRows ?? 0),
      fact('Product groups', groupCount),
      fact('Calculated total · CNY', analysis.computedTotal),
      fact('Seller total · CNY', analysis.total)
    )
    for (const row of analysis.rows) {
      const card = el('article', undefined, 'store-import-product'),
        images = el('div', undefined, 'store-import-photos'),
        content = el('div', undefined, 'store-import-product-detail'),
        rowTitle = el('div', undefined, 'store-import-product-heading'),
        facts = el('div', undefined, 'store-import-facts')
      card.dataset.sourceRow = String(row.row)
      rowTitle.append(
        el('strong', m('Row {0}', { 0: row.row })),
        el('code', m('Group {0}', { 0: row.group }))
      )
      for (const [index, source] of (row.photos ?? []).entries()) {
        const image = el('img')
        image.src = typeof source === 'string' ? source : source.dataUrl
        image.loading = 'lazy'
        bindAttribute(
          image,
          'alt',
          m('Row {0}, photo {1}', { 0: row.row, 1: index + 1 })
        )
        image.dataset.photoIndex = String(index)
        const view = el('button', undefined, 'store-import-photo-button')
        view.type = 'button'
        bindAttribute(
          view,
          'aria-label',
          m('View or adjust row {0}, photo {1}', { 0: row.row, 1: index + 1 })
        )
        view.append(image)
        view.addEventListener('click', () => {
          void photoViewer.open(row, analysis.rows, index)
        })
        images.append(
          photoCopyTile(view, () =>
            copySingleImage(
              typeof source === 'string' ? source : source.dataUrl
            )
          )
        )
      }
      if (!images.childElementCount)
        images.append(el('span', m('Photo missing'), 'is-error'))
      facts.append(
        fact('Quantity', row.quantity),
        fact('Cartons', row.boxes),
        fact('Pcs/box', row.perbox),
        fact('Unit price', row.price),
        fact('Product amount', row.amount)
      )
      if (row.kg != null) facts.append(fact('kg/carton', row.kg))
      if (row.cbm != null) facts.append(fact('m³/carton', row.cbm))
      if (row.len != null && row.wid != null && row.ht != null)
        facts.append(fact('Carton · cm', `${row.len} × ${row.wid} × ${row.ht}`))
      content.append(
        rowTitle,
        el('p', row.description || row.title || row.productNumber || ''),
        facts
      )
      if ((row.variants?.length ?? 0) > 1) {
        const split = el('fieldset', undefined, 'store-import-allocation'),
          result = el('p', undefined, 'store-import-allocation-total'),
          controls = el('div', undefined, 'store-import-allocation-controls'),
          values = row.variants.map(() => '')
        allocations.set(String(row.row), values)
        result.id = `store-import-allocation-${crypto.randomUUID()}`
        split.append(
          el('legend', m('Split the combined quantity')),
          controls,
          result,
          el(
            'small',
            m(
              'These variants share the source row’s cartons. Their physical packing needs review; carton counts are never multiplied.'
            )
          )
        )
        const update = () => {
          const assigned = values.reduce(
            (sum, quantity) => sum + (Number(quantity) || 0),
            0
          )
          bindText(
            result,
            m('{0} of {1} units allocated', { 0: assigned, 1: row.quantity })
          )
          const valid =
            values.every(positiveInteger) && assigned === Number(row.quantity)
          result.classList.toggle('is-valid', valid)
          result.classList.toggle('is-error', !valid)
          for (const input of controls.querySelectorAll('input'))
            input.setAttribute(
              'aria-invalid',
              String(!valid && values.some(Boolean))
            )
        }
        for (const [index, variant] of row.variants.entries()) {
          const input = textInput(`row-${row.row}-variant-${index}`, 'number'),
            label = el('label'),
            name = [variant.variant, variant.size].filter(Boolean).join(' · ')
          input.min = '1'
          input.step = '1'
          input.inputMode = 'numeric'
          input.required = true
          input.setAttribute('aria-describedby', result.id)
          bindAttribute(
            input,
            'aria-label',
            m('Row {0}, variant {1} quantity', { 0: row.row, 1: name })
          )
          input.addEventListener('input', () => {
            values[index] = input.value
            update()
          })
          label.append(el('span', name), input)
          controls.append(label)
        }
        update()
        content.append(split)
      }
      card.append(images, content)
      products.append(card)
    }
    const errors = analysis.issues.filter(
      (issue) => issue.severity === 'error'
    ).length
    bindText(
      status,
      errors
        ? m(
            '{0} workbook issues block import. Fix the marked cells and choose the corrected file.',
            { 0: errors }
          )
        : m(
            'Check the photos and totals, confirm the date, and complete the highlighted reviews.'
          )
    )
    status.classList.toggle('is-error', errors > 0)
  }
  const applyTarget = () => {
    discardCodes()
    const target = targetPurchase()
    updateContext.hidden = !target
    if (target)
      bindText(
        updateContext,
        m('Updating {store} · {date} · Purchase {purchase}', {
          store: target.snapshot.store.name,
          date: target.snapshot.purchasedAt.slice(0, 10),
          purchase: target.snapshot.orderId,
        })
      )
    updatePurchase.removeAttribute('aria-invalid')
    status.classList.remove('is-error')
    bindText(
      status,
      m(
        'Check the photos and totals, confirm the date, and complete the highlighted reviews.'
      )
    )
    bindText(
      subtitle,
      m(
        updateMode()
          ? 'Review the workbook changes, preserved codes and new proposals before updating.'
          : 'Review the workbook, then review and assign its product codes.'
      )
    )
    if (target) {
      purchaseDate.value = target.snapshot.purchasedAt.slice(0, 10)
      storeName.value = target.snapshot.store.name
      bindText(
        identity,
        m(
          'Updating purchase {date} · {rows} rows · ¥{total}. Purchase identity and date stay unchanged.',
          {
            date: purchaseDate.value,
            rows: target.snapshot.items.length,
            total: target.snapshot.spreadsheet.total,
          }
        )
      )
    } else {
      purchaseDate.value = ''
      storeName.value = analysis?.store.name || ''
      bindText(
        identity,
        m(
          updateMode()
            ? 'Choose the purchase to update.'
            : 'A new purchase will be created.'
        )
      )
    }
    purchaseDate.disabled = storeName.disabled = busy || Boolean(target)
    updatePurchase.disabled = busy || !updateMode()
    setCodeStage(false)
  }
  importMode.addEventListener('change', applyTarget)
  updatePurchase.addEventListener('change', applyTarget)
  const analyze = async () => {
    const current = generation,
      result = await analyzeStoreSheet(workbook, sheet.value),
      records = await repository.listOrders({ accountId }),
      matches = await findMatchingStoreImports(result, records)
    if (current !== generation || !dialog.isConnected) return
    analysis = result
    purchases = records.filter(
      ({ snapshot }) =>
        snapshot.sourceType === 'spreadsheet' &&
        snapshot.accountId === accountId &&
        snapshot.store.key === analysis.store.key
    )
    updateSetup.hidden = !purchases.length || !repository.reviewStoreOrderUpdate
    const placeholder = el('option', m('Choose the purchase to update.'))
    placeholder.value = ''
    updatePurchase.replaceChildren(
      placeholder,
      ...purchases.map(({ snapshot }) => {
        const option = el(
          'option',
          m('{date} · {rows} rows · ¥{total} · {id}', {
            date: snapshot.purchasedAt.slice(0, 10),
            rows: snapshot.items.length,
            total: snapshot.spreadsheet.total,
            id: snapshot.orderId,
          })
        )
        option.value = `${snapshot.accountId}/${snapshot.orderId}`
        return option
      })
    )
    importMode.value =
      purchases.length && !updateSetup.hidden ? 'update' : 'new'
    updatePurchase.value =
      purchases.length === 1
        ? `${purchases[0].snapshot.accountId}/${purchases[0].snapshot.orderId}`
        : ''
    duplicateNotice.hidden = !matches.length
    if (matches.length)
      bindText(
        duplicateNotice,
        m(
          'This appears to match {0} imported order(s). Importing again creates a separate purchase; review the date before continuing.',
          { 0: matches.length }
        )
      )
    render()
    if (purchases.length && !updateSetup.hidden) applyTarget()
  }
  file.addEventListener('change', async () => {
    const selected = file.files?.[0]
    if (!selected) return
    const current = ++generation
    purchaseDate.value = ''
    purchaseDate.removeAttribute('aria-invalid')
    storeName.removeAttribute('aria-invalid')
    analysis = undefined
    workbook = undefined
    purchases = []
    updateSetup.hidden = true
    updateContext.hidden = true
    duplicateNotice.hidden = true
    render()
    setBusy(true)
    bindText(status, m('Reading workbook and product photos…'))
    status.classList.remove('is-error')
    try {
      readingController = new AbortController()
      const result = await readStoreWorkbookAsync(
        await selected.arrayBuffer(),
        { filename: selected.name, signal: readingController.signal }
      )
      if (current !== generation || !dialog.isConnected) return
      workbook = result
      sheet.replaceChildren(
        ...workbook.sheets.map((entry) => {
          const option = el('option', entry.name)
          option.value = entry.name
          return option
        })
      )
      await analyze()
    } catch (error) {
      if (current === generation)
        fail({
          message: [
            'The spreadsheet exceeds the 100 MB import limit.',
            'Choose an Excel .xlsx or .xls workbook.',
          ].includes(error.message)
            ? error.message
            : 'Could not read this workbook. Check the file and try again.',
        })
    } finally {
      if (current === generation) setBusy(false)
    }
  })
  sheet.addEventListener('change', async () => {
    purchaseDate.value = ''
    purchaseDate.removeAttribute('aria-invalid')
    setBusy(true)
    try {
      await analyze()
    } catch (error) {
      fail(error)
    } finally {
      setBusy(false)
    }
  })
  const codeSourceRows = (rows) =>
    rows.map((row) => ({
      ...row,
      variantDeclaration:
        workbook.sheets
          .find((value) => value.name === analysis.sheetName)
          ?.rows.find((value) => value.row === row.row)
          ?.cells.find((cell) => cell.address === row.cells.var)?.value ?? '',
    }))
  const mountCodes = (result, rows) => {
    codeView?.destroy()
    codeView = mountStoreImportCodeReview(codeReview, {
      repository,
      review: result,
      sourceRows: codeSourceRows(rows),
      ...(updateMode()
        ? {
            reviewCandidate: async (draft) => {
              const next = await repository.reviewStoreOrderUpdate({
                sourceCandidate: draft.sourceCandidate,
                candidate: draft.candidate,
                draftCandidate: draft.candidate,
                previousSuggestedPreparation: draft.suggestedPreparation,
                target: draft.target,
                mappings: draft.mappings,
                preparation: draft.preparation,
                expectedRevisions: draft.expectedRevisions,
                identityChangesConfirmed,
                resetCodes: draft.resetCodes,
              })
              updateDraft = next
              return next
            },
          }
        : {}),
      onValidity: (value) => {
        codeValidity = value
        updateSubmit()
      },
    })
  }
  const mountChanges = (result, rows) => {
    updateDraft = result
    updateView?.destroy()
    updateView = mountStoreImportUpdateReview(changeReview, {
      repository,
      review: result,
      sourceRows: rows,
      onIdentityConfirmation(confirmed) {
        identityChangesConfirmed = confirmed
        void refreshChanges({}, rows)
      },
      onMappingChange(row, previous) {
        return refreshChanges({ [row]: previous }, rows)
      },
    })
  }
  const refreshChanges = async (mappings, rows) => {
    if (busy) return
    const current = generation
    setBusy(true)
    try {
      const result = await repository.reviewStoreOrderUpdate({
        sourceCandidate: updateDraft.sourceCandidate,
        candidate: updateDraft.candidate,
        draftCandidate: codeView?.review.candidate || updateDraft.candidate,
        previousSuggestedPreparation:
          codeView?.review.suggestedPreparation ||
          updateDraft.suggestedPreparation,
        target: updateDraft.target,
        mappings: { ...updateDraft.mappings, ...mappings },
        preparation: codeView?.review.preparation || updateDraft.preparation,
        expectedRevisions: updateDraft.expectedRevisions,
        identityChangesConfirmed,
      })
      if (current !== generation || !dialog.isConnected) return
      updateDraft = result
      updateView.setReview(result)
      mountCodes(result, rows)
      setChangeStage()
    } catch (error) {
      fail(error)
    } finally {
      setBusy(false)
    }
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (busy || submitted) return
    if (reviewingChanges) {
      if (
        updateDraft?.issues?.some(
          (issue) =>
            issue.code === 'STORE_UPDATE_MAPPING_REQUIRED' ||
            issue.code === 'STORE_UPDATE_IDENTITY_REVIEW_REQUIRED'
        )
      ) {
        updateView.showErrors()
        return
      }
      setCodeStage(true)
      bindText(
        status,
        m('Review the preserved codes and new proposals before updating.')
      )
      void codeView.validate()
      return
    }
    if (reviewingCodes) {
      if (!codeView?.valid) {
        codeView?.showErrors()
        return
      }
      setBusy(true, { saving: true })
      status.classList.remove('is-error')
      bindText(
        status,
        m(
          updateMode()
            ? 'Saving the reviewed purchase update…'
            : 'Saving the reviewed order and codes…'
        )
      )
      try {
        if (!(await codeView.validate())) {
          bindText(status, m('Resolve these code issues before importing.'))
          status.classList.add('is-error')
          codeView.showErrors()
          return
        }
        const draft = codeView.review
        const record = updateMode()
          ? await repository.updateStoreOrder({
              sourceCandidate: draft.sourceCandidate,
              candidate: draft.candidate,
              draftCandidate: draft.candidate,
              previousSuggestedPreparation: draft.suggestedPreparation,
              target: draft.target,
              mappings: draft.mappings,
              preparation: draft.preparation,
              expectedRevisions: draft.expectedRevisions,
              identityChangesConfirmed,
              intentId: codeIntent,
            })
          : await repository.importStoreOrder({
              candidate: draft.candidate,
              preparation: draft.preparation,
              intentId: codeIntent,
            })
        submitted = true
        await onImported(record)
        dialog.close()
      } catch (error) {
        if (!submitted) await codeView.validate()
        fail(
          submitted
            ? {
                message: updateMode()
                  ? 'The purchase was updated. Close this window and reopen the workspace to refresh the table.'
                  : 'The order was imported. Close this window and reopen the workspace to refresh the table.',
              }
            : error
        )
      } finally {
        setBusy(false)
      }
      return
    }
    if (updateMode() && !targetPurchase()) {
      updatePurchase.setAttribute('aria-invalid', 'true')
      fail({ message: 'Choose the purchase to update.' })
      updatePurchase.focus()
      return
    }
    const review = validateStoreImportReview(analysis, {
      purchaseDate: purchaseDate.value,
      storeName: storeName.value,
      allocations,
      reviewedIssues,
      photosReviewed: photosReviewed.checked,
    })
    purchaseDate.setAttribute(
      'aria-invalid',
      String(!validDate(purchaseDate.value))
    )
    storeName.setAttribute('aria-invalid', String(!storeName.value.trim()))
    if (!review.valid) {
      bindText(status, issueMessage(review.issues[0]))
      status.classList.add('is-error')
      status.focus()
      return
    }
    const fingerprint = JSON.stringify({
      filename: analysis.filename,
      sheetName: analysis.sheetName,
      total: analysis.total,
      purchaseDate: purchaseDate.value,
      store: { ...analysis.store, name: storeName.value.trim() },
      rows: review.rows,
      ...(updateMode() ? { target: targetPurchase().snapshot.orderId } : {}),
    })
    if (codeView && codeFingerprint === fingerprint) {
      if (updateMode()) setChangeStage()
      else setCodeStage(true)
      status.classList.remove('is-error')
      bindText(
        status,
        m(
          updateMode()
            ? 'Review all replacements before updating this purchase.'
            : 'Review the proposed codes before importing.'
        )
      )
      void codeView.validate()
      return
    }
    const previousDraft = Boolean(codeView)
    codeView?.destroy()
    codeView = undefined
    const reviewGeneration = generation
    setBusy(true)
    status.classList.remove('is-error')
    bindText(status, m('Preparing proposed product codes…'))
    try {
      const importRows = [],
        thumbnails = new Map()
      for (const [index, row] of review.rows.entries()) {
        bindText(
          status,
          m('Preparing photo {0} of {1}…', {
            0: index + 1,
            1: review.rows.length,
          })
        )
        const original = row.photos[0]
        if (!row.thumbnail && !thumbnails.has(original))
          thumbnails.set(original, await squareProductPhoto(original))
        importRows.push({
          ...row,
          thumbnail: row.thumbnail || thumbnails.get(original),
        })
      }
      const input = {
        accountId,
        filename: analysis.filename,
        sheetName: analysis.sheetName,
        total: analysis.total,
        purchaseDate: purchaseDate.value,
        store: { ...analysis.store, name: storeName.value.trim() },
        rows: importRows,
      }
      const result = updateMode()
        ? await repository.reviewStoreOrderUpdate({
            ...input,
            target: {
              accountId: targetPurchase().snapshot.accountId,
              orderId: targetPurchase().snapshot.orderId,
            },
          })
        : await repository.reviewStoreOrderImport(input)
      if (generation !== reviewGeneration || !dialog.isConnected) return
      codeFingerprint = fingerprint
      codeIntent = crypto.randomUUID()
      mountCodes(result, review.rows)
      if (updateMode()) {
        mountChanges(result, review.rows)
        setChangeStage()
      } else setCodeStage(true)
      bindText(
        status,
        m(
          updateMode()
            ? 'Review all replacements before updating this purchase.'
            : previousDraft
              ? 'Workbook details changed. Review the regenerated codes.'
              : 'Review the proposed codes before importing.'
        )
      )
    } catch (error) {
      fail(
        submitted
          ? {
              message:
                'The order was imported. Close this window and reopen the workspace to refresh the table.',
            }
          : error
      )
    } finally {
      setBusy(false)
      if (reviewingCodes && !submitted)
        codeReview.querySelector('input')?.focus()
    }
  })
  dialog.addEventListener('cancel', (event) => {
    if (saveLocked) event.preventDefault()
  })
  dialog.addEventListener(
    'close',
    () => {
      generation++
      readingController?.abort()
      codeView?.destroy()
      updateView?.destroy()
      photoViewer.close()
      dialog.remove()
    },
    { once: true }
  )
  document.body.append(dialog)
  dialog.showModal()
  file.focus()
  return dialog
}
