import { element as el, pinDialogActions } from './ui.js'
import {
  message as m,
  bindAttribute,
  bindText,
  inheritLanguageScope,
} from './i18n.js'
import {
  applyProductDetails,
  productDetailsSummary,
} from './product-detail-edits.js'

/** Shared authoring draft. The caller owns the unsaved import or guarded Orders commit. */
export function openProductDetailsDialog({
  preparation,
  scope,
  onApply,
  onEditGroupCategory,
  opener,
}) {
  const summary = productDetailsSummary(preparation, { scope }),
    titles = {
      order: 'Edit order details',
      group: 'Edit group details',
      variant: 'Edit variant details',
    },
    applyTitles = {
      order: 'Apply to order',
      group: 'Apply to group',
      variant: 'Apply to variant',
    },
    dialog = el('dialog', undefined, 'product-detail-dialog'),
    form = el('form'),
    fields = el('fieldset', undefined, 'product-detail-fields'),
    status = el('p', undefined, 'product-detail-status'),
    cancel = el('button', m('Cancel')),
    apply = el('button', m(applyTitles[scope.kind]), 'primary'),
    actions = el('div', undefined, 'dialog-actions'),
    controls = new Map()
  inheritLanguageScope(dialog, opener)
  form.id = `product-details-${crypto.randomUUID()}`
  form.method = 'post'
  form.noValidate = true
  form.dataset.action = 'product-detail-form'
  bindAttribute(dialog, 'aria-label', m(titles[scope.kind]))
  dialog.append(el('h2', m(titles[scope.kind])))
  dialog.append(
    el(
      'p',
      m('{groups} groups · {variants} variants · {rows} source rows', {
        groups: summary.groupCount,
        variants: summary.variantCount,
        rows: summary.rowCount,
      })
    )
  )
  if (scope.kind === 'variant' && summary.rowCount > 1)
    dialog.append(
      el(
        'p',
        m(
          'These source rows share one barcode identity. A Spanish-name edit affects all of them.'
        )
      )
    )
  fields.append(el('legend', m('Choose details to apply')))
  for (const [key, label, mixed] of [
    ['spanishName', 'Spanish name', summary.mixedSpanishName],
    ['category', 'Chinese category', summary.mixedCategory],
    ['material', 'Material', summary.mixedMaterial],
  ]) {
    if (key === 'category' && scope.kind === 'variant') continue
    const group = el('div', undefined, 'product-detail-field'),
      selection = el('input'),
      selectionLabel = el('label', m('Apply {field}', { field: m(label) })),
      input = el(key === 'spanishName' ? 'textarea' : 'input'),
      inputLabel = el('label', m(label))
    selection.type = 'checkbox'
    selection.id = `${form.id}-select-${key}`
    selection.name = `apply-${key}`
    selection.dataset.detailSelect = key
    selectionLabel.htmlFor = selection.id
    selectionLabel.prepend(selection)
    input.id = `${form.id}-${key}`
    input.name = key
    input.dataset.detailField = key
    input.value = summary[key]
    input.disabled = true
    if (key === 'spanishName') input.rows = 2
    if (mixed) bindAttribute(input, 'placeholder', m('Mixed values'))
    inputLabel.htmlFor = input.id
    group.append(selectionLabel, inputLabel, input)
    fields.append(group)
    controls.set(key, { selection, input })
    selection.addEventListener('change', () => {
      input.disabled = !selection.checked
      if (selection.checked) input.focus()
      paint()
    })
    input.addEventListener('input', () => {
      status.removeAttribute('data-error')
      input.removeAttribute('aria-invalid')
      paint()
    })
  }
  if (scope.kind === 'variant') {
    const shared = el(
      'p',
      m('Chinese category is shared by the CE product group.')
    )
    shared.append(el('strong', ` ${summary.category || '—'}`))
    fields.append(shared)
    if (onEditGroupCategory) {
      const category = el('button', m('Edit group category'))
      category.type = 'button'
      category.dataset.action = 'edit-shared-group-category'
      category.addEventListener('click', () => {
        if (saving || nextScope) return
        nextScope = () => onEditGroupCategory(dialog)
        dialog.close()
      })
      fields.append(category)
    }
  }
  const policy = el('fieldset', undefined, 'product-detail-policy')
  policy.append(el('legend', m('Existing custom values')))
  const keep = el('input'),
    replace = el('input')
  for (const [input, value, label] of [
    [keep, 'keep', 'Keep custom values'],
    [replace, 'replace', 'Replace all values'],
  ]) {
    input.type = 'radio'
    input.name = 'custom-values'
    input.value = value
    input.checked = value === 'keep'
    const wrapper = el('label', m(label))
    wrapper.prepend(input)
    policy.append(wrapper)
    input.addEventListener('change', paint)
  }
  if (scope.kind !== 'variant') {
    fields.append(policy)
    fields.append(
      el(
        'p',
        m(
          'Keep custom values replaces suggestions and unset values while preserving manual edits and deliberate blanks.'
        )
      )
    )
  }
  fields.append(
    el(
      'p',
      m(
        'Only selected fields change. A selected empty value clears that field.'
      )
    )
  )
  status.id = `${form.id}-status`
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  status.tabIndex = -1
  form.append(fields, status)
  dialog.append(form)
  cancel.type = 'button'
  apply.type = 'submit'
  apply.setAttribute('form', form.id)
  apply.dataset.action = 'apply-product-details'
  cancel.dataset.action = 'cancel-product-details'
  actions.append(cancel, apply)
  pinDialogActions(dialog, actions)
  document.body.append(dialog)
  let saving = false,
    applied = false,
    nextScope
  function proposal() {
    return applyProductDetails(preparation, {
      scope,
      fields: Object.fromEntries(
        [...controls]
          .filter(([, control]) => control.selection.checked)
          .map(([key, control]) => [key, control.input.value])
      ),
      replaceCustom: scope.kind === 'variant' || replace.checked,
    })
  }
  function paint() {
    if (saving) return
    const changes = proposal()
    bindText(
      status,
      m('{changed} values will change; {skipped} custom values will be kept.', {
        changed: changes.changedCount,
        skipped: changes.skippedCount,
      })
    )
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (saving || event.isComposing) return
    if (![...controls.values()].some((control) => control.selection.checked)) {
      bindText(status, m('Choose at least one detail to apply.'))
      status.dataset.error = 'true'
      controls.values().next().value.selection.focus()
      return
    }
    let changes
    try {
      changes = proposal()
    } catch (error) {
      bindText(status, m(error.message))
      status.dataset.error = 'true'
      status.focus()
      return
    }
    if (!changes.changedCount) {
      bindText(
        status,
        m('No values would change. Choose another field or Replace all values.')
      )
      status.focus()
      return
    }
    saving = true
    fields.disabled = apply.disabled = cancel.disabled = true
    dialog.setAttribute('aria-busy', 'true')
    bindText(status, m('Applying product details…'))
    try {
      await onApply(changes.preparation, changes)
      applied = true
      dialog.close()
    } catch (error) {
      bindText(status, m(error.message))
      status.dataset.error = 'true'
      status.focus()
    } finally {
      saving = false
      fields.disabled = apply.disabled = cancel.disabled = false
      dialog.removeAttribute('aria-busy')
    }
  })
  cancel.addEventListener('click', () => dialog.close())
  dialog.addEventListener('cancel', (event) => {
    if (saving) event.preventDefault()
  })
  const done = new Promise((resolve, reject) =>
    dialog.addEventListener(
      'close',
      async () => {
        dialog.remove()
        try {
          resolve(nextScope ? Boolean(await nextScope()) : applied)
        } catch (error) {
          reject(error)
        }
      },
      { once: true }
    )
  )
  paint()
  dialog.showModal()
  cancel.focus()
  return done
}
