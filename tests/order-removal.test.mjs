import test from 'node:test'
import assert from 'node:assert/strict'
import { planOrderRemoval } from '../src/order-removal.js'

test('removal review names direct sealed history and distinct shipment lineage dependencies together', () => {
  const state = {
    records: [{ snapshot: { accountId: 'local', orderId: '1001' } }],
    batches: [],
    containers: [
      {
        id: 'direct',
        accountId: 'local',
        name: 'October shipment',
        revisions: [{ orders: [{ orderId: '1001' }] }],
      },
      {
        id: 'lineage',
        accountId: 'local',
        name: 'November shared codes',
        revisions: [{ orders: [{ orderId: '1002' }] }],
      },
    ],
    locks: [
      {
        accountId: 'local',
        orderId: '1001',
        firstContainerId: 'direct',
        lineages: [],
      },
      {
        accountId: 'local',
        orderId: '1002',
        firstContainerId: 'lineage',
        lineages: [{ members: [{ accountId: 'local', orderId: '1001' }] }],
      },
    ],
  }
  const review = planOrderRemoval(state, ['1001'])
  assert.equal(review.canRemove, false)
  assert.deepEqual(
    review.blockers.map(({ kind, containerNames }) => ({
      kind,
      containerNames,
    })),
    [
      { kind: 'sealed', containerNames: ['October shipment'] },
      { kind: 'history', containerNames: ['November shared codes'] },
    ]
  )
  const otherAccount = planOrderRemoval(state, ['1001'], {
    accountId: 'other-account',
  })
  assert.equal(otherAccount.canRemove, true)
  assert.deepEqual(otherAccount.blockers, [])
})
