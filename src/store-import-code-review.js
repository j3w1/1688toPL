import { element as el } from './ui.js'
import { message as m, bindText, bindAttribute } from './i18n.js'
import { setCodeText, decorateCodeInput } from './code-display.js'
import { createVirtualList } from './virtual-list.js'
import { openProductDetailsDialog } from './product-detail-editor.js'
import { productDetailsSummary } from './product-detail-edits.js'
import { spreadsheetDeclaration } from './spreadsheet-properties.js'
import { setGroupSizeMode } from './packing-model.js'
import { reviewPackingChanges } from './packing-review.js'
import {
  storeUpdateReviewIssues,
  storeUpdateIssueContext,
  storeUpdateOperationalContext,
} from './store-import-update-review.js'

/** Unsaved authoring lives outside the mounted card window. */
export function mountStoreImportCodeReview(
  host,
  { repository, review: initial, sourceRows, onValidity, reviewCandidate }
) {
  const summary = el('div', undefined, 'store-import-code-errors'),
    list = el('div', undefined, 'store-import-code-list'),
    heading = el('h3', m('Review products and codes')),
    explanation = el(
      'p',
      m(
        'Each group shares one product base code. Variant and size endings form the complete barcode. Review does not reserve codes.'
      )
    ),
    period = el(
      'p',
      m(
        'CE + purchase year/month + supplier number + product number + variant/size endings. New codes must use the confirmed purchase month.'
      )
    )
  summary.dataset.action = 'store-import-code-errors'
  summary.setAttribute('role', 'status')
  summary.setAttribute('aria-live', 'polite')
  list.tabIndex = -1
  list.dataset.rowCount = String(initial.preparation.groups.length)
  list.setAttribute('role', 'list')
  bindAttribute(list, 'aria-label', m('Proposed product codes'))
  const editOrder = el('button', m('Edit order details'))
  editOrder.type = 'button'
  editOrder.dataset.action = 'edit-order-details'
  host.append(heading, explanation, period, editOrder, summary, list)
  let review = initial,
    pending = false,
    resetting = false,
    request = 0,
    disposed = false
  const touched = new Set(),
    rows = new Map(sourceRows.map((row) => [row.row, row])),
    entries = review.preparation.groups.map((group) => ({ key: group.id })),
    sourceItems = new Map(
      review.candidate.snapshot.items.map((item) => [item.entryId, item])
    )
  const groupFor = (id) =>
    review.preparation.groups.find((group) => group.id === id)
  const variantFor = (group, id) =>
    group.variants.find((variant) => variant.id === id)
  const invalid = () =>
    (review.issues || []).some((issue) => issue.severity !== 'warning')
  const validity = () =>
    onValidity({ pending, resetting, valid: !pending && !invalid() })
  const fieldKey = (groupId, variantId, field) =>
    `${groupId}/${variantId || ''}/${field}`
  function detailSummary(scope) {
    const value = productDetailsSummary(review.preparation, { scope })
    return m(
      'Spanish: {name} · Chinese category: {category} · Material: {material}{custom}',
      {
        name: value.mixedSpanishName
          ? m('Mixed values')
          : value.spanishName || '—',
        category: value.mixedCategory
          ? m('Mixed values')
          : value.category || '—',
        material: value.mixedMaterial
          ? m('Mixed materials')
          : value.material || '—',
        custom: value.customCount
          ? m(' · Custom values: {0}', { 0: value.customCount })
          : '',
      }
    )
  }
  async function editDetails(scope, opener) {
    if (disposed || resetting || host.matches(':disabled')) return
    await openProductDetailsDialog({
      preparation: structuredClone(review.preparation),
      scope,
      opener,
      async onApply(candidate) {
        if (disposed || resetting)
          throw new Error('This import review is no longer available.')
        request++
        review.preparation = candidate
        paint()
        await validate()
      },
      onEditGroupCategory: (source) =>
        editDetails({ kind: 'group', groupId: scope.groupId }, source),
    })
  }
  editOrder.addEventListener('click', () => void editDetails({ kind: 'order' }))
  function targetOf(issue) {
    const detail = issue.detail || {},
      conflict = issue.conflict || detail.conflict || {}
    const owner = conflict.requestedOwner || issue.requestedOwner || {}
    return {
      groupId: issue.groupId || detail.groupId || owner.groupId,
      variantId: issue.variantId || detail.variantId || owner.variantId,
      field:
        issue.field ||
        (String(issue.code).includes('SIZE')
          ? 'sizeSuffix'
          : issue.batchId ||
              issue.containerNames?.length ||
              String(issue.code).startsWith('STORE_UPDATE_PHOTO_')
            ? undefined
            : 'baseCode'),
    }
  }
  function issueText(issue) {
    const fragment = el('span', m(issue.message, issue.params))
    fragment.append(el('span', storeUpdateIssueContext(issue)))
    fragment.append(el('small', storeUpdateOperationalContext(issue)))
    if (issue.containerNames?.length)
      fragment.append(el('span', ` · ${issue.containerNames.join(', ')}`))
    if (issue.values?.length)
      fragment.append(
        el(
          'span',
          m(' · Existing values: {0}', {
            0: issue.values
              .map((value) => (value === '' ? m('Blank value') : value))
              .join(' / '),
          })
        )
      )
    const conflict = issue.conflict || issue.detail?.conflict
    if (conflict) {
      const owners = conflict.owners || (conflict.owner ? [conflict.owner] : [])
      for (const owner of owners)
        fragment.append(
          el(
            'span',
            m(' · Owner: order {0}, product {1}', {
              0:
                owner.orderReference ||
                owner.orderId ||
                owner.order?.orderId ||
                '—',
              1:
                owner.sourceGroup ||
                owner.groupTitle ||
                owner.groupId ||
                owner.code ||
                conflict.code ||
                '—',
            })
          )
        )
      if (conflict.code) fragment.append(el('code', ` ${conflict.code}`))
      const owner = conflict.owner
      if (owner?.supplierName)
        fragment.append(el('span', ` · ${owner.supplierName}`))
      if (owner?.historyKind)
        fragment.append(el('span', m(' · Reserved by shipment history')))
    }
    return fragment
  }
  function paint() {
    for (const card of list.querySelectorAll('[data-source-group]')) {
      const group = groupFor(card.dataset.groupId)
      for (const label of card.querySelectorAll('[data-detail-summary]'))
        bindText(
          label,
          detailSummary(
            label.dataset.variantId
              ? {
                  kind: 'variant',
                  groupId: group.id,
                  variantId: label.dataset.variantId,
                }
              : { kind: 'group', groupId: group.id }
          )
        )
      for (const barcode of card.querySelectorAll('.store-import-barcode')) {
        const variant = variantFor(group, barcode.dataset.variantId)
        setCodeText(
          barcode,
          `${group.baseCode}${variant.variantSuffix}${variant.sizeSuffix}` ||
            '—'
        )
      }
      for (const input of card.querySelectorAll('input[data-code-field]')) {
        const key = fieldKey(
          group.id,
          input.dataset.variantId,
          input.dataset.codeField
        )
        const errors = (review.issues || []).filter((issue) => {
          const target = targetOf(issue)
          return (
            target.groupId === group.id &&
            (!target.variantId ||
              target.variantId === input.dataset.variantId) &&
            target.field === input.dataset.codeField
          )
        })
        const show =
          errors.length &&
          (touched.has(key) ||
            errors.some((issue) => String(issue.code).includes('SIZE')))
        input.setAttribute('aria-invalid', String(Boolean(show)))
        const note = card.querySelector(
          `[id="${input.getAttribute('aria-errormessage')}"]`
        )
        note.hidden = !show
        note.replaceChildren(...(show ? errors.map(issueText) : []))
      }
      for (const status of card.querySelectorAll('[data-ending-origin]')) {
        const variant = variantFor(group, status.dataset.variantId),
          originals = variant.entryIds.map((id) => sourceItems.get(id)),
          declared = originals.map(spreadsheetDeclaration),
          exact = declared.every(
            (value) =>
              value &&
              value.variantSuffix === variant.variantSuffix &&
              value.sizeSuffix === variant.sizeSuffix
          )
        bindText(
          status,
          m(
            declared.every(Boolean)
              ? exact
                ? 'Code endings follow the workbook declaration.'
                : 'Custom code endings differ from the workbook declaration.'
              : 'Code endings are suggested from source descriptions or edited manually.'
          )
        )
      }
    }
  }
  function showSummary() {
    summary.replaceChildren()
    if (pending) summary.append(el('p', m('Checking proposed codes…')))
    else if (!invalid())
      summary.append(
        el(
          'p',
          m('All proposed codes are valid. Nothing is saved until you import.')
        )
      )
    else {
      const visible = storeUpdateReviewIssues(review).filter((issue) => {
        if (issue.severity === 'warning') return false
        const target = targetOf(issue),
          active = document.activeElement
        const editing =
          active?.dataset.groupId === target.groupId &&
          active?.dataset.codeField === target.field &&
          (!target.variantId || active.dataset.variantId === target.variantId)
        return (
          !editing ||
          touched.has(
            fieldKey(target.groupId, target.variantId, target.field)
          ) ||
          issue.conflict ||
          String(issue.code).includes('SIZE')
        )
      })
      summary.append(
        el(
          'p',
          m(
            visible.length
              ? review.target
                ? 'Resolve these issues before updating the purchase.'
                : 'Resolve these code issues before importing.'
              : 'Finish editing the code field to check its format.'
          )
        )
      )
      const problems = el('ul')
      for (const issue of visible) {
        const item = el('li'),
          target = targetOf(issue),
          button = el('button')
        button.type = 'button'
        button.append(issueText(issue))
        button.addEventListener('click', () => {
          if (issue.incomingRow === null && issue.previousRow != null) {
            button.focus()
            return
          }
          const node = windowed.ensureVisible(target.groupId || entries[0]?.key)
          if (!target.field && node) {
            node.tabIndex = -1
            node.focus()
            return
          }
          if (
            target.groupId &&
            ['spanishName', 'category', 'material'].includes(target.field)
          ) {
            void editDetails(
              target.variantId
                ? {
                    kind: 'variant',
                    groupId: target.groupId,
                    variantId: target.variantId,
                  }
                : { kind: 'group', groupId: target.groupId },
              button
            )
            return
          }
          const fields = [
            ...(node?.querySelectorAll('input[data-code-field]') || []),
          ]
          const input =
            fields.find(
              (field) =>
                field.dataset.codeField === target.field &&
                (!target.variantId ||
                  field.dataset.variantId === target.variantId)
            ) || fields[0]
          if (input) {
            touched.add(
              fieldKey(
                input.dataset.groupId,
                input.dataset.variantId,
                input.dataset.codeField
              )
            )
            paint()
            input.focus()
            showSummary()
          }
        })
        item.append(button)
        problems.append(item)
      }
      summary.append(problems)
    }
    paint()
    validity()
  }
  async function validate({ resetCodes = false } = {}) {
    if (resetting) return false
    const current = ++request
    resetting = resetCodes
    pending = true
    showSummary()
    try {
      const requestInput = {
        candidate: review.candidate,
        preparation: structuredClone(review.preparation),
        ...(resetCodes ? { resetCodes: true } : {}),
      }
      const next = reviewCandidate
        ? await reviewCandidate({ ...review, ...requestInput })
        : await repository.reviewStoreOrderImport(requestInput)
      if (disposed || current !== request) return false
      review = next
      if (resetCodes) {
        touched.clear()
        windowed.destroy()
        list.replaceChildren()
        windowed = makeList()
        windowed.update()
      }
    } catch (error) {
      if (disposed || current !== request) return false
      review.issues = [
        {
          code: error.code || 'IMPORT_CODE_REVIEW_FAILED',
          message: error.message,
          severity: 'error',
          conflict: error.conflict,
        },
      ]
    }
    if (disposed || current !== request) return false
    pending = false
    resetting = false
    showSummary()
    return !invalid()
  }
  function inputField(card, group, variant, field, label, pattern) {
    const wrapper = el('label', undefined, 'store-import-code-field'),
      input = el('input'),
      note = el('small', undefined, 'store-import-code-error'),
      owner = variant || group
    input.type = 'text'
    input.value = owner[field] || ''
    input.name = `code-${field}-${owner.id}`
    input.pattern = pattern
    input.autocomplete = 'off'
    input.spellcheck = false
    input.dataset.codeField = field
    input.dataset.groupId = group.id
    if (variant) input.dataset.variantId = variant.id
    if (field === 'baseCode') input.required = true
    note.id = `import-code-error-${crypto.randomUUID()}`
    note.hidden = true
    input.setAttribute('aria-errormessage', note.id)
    input.setAttribute('aria-describedby', note.id)
    wrapper.append(el('span', m(label)), input, note)
    input.addEventListener('input', () => {
      const draftGroup = groupFor(group.id)
      const draftOwner = variant
        ? variantFor(draftGroup, variant.id)
        : draftGroup
      draftOwner[field] = input.value.toUpperCase()
      if (field === 'sizeSuffix' && draftOwner[field]) {
        draftOwner.needsSizeMapping = false
        delete draftGroup.sizeMode
      }
      paint()
      void validate()
    })
    input.addEventListener('blur', (event) => {
      touched.add(fieldKey(group.id, variant?.id, field))
      input.value = input.value.toUpperCase()
      if (summary.contains(event.relatedTarget)) paint()
      else showSummary()
    })
    card.append(wrapper)
    if (field === 'baseCode') decorateCodeInput(input)
  }
  function render({ key }) {
    const group = groupFor(key),
      items = group.variants.flatMap((variant) =>
        variant.entryIds.map((id) => sourceItems.get(id))
      ),
      card = el('article', undefined, 'store-import-code-group'),
      groupValue = items[0]?.sourceGroup || '—'
    card.dataset.sourceGroup = groupValue
    card.dataset.groupId = group.id
    card.setAttribute('role', 'listitem')
    card.append(el('h4', m('Group {0}', { 0: groupValue })))
    const groupScope = { kind: 'group', groupId: group.id },
      details = el('p', detailSummary(groupScope)),
      editGroup = el('button', m('Edit group details'))
    details.dataset.detailSummary = 'group'
    editGroup.type = 'button'
    editGroup.dataset.action = 'edit-group-details'
    editGroup.addEventListener('click', () => void editDetails(groupScope))
    card.append(details)
    inputField(card, group, null, 'baseCode', 'Product base code', 'CE[0-9]{8}')
    card.append(editGroup)
    for (const variant of group.variants) {
      const section = el('section', undefined, 'store-import-code-variant'),
        originals = variant.entryIds.map((id) => sourceItems.get(id)),
        photo = originals[0]?.thumbnail
      if (photo) {
        const image = el('img')
        image.src = photo
        image.alt = originals[0].description
        image.loading = 'lazy'
        section.append(image)
      }
      const evidence = el('div', undefined, 'store-import-code-source')
      evidence.append(
        el(
          'p',
          [variant.variant, variant.size].filter(Boolean).join(' · ') ||
            group.title
        )
      )
      for (const original of originals) {
        evidence.append(el('p', original.description))
        const declaration = rows.get(original.sourceRow),
          explicit = spreadsheetDeclaration(original)
        evidence.append(
          el(
            'small',
            explicit
              ? m('Workbook declaration {cell}: {value}', {
                  cell:
                    declaration?.cells?.var ||
                    m('Row {0}', { 0: original.sourceRow }),
                  value:
                    declaration?.variantDeclaration ||
                    `${explicit.variantSuffix}${explicit.sizeSuffix}`,
                })
              : m('No var declaration; description-based suggestions apply.')
          )
        )
        if (explicit && !explicit.sizeSuffix)
          evidence.append(el('small', m('Size ending: None declared')))
        evidence.append(
          el(
            'small',
            m('Row {row}: {quantity} pcs × ¥{price}', {
              row: original.sourceRow,
              quantity: original.quantity,
              price: original.price,
            })
          )
        )
        const cells = Object.values(rows.get(original.sourceRow)?.cells || {})
          .flat()
          .filter(Boolean)
        if (cells.length)
          evidence.append(
            el('small', m('Source cells {0}', { 0: cells.join(', ') }))
          )
      }
      section.append(evidence)
      if (review.target && review.rowChanges) {
        const previousCodes = [
          ...new Set(
            review.rowChanges
              .filter((row) =>
                row.entryIds?.some((id) => variant.entryIds.includes(id))
              )
              .flatMap((row) => row.before?.codes || [])
          ),
        ]
        if (previousCodes.length)
          section.append(
            el(
              'small',
              m('Current codes: {0}', { 0: previousCodes.join(' · ') })
            )
          )
      }
      const variantScope = {
          kind: 'variant',
          groupId: group.id,
          variantId: variant.id,
        },
        variantDetails = el('p', detailSummary(variantScope)),
        editVariant = el('button', m('Edit variant details'))
      variantDetails.dataset.detailSummary = 'variant'
      variantDetails.dataset.variantId = variant.id
      editVariant.type = 'button'
      editVariant.dataset.action = 'edit-variant-details'
      editVariant.addEventListener(
        'click',
        () => void editDetails(variantScope)
      )
      evidence.append(variantDetails, editVariant)
      const fields = el('div', undefined, 'store-import-code-endings')
      inputField(
        fields,
        group,
        variant,
        'variantSuffix',
        'Variant ending',
        '[A-Z]*'
      )
      inputField(
        fields,
        group,
        variant,
        'sizeSuffix',
        'Size ending',
        '[A-Z0-9]*'
      )
      const barcode = el('code', undefined, 'ce-code store-import-barcode')
      barcode.dataset.variantId = variant.id
      fields.append(el('span', m('Complete barcode')), barcode)
      const origin = el('small')
      origin.dataset.endingOrigin = 'true'
      origin.dataset.variantId = variant.id
      fields.append(origin)
      section.append(fields)
      card.append(section)
    }
    const suggestSizes = el(
      'button',
      m('Suggest size endings from descriptions')
    )
    suggestSizes.type = 'button'
    suggestSizes.dataset.action = 'suggest-import-size-endings'
    suggestSizes.addEventListener('click', async () => {
      try {
        const preferences = await repository.getPackingPreferences?.()
        if (disposed || resetting || host.matches(':disabled')) return
        const candidate = setGroupSizeMode(
            review.preparation,
            key,
            'automatic',
            {
              snapshot: review.candidate.snapshot,
              sizeVocabulary: preferences?.sizeVocabulary,
              inferDeclaredSizes: true,
            }
          ),
          before = groupFor(key),
          after = candidate.groups.find((value) => value.id === key),
          changes = before.variants
            .map((variant) => {
              const next = after.variants.find(
                (value) => value.id === variant.id
              )
              return {
                name: variant.variant || before.title,
                before: `${before.baseCode}${variant.variantSuffix}${variant.sizeSuffix}`,
                after: next.needsSizeMapping
                  ? m('Needs size review')
                  : `${after.baseCode}${next.variantSuffix}${next.sizeSuffix}`,
              }
            })
            .filter((value) => value.before !== value.after)
        if (!changes.length) return
        if (
          !(await reviewPackingChanges({
            title: m('Change size handling?'),
            explanation: m(
              'Review size endings suggested from the descriptions. Applying them is an explicit code edit; workbook declarations and physical measurements remain unchanged.'
            ),
            changes,
            proceed: m('Apply size handling'),
          })) ||
          disposed ||
          resetting
        )
          return
        request++
        review.preparation = candidate
        for (const input of card.querySelectorAll(
          '[data-code-field="sizeSuffix"]'
        ))
          input.value = variantFor(after, input.dataset.variantId).sizeSuffix
        paint()
        await validate()
      } catch (error) {
        if (disposed) return
        review.issues = [
          {
            code: 'IMPORT_SIZE_REVIEW_FAILED',
            severity: 'error',
            message: error.message,
            groupId: key,
            field: 'sizeSuffix',
          },
        ]
        showSummary()
      }
    })
    card.append(suggestSizes)
    const noSize = el('button', m('Do not add size endings'))
    noSize.type = 'button'
    noSize.dataset.action = 'no-size-difference'
    noSize.addEventListener('click', () => {
      const draft = groupFor(key)
      draft.sizeMode = 'none'
      for (const variant of draft.variants) {
        variant.sizeSuffix = ''
        variant.needsSizeMapping = false
      }
      for (const input of card.querySelectorAll(
        '[data-code-field="sizeSuffix"]'
      ))
        input.value = ''
      paint()
      void validate()
    })
    card.append(noSize)
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey)
        return
      const controls = [...card.querySelectorAll('input,button')],
        edge = event.shiftKey ? controls[0] : controls.at(-1)
      if (event.target !== edge) return
      const index =
        entries.findIndex((entry) => entry.key === key) +
        (event.shiftKey ? -1 : 1)
      if (!entries[index]) return
      event.preventDefault()
      const next = windowed.ensureVisible(entries[index].key)
      const fields = [...next.querySelectorAll('input,button')]
      ;(event.shiftKey ? fields.at(-1) : fields[0]).focus()
    })
    return card
  }
  function makeList() {
    return createVirtualList({
      scroller: list,
      sections: [{ element: list, entries }],
      render,
      paint,
      limit: 20,
    })
  }
  let windowed = makeList()
  windowed.update()
  showSummary()
  return {
    get review() {
      return review
    },
    get valid() {
      return !pending && !invalid()
    },
    validate,
    showErrors() {
      for (const issue of review.issues || []) {
        const target = targetOf(issue)
        touched.add(fieldKey(target.groupId, target.variantId, target.field))
      }
      showSummary()
      summary.querySelector('button')?.click()
    },
    update: () => windowed.update(),
    destroy() {
      disposed = true
      request++
      windowed.destroy()
      host.replaceChildren()
    },
  }
}
