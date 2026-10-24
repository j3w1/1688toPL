import { batchOrderIds, orderKey } from './inventory-model.js'

/** Shared, read-only plan. Account scope applies to every reference, not just sources. */
export function planOrderRemoval(
  state,
  orderIds,
  { accountId = 'local' } = {}
) {
  const selected = new Set(orderIds),
    owns = (value) =>
      (value?.accountId || 'local') === accountId &&
      selected.has(value?.orderId),
    batches = state.batches.filter(
      (batch) =>
        batch.accountId === accountId &&
        !batch.deletedAt &&
        batchOrderIds(batch).some((id) => selected.has(id))
    ),
    blockers = [],
    containers = []
  for (const batch of batches) {
    const foreignOrderIds = batchOrderIds(batch).filter(
      (id) => !selected.has(id)
    )
    if (foreignOrderIds.length)
      for (const orderId of batchOrderIds(batch).filter((id) =>
        selected.has(id)
      ))
        blockers.push({
          kind: 'foreign-carton',
          orderId,
          batchId: batch.id,
          foreignOrderIds,
          message: `Carton batch ${batch.id} also belongs to purchases ${foreignOrderIds.join(', ')}. Review its ownership before deleting this order.`,
        })
  }
  for (const orderId of selected) {
    const reference = { accountId, orderId },
      key = orderKey(reference),
      ownedBatchIds = new Set(
        batches
          .filter((batch) => batchOrderIds(batch).includes(orderId))
          .map((batch) => batch.id)
      ),
      sealed = state.containers.filter(
        (container) =>
          container.accountId === accountId &&
          container.revisions.some(
            (revision) =>
              (revision.orders || []).some(
                (order) => orderKey(order) === key
              ) ||
              [
                ...(revision.cartons || []),
                ...(revision.leftBehind?.cartons || []),
              ].some(
                (unit) =>
                  orderKey(unit) === key || ownedBatchIds.has(unit.batchId)
              )
          )
      ),
      locks = (state.locks || []).filter(
        (lock) =>
          lock.accountId === accountId &&
          (lock.orderId === orderId ||
            (lock.lineages || []).some((lineage) =>
              (lineage.members || []).some((member) => orderKey(member) === key)
            ))
      ),
      historyLocks = locks.filter(
        (lock) =>
          !sealed.some((container) => container.id === lock.firstContainerId)
      ),
      historyContainers = historyLocks.map((lock) =>
        state.containers.find(
          (container) => container.id === lock.firstContainerId
        )
      ),
      containerNames = [...new Set(sealed.map((container) => container.name))]
    if (sealed.length)
      blockers.push({
        kind: 'sealed',
        orderId,
        containerNames,
        containerIds: sealed.map((container) => container.id),
        message: `This order can’t be deleted because its cartons are recorded in sealed containers: ${containerNames.join(', ')}. Nothing has been deleted.`,
      })
    if (historyLocks.length) {
      const names = [
        ...new Set(
          historyContainers.filter(Boolean).map((container) => container.name)
        ),
      ]
      blockers.push({
        kind: 'history',
        orderId,
        containerNames: names,
        containerIds: [
          ...new Set(historyLocks.map((lock) => lock.firstContainerId)),
        ],
        message: `Retained shipment lineage${names.length ? ` in ${names.join(', ')}` : ''} requires this source purchase and its originals. Nothing has been deleted.`,
      })
    }
  }
  for (const container of state.containers) {
    if (container.accountId !== accountId || !container.draft) continue
    const orderIds = container.draft.orders
      .filter(owns)
      .map((order) => order.orderId)
    if (orderIds.length)
      containers.push({ id: container.id, name: container.name, orderIds })
  }
  for (const record of state.records) {
    const target = record.snapshot
    if ((target.accountId || 'local') !== accountId) continue
    for (const link of record.paymentLinks || [])
      if (selected.has(target.orderId) !== selected.has(link.sourceOrderId)) {
        const orderId = selected.has(target.orderId)
          ? target.orderId
          : link.sourceOrderId
        if (
          !blockers.some(
            (blocker) =>
              blocker.kind === 'payment' && blocker.orderId === orderId
          )
        )
          blockers.push({
            kind: 'payment',
            orderId,
            message:
              'Unlink this order’s payments before deleting it, or delete the complete linked set together. Nothing has been deleted.',
          })
      }
  }
  return {
    accountId,
    orderIds: [...selected],
    orders: state.records
      .filter((record) => owns(record.snapshot))
      .map((record) => ({
        accountId,
        orderId: record.snapshot.orderId,
        sellerName: record.snapshot.sellerName,
      })),
    cartonBatchCount: batches.length,
    containers,
    blockers,
    canRemove: blockers.length === 0,
  }
}
