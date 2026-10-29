import { element as el } from './ui.js'
import {
  message as m,
  bindText,
  bindAttribute,
  inheritLanguageScope,
} from './i18n.js'
import { squareProductPhoto } from './product-photo.js'

const customized = (photo) => photo?.edit !== undefined

export function storeUpdatePhotoChoices(
  review,
  entryId,
  slot,
  action,
  fields = {}
) {
  const choices = structuredClone(review.photoChoices || {})
  choices[entryId] ||= {}
  choices[entryId][slot.key] = {
    ...(choices[entryId][slot.key] || {}),
    action,
    ...(action === 'previous' && slot.previous
      ? {
          previousPhoto: slot.previous.key || slot.previous.url,
          previousObservedAt: slot.previous.observedAt,
        }
      : {}),
    ...fields,
  }
  return choices
}

export function storeUpdateBulkPhotoChoices(review, action) {
  let choices = structuredClone(review.photoChoices || {})
  for (const product of review.photoChanges || []) {
    for (const slot of product.slots || []) {
      let selected
      if (action === 'edited' && customized(slot.current)) selected = 'current'
      if (action === 'workbook')
        selected = slot.workbook ? 'workbook' : 'remove'
      if (action === 'previous' && slot.previous) selected = 'previous'
      if (!selected) continue
      choices = storeUpdatePhotoChoices(
        { ...review, photoChoices: choices },
        product.entryId,
        slot,
        selected,
        selected === 'workbook' && slot.pairingRequired
          ? { currentPhoto: 'new' }
          : slot.current
            ? { currentPhoto: slot.current.key || slot.current.url }
            : {}
      )
    }
  }
  return choices
}

