import { message as uiMessage, bindText, bindAttribute } from './i18n.js'
import { element, pinDialogActions, orderReference } from './ui.js'

function blockerMessage(blocker) {
  const names = (blocker.containerNames || []).join(', ')
  switch (blocker.kind) {
    case 'sealed':
      return uiMessage(
        'This order can’t be deleted because its cartons are recorded in sealed containers: {names}. Nothing has been deleted.',
        { names }
      )
    case 'history':
      if (!names)
        return uiMessage(
          'Retained shipment history requires this source purchase and its originals. Nothing has been deleted.'
        )
      return uiMessage(
        'Retained shipment history requires this source purchase in containers: {names}. Nothing has been deleted.',
        { names }
      )
    case 'payment':
      return uiMessage(
        'Unlink this order’s payments before deleting it, or delete the complete linked set together. Nothing has been deleted.'
      )
    case 'foreign-carton':
      return uiMessage(
        'Carton batch {batch} also references unselected purchases: {orders}. Review its ownership before deleting this order.',
        {
          batch: blocker.batchId,
          orders: (blocker.foreignOrderIds || []).join(', '),
        }
      )
    default:
      return uiMessage(
        blocker.message || 'Deletion is blocked. Nothing has been deleted.'
      )
  }
}

/** Review reserves nothing. The supplied write must recheck the current state. */
export function openOrderRemovalDialog({ orders, review, remove }) {
  const dialog = element('dialog', undefined, 'order-removal-dialog')
  bindAttribute(dialog, 'aria-label', uiMessage('Delete selected orders'))
  const heading = element('h2', uiMessage('Delete selected orders'))
  const status = element(
    'p',
    uiMessage('Reviewing related cartons and containers…')
  )
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  status.tabIndex = -1
  const details = element('div')
  const cancel = element('button', uiMessage('Cancel'))
  const proceed = element('button', uiMessage('Delete'), 'danger')
  cancel.type = proceed.type = 'button'
  proceed.disabled = true
  const actions = element('div', undefined, 'dialog-actions')
  actions.append(cancel, proceed)
  const selected = element('ul', undefined, 'order-removal-orders')
  for (const record of orders) {
    const order = record.snapshot || record
    const entry = element('li')
    entry.append(
      orderReference(order.orderId, { snapshot: order, sourceLink: false }),
      document.createTextNode(` ${order.sellerName || ''}`)
    )
    selected.append(entry)
  }
  dialog.append(
    heading,
    element(
      'p',
      uiMessage(
        'The selected orders, their history, preparation and owned cartons will be removed. A saved backup can restore the orders.'
      )
    ),
    selected,
    status,
    details
  )
  pinDialogActions(dialog, actions)
  document.body.append(dialog)
  let current,
    writing = false,
    removed = false
  function showReview(value) {
    current = value
    details.replaceChildren()
    details.append(
      element(
        'p',
        uiMessage(
          '{orders} orders · {cartons} carton batches · {containers} unsealed container inclusions',
          {
            orders: value.orders.length,
            cartons: value.cartonBatchCount,
            containers: value.containers.reduce(
              (count, container) => count + container.orderIds.length,
              0
            ),
          }
        )
      )
    )
    if (value.containers.length) {
      details.append(
        element(
          'p',
          uiMessage(
            'The orders and their loading decisions will be removed from these unsealed containers. The containers and their other orders will remain.'
          )
        )
      )
      const containers = element('ul')
      for (const container of value.containers)
        containers.append(element('li', container.name))
      details.append(containers)
    }
    if (value.blockers.length) {
      const grouped = new Map()
      for (const blocker of value.blockers) {
        if (!grouped.has(blocker.orderId)) grouped.set(blocker.orderId, [])
        grouped.get(blocker.orderId).push(blocker)
      }
      const blockers = element('div', undefined, 'order-removal-blockers')
      for (const [orderId, entries] of grouped) {
        blockers.append(
          element('h3', uiMessage('Order {orderId}', { orderId }))
        )
        const list = element('ul')
        for (const entry of entries)
          list.append(element('li', blockerMessage(entry)))
        blockers.append(list)
      }
      details.append(blockers)
    }
    bindText(
      status,
      uiMessage(
        value.canRemove
          ? 'Review complete. Delete removes all selected orders together.'
          : 'Deletion is blocked. Nothing has been deleted.'
      )
    )
    proceed.disabled = !value.canRemove
  }
  async function reload() {
    proceed.disabled = true
    const value = await review()
    if (dialog.open) showReview(value)
  }
  cancel.addEventListener('click', () => dialog.close())
  dialog.addEventListener('cancel', (event) => {
    if (writing) event.preventDefault()
  })
  proceed.addEventListener('click', async () => {
    if (writing || !current?.canRemove) return
    writing = true
    cancel.disabled = proceed.disabled = true
    dialog.setAttribute('aria-busy', 'true')
    bindText(status, uiMessage('Deleting selected orders…'))
    try {
      await remove()
      removed = true
      dialog.close()
    } catch (error) {
      try {
        await reload()
        if (current.canRemove) bindText(status, uiMessage(error.message))
      } catch (reviewError) {
        current = null
        proceed.disabled = true
        bindText(status, uiMessage(reviewError.message))
      }
      status.focus()
    } finally {
      writing = false
      cancel.disabled = false
      dialog.removeAttribute('aria-busy')
    }
  })
  const done = new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        dialog.remove()
        resolve(removed)
      },
      { once: true }
    )
  })
  dialog.showModal()
  cancel.focus()
  void reload().catch((error) => {
    if (dialog.open) bindText(status, uiMessage(error.message))
  })
  return done
}