/** Comparison renders never save or edit photos; choices belong to the parent draft. */
export function createStoreImportPhotoReview({ host, imageSource, onChange }) {
  let review,
    generation = 0,
    disposed = false,
    preview
  const rendered = new Map()
  const expanded = new Set(),
    pages = new Map()
  async function rendition(photo) {
    const key = JSON.stringify([photo.url, photo.edit ?? null])
    if (!rendered.has(key))
      rendered.set(
        key,
        (async () => {
          const source = await imageSource(photo.url)
          if (!source) throw new Error('Photo is unavailable')
          return photo.edit !== undefined
            ? squareProductPhoto(source, photo.edit)
            : source
        })()
      )
    try {
      return await rendered.get(key)
    } catch (error) {
      rendered.delete(key)
      throw error
    }
  }
  function figure(photo, label) {
    const result = el('figure'),
      caption = el('figcaption', m(label))
    if (!photo) {
      result.append(el('p', m('Not supplied')), caption)
      return result
    }
    const button = el('button'),
      image = el('img'),
      feedback = el('small')
    button.type = 'button'
    button.className = 'store-update-photo-enlarge'
    bindAttribute(button, 'aria-label', m('Enlarge {0}', { 0: m(label) }))
    image.alt = ''
    image.loading = 'lazy'
    button.append(image)
    result.append(button, caption, feedback)
    const current = generation
    const load = async () => {
      try {
        const data = await rendition(photo)
        if (disposed || generation !== current || !result.isConnected) return
        image.src = data
        feedback.replaceChildren()
      } catch {
        if (disposed || generation !== current || !result.isConnected) return
        const retry = el('button', m('Retry photo preview'))
        retry.type = 'button'
        retry.addEventListener('click', () => void load())
        feedback.replaceChildren(
          el('span', m('Could not load photo preview.')),
          retry
        )
      }
    }
    void load()
    button.addEventListener('click', async () => {
      if (preview) return
      const dialog = el('dialog', undefined, 'store-update-photo-preview'),
        title = el('h3', m(label)),
        large = el('img'),
        close = el('button', m('Done'))
      const id = `store-photo-preview-${crypto.randomUUID()}`
      title.id = id
      dialog.setAttribute('aria-labelledby', id)
      large.alt = ''
      close.type = 'button'
      close.addEventListener('click', () => dialog.close())
      dialog.append(title, large, close)
      inheritLanguageScope(dialog, host)
      document.body.append(dialog)
      preview = dialog
      dialog.addEventListener(
        'close',
        () => {
          preview = undefined
          dialog.remove()
          button.focus()
        },
        { once: true }
      )
      dialog.showModal()
      close.focus()
      try {
        const data = await rendition(photo)
        if (
          !disposed &&
          dialog.isConnected &&
          dialog.open &&
          generation === current
        )
          large.src = data
      } catch {
        dialog.insertBefore(el('p', m('Could not load photo preview.')), close)
      }
    })
    return result
  }
  function update(entryId, slot, action, fields) {
    void onChange(
      storeUpdatePhotoChoices(review, entryId, slot, action, fields)
    )
  }
  function productView(product) {
    const section = el('section', undefined, 'store-update-photo-product')
    section.dataset.photoEntry = product.entryId
    const group = review.preparation?.groups.find((group) =>
        group.variants.some((variant) =>
          variant.entryIds.includes(product.entryId)
        )
      ),
      variant = group?.variants.find((variant) =>
        variant.entryIds.includes(product.entryId)
      ),
      code = group?.baseCode
        ? `${group.baseCode}${variant?.variantSuffix || ''}${variant?.sizeSuffix || ''}`
        : '',
      identity =
        code ||
        product.productNumber ||
        m('Product {0}', { 0: product.entryId })
    section.append(el('h5', m('Photo choices for {0}', { 0: identity })))
    const attributes = el('p')
    for (const [field, label] of [
      ['productNumber', 'Article number'],
      ['sourceVariant', 'Variant'],
      ['sourceSize', 'Size'],
    ])
      if (product[field]) {
        if (attributes.childNodes.length) attributes.append(' · ')
        attributes.append(el('span', m(label)), `: ${product[field]}`)
      }
    if (attributes.childNodes.length) section.append(attributes)
    const container = el('div')
    let details
    if (product.slots.length > 1) {
      details = el('details')
      const summary = el(
        'summary',
        m('Review {0} product photos', { 0: product.slots.length })
      )
      details.open = expanded.has(product.entryId)
      details.append(summary, container)
      section.append(details)
      details.addEventListener('toggle', () => {
        if (details.open) {
          expanded.add(product.entryId)
          if (!container.childNodes.length) paintGallery()
        } else {
          expanded.delete(product.entryId)
          container.replaceChildren()
        }
      })
    } else section.append(container)
    function paintGallery() {
      container.replaceChildren()
      const start = Math.min(
        pages.get(product.entryId) || 0,
        Math.max(0, product.slots.length - 1)
      )
      for (const [index, slot] of product.slots.entries()) {
        if (index < start || index >= start + 6) continue
        const fieldset = el('fieldset', undefined, 'store-update-photo-slot'),
          legend = el('legend', m('Photo {0}', { 0: index + 1 })),
          comparisons = el('div', undefined, 'store-update-photo-comparisons'),
          controls = el('div', undefined, 'store-update-photo-choices')
        fieldset.dataset.photoSlot = slot.key
        fieldset.append(legend)
        comparisons.append(
          figure(
            slot.current,
            customized(slot.current) ? 'Current edited photo' : 'Current photo'
          ),
          figure(slot.workbook, 'Workbook photo'),
          figure(slot.selected, 'Result after update')
        )
        const previousPhoto =
          slot.action === 'previous' ? slot.selected : slot.previous
        if (previousPhoto) {
          const earlier = figure(previousPhoto, 'Previous edited photo')
          earlier.append(
            el('small', m('Saved {0}', { 0: previousPhoto.observedAt }))
          )
          comparisons.append(earlier)
        }
        fieldset.append(comparisons)
        if ((slot.previousOptions || []).length > 1) {
          const label = el('label', m('Previous edit to recover')),
            select = el('select'),
            id = `previous-photo-${crypto.randomUUID()}`,
            placeholder = el('option', m('Choose a previous edited photo'))
          select.id = id
          label.htmlFor = id
          select.name = `previous-photo-${product.entryId}-${index}`
          select.disabled = slot.pairingRequired
          placeholder.value = ''
          select.append(placeholder)
          for (const [position, reference] of slot.previousOptions.entries()) {
            const option = el(
              'option',
              m('Saved {date} · Photo {number}', {
                date: reference.observedAt,
                number: position + 1,
              })
            )
            option.value = reference.key || reference.url
            select.append(option)
          }
          select.value =
            slot.action === 'previous'
              ? slot.selected?.key || slot.selected?.url || ''
              : ''
          select.addEventListener('change', () => {
            const selected = slot.previousOptions.find(
              (reference) => (reference.key || reference.url) === select.value
            )
            if (selected)
              update(product.entryId, slot, 'previous', {
                previousPhoto: selected.key || selected.url,
                previousObservedAt: selected.observedAt,
              })
          })
          controls.append(label, select)
        }
        if (slot.pairingRequired) {
          const label = el(
              'label',
              m('Which current photo does this workbook image replace?')
            ),
            select = el('select'),
            id = `photo-pair-${crypto.randomUUID()}`,
            note = el(
              'small',
              m('Choose the matching photo, or add this as a new image.')
            )
          select.id = id
          select.name = `photo-pair-${product.entryId}-${index}`
          label.htmlFor = id
          note.id = `${id}-help`
          select.setAttribute('aria-describedby', note.id)
          const empty = el('option', m('Choose a photo match'))
          empty.value = ''
          select.append(empty)
          for (const [position, photo] of (
            slot.currentOptions || []
          ).entries()) {
            const option = el(
              'option',
              m('Current photo {0}', { 0: position + 1 })
            )
            option.value = photo.key || photo.url
            select.append(option)
          }
          const fresh = el('option', m('Add as a new image'))
          fresh.value = 'new'
          select.append(fresh)
          select.value =
            review.photoChoices?.[product.entryId]?.[slot.key]?.currentPhoto ||
            ''
          select.setAttribute('aria-invalid', String(!select.value))
          select.addEventListener('change', () => {
            if (!select.value) return
            const reference = slot.currentOptions.find(
              (photo) => (photo.key || photo.url) === select.value
            )
            const action =
              select.value === 'new'
                ? 'workbook'
                : slot.action ||
                  (customized(reference) ? 'current' : 'workbook')
            update(product.entryId, slot, action, {
              currentPhoto: select.value,
            })
          })
          controls.append(label, select, note)
        }
        const options = [
          ['current', 'Keep current photo', slot.current],
          ['workbook', 'Use workbook photo', slot.workbook],
          ['previous', 'Use previous edited photo', slot.previous],
          ['remove', 'Remove this photo', !slot.workbook],
        ]
        for (const [action, text, available] of options) {
          if (!available) continue
          const label = el('label'),
            radio = el('input'),
            id = `photo-choice-${crypto.randomUUID()}`
          radio.type = 'radio'
          radio.name = `photo-${product.entryId}-${slot.key}`
          radio.value = action
          radio.id = id
          radio.checked = slot.action === action
          radio.disabled =
            slot.pairingRequired &&
            !review.photoChoices?.[product.entryId]?.[slot.key]?.currentPhoto
          label.htmlFor = id
          label.append(radio, el('span', m(text)))
          radio.addEventListener('change', () =>
            update(product.entryId, slot, action)
          )
          controls.append(label)
        }
        if (customized(slot.current) && slot.workbook)
          controls.append(
            el(
              'small',
              m(
                'Using the workbook photo removes the current crop and tags only for this photo.'
              )
            )
          )
        fieldset.append(controls)
        container.append(fieldset)
      }
      if (product.slots.length > 6) {
        const navigation = el('div', undefined, 'store-update-photo-bulk'),
          previous = el('button', m('Previous photos')),
          next = el('button', m('Next photos'))
        previous.type = next.type = 'button'
        previous.disabled = start === 0
        next.disabled = start + 6 >= product.slots.length
        for (const [button, value] of [
          [previous, Math.max(0, start - 6)],
          [next, start + 6],
        ])
          button.addEventListener('click', () => {
            pages.set(product.entryId, value)
            paintGallery()
            container.querySelector('input,select,button')?.focus()
          })
        navigation.append(
          previous,
          el(
            'span',
            m('Photos {from}–{to} of {total}', {
              from: start + 1,
              to: Math.min(start + 6, product.slots.length),
              total: product.slots.length,
            })
          ),
          next
        )
        container.append(navigation)
      }
    }
    if (!details || details.open) paintGallery()
    return section
  }
  return {
    prepareIssue(issue) {
      if (!issue.code?.startsWith('STORE_UPDATE_PHOTO_')) return false
      const product = (review.photoChanges || []).find(
        (product) => product.entryId === (issue.entryId || issue.entryIds?.[0])
      )
      if (!product) return false
      const index = Math.max(
        0,
        product.slots.findIndex((slot) => slot.key === issue.photoKey)
      )
      expanded.add(product.entryId)
      pages.set(product.entryId, Math.floor(index / 6) * 6)
      return true
    },
    focusIssue(node, issue) {
      const product = [...node.querySelectorAll('[data-photo-entry]')].find(
        (product) =>
          product.dataset.photoEntry === (issue.entryId || issue.entryIds?.[0])
      )
      const slot = [
        ...(product?.querySelectorAll('[data-photo-slot]') || []),
      ].find(
        (slot) => !issue.photoKey || slot.dataset.photoSlot === issue.photoKey
      )
      const control =
        slot?.querySelector('[aria-invalid="true"]') ||
        slot?.querySelector('select') ||
        slot?.querySelector('input') ||
        slot?.querySelector('button')
      if (!control) return false
      control.focus()
      return true
    },
    setReview(next) {
      review = next
      generation++
    },
    rows(row) {
      const ids = new Set(row.after?.entryIds || row.before?.entryIds || [])
      return (review.photoChanges || []).filter((product) =>
        ids.has(product.entryId)
      )
    },
    render(row) {
      const products = this.rows(row)
      if (!products.length) return null
      const result = el('div', undefined, 'store-update-photo-review')
      for (const product of products) result.append(productView(product))
      return result
    },
    summary() {
      const result = el('div', undefined, 'store-update-photo-summary'),
        summary = review.photoSummary
      if (!summary) return result
      result.append(
        el(
          'strong',
          m(
            '{kept} edited photos kept · {workbook} workbook photos selected · {previous} previous edits selected',
            {
              kept: summary.editedKept,
              workbook: summary.workbookSelected,
              previous: summary.previousSelected,
            }
          )
        )
      )
      const actions = el('div', undefined, 'store-update-photo-bulk'),
        products = review.photoChanges || []
      for (const [action, text, count] of [
        [
          'edited',
          'Keep edited photos ({0})',
          products.reduce(
            (n, p) => n + p.slots.filter((s) => customized(s.current)).length,
            0
          ),
        ],
        [
          'workbook',
          'Use workbook photos ({0})',
          products.reduce(
            (n, p) => n + p.slots.filter((s) => s.workbook).length,
            0
          ),
        ],
        [
          'previous',
          'Use previous edited photos ({0})',
          products.reduce(
            (n, p) => n + p.slots.filter((s) => s.previous).length,
            0
          ),
        ],
      ]) {
        if (!count) continue
        const button = el('button', m(text, { 0: count }))
        button.type = 'button'
        button.dataset.photoBulk = action
        button.addEventListener(
          'click',
          () => void onChange(storeUpdateBulkPhotoChoices(review, action))
        )
        actions.append(button)
      }
      const reset = el('button', m('Reset photo choices'))
      reset.type = 'button'
      reset.addEventListener('click', () => void onChange({}))
      actions.append(reset)
      if (
        review.issues?.some((issue) =>
          [
            'STORE_UPDATE_PHOTO_RENDER_FAILED',
            'STORE_UPDATE_PHOTO_MISSING',
          ].includes(issue.code)
        )
      ) {
        const retry = el('button', m('Retry photo preparation'))
        retry.type = 'button'
        retry.addEventListener(
          'click',
          () => void onChange(structuredClone(review.photoChoices || {}))
        )
        actions.append(retry)
      }
      result.append(actions)
      return result
    },
    destroy() {
      disposed = true
      generation++
      preview?.close()
      rendered.clear()
    },
  }
}
