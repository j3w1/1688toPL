import test from 'node:test'
import assert from 'node:assert/strict'
import {
  planStoreUpdatePhotos,
  importedProductPhotos,
} from '../src/store-order-update-photos.js'

const url = (number) => `local-image:${String(number).padStart(64, '0')}`
const thumbnail = (number) =>
  `data:image/png;base64,${Buffer.from(`synthetic-${number}`).toString('base64')}`
const tag = (code) => ({
  fit: 'contain',
  scale: 1.5,
  x: 0.1,
  y: -0.1,
  tags: [{ id: 'tag', code, x: 0.5, y: 0.5, labelX: 0.8, labelY: 0.8 }],
  tagScale: 2,
  pointerScale: 1,
  invertPointer: false,
})
const item = (entryId = '1', photos = [url(1)], edits) => ({
  entryId,
  sourceRow: Number(entryId) + 8,
  sourceGroup: entryId,
  title: `Synthetic product ${entryId}`,
  quantity: '10',
  price: '2.00',
  photos,
  thumbnail: thumbnail(photos[0]),
  ...(edits ? { photoEdits: edits } : {}),
})
const snapshot = (items) => ({
  accountId: 'local',
  orderId: '1001',
  observedAt: '2026-10-29T04:00:00.000Z',
  items,
})
const plan = (old, incoming = old, options = {}) =>
  planStoreUpdatePhotos({
    previous: snapshot(old),
    snapshot: snapshot(incoming),
    images: incoming.flatMap((value) =>
      value.photos.map((photo) => ({ url: photo, dataUrl: thumbnail(photo) }))
    ),
    ...options,
  })
const choose = (review, entryId, slotIndex, choice) => ({
  ...review.photoChoices,
  [entryId]: {
    ...review.photoChoices[entryId],
    [review.photoChanges.find((value) => value.entryId === entryId).slots[
      slotIndex
    ].key]: choice,
  },
})

test('52 products sharing an original retain independent authored tags and exact saved thumbnails by default', () => {
  const old = Array.from({ length: 52 }, (_, index) => ({
      ...item(String(index + 1), [url(1)], { 0: tag(`STYLE-${index}`) }),
      thumbnail: thumbnail(`edited-${index}`),
    })),
    incoming = old.map((value) => ({
      ...item(value.entryId),
      quantity: '12',
      price: '3.00',
    })),
    before = structuredClone(old),
    result = plan(old, incoming)
  assert.deepEqual(result.issues, [])
  assert.equal(result.photoSummary.editedKept, 52)
  assert.equal(result.photoSummary.workbookSelected, 0)
  assert.equal(result.photoSummary.changedProducts, 0)
  for (const [index, value] of result.items.entries()) {
    assert.deepEqual(value.photoEdits, old[index].photoEdits)
    assert.equal(value.thumbnail, old[index].thumbnail)
    assert.equal(value.quantity, '12')
    assert.equal(value.price, '3.00')
  }
  assert.deepEqual(old, before)
})

test('changed workbook originals replace untouched photos but preserve edited originals and separate source evidence', () => {
  const old = [item('1', [url(1)], { 0: tag('A') }), item('2')],
    incoming = [item('1', [url(2)]), item('2', [url(2)])],
    result = plan(old, incoming)
  assert.deepEqual(result.issues, [])
  assert.deepEqual(result.items[0].photos, [url(1)])
  assert.deepEqual(result.items[0].sourcePhotos, [url(2)])
  assert.deepEqual(importedProductPhotos(result.items[0]), [url(2)])
  assert.deepEqual(result.items[0].photoEdits, old[0].photoEdits)
  assert.deepEqual(result.items[1].photos, [url(2)])
  assert.equal(result.items[1].photoEdits, undefined)
  assert.equal(result.items[1].thumbnail, incoming[1].thumbnail)
  assert.equal(result.photoSummary.editedKept, 1)
  assert.equal(result.photoSummary.workbookSelected, 1)
})

test('explicit workbook replacement clears only the chosen photo edits and never reuses its edited thumbnail', () => {
  const old = [
      item('1', [url(1)], { 0: tag('A') }),
      item('2', [url(1)], { 0: tag('B') }),
    ],
    incoming = old.map((value) => item(value.entryId)),
    initial = plan(old, incoming),
    result = plan(old, incoming, {
      photoChoices: choose(initial, '1', 0, { action: 'workbook' }),
    })
  assert.deepEqual(result.issues, [])
  assert.equal(result.items[0].photoEdits, undefined)
  assert.equal(result.items[0].thumbnail, incoming[0].thumbnail)
  assert.deepEqual(result.items[1].photoEdits, old[1].photoEdits)
  assert.equal(result.photoSummary.editedKept, 1)
  assert.equal(result.photoSummary.changedProducts, 1)
})

test('deliberately cleared tags remain authored and unchanged photo choices become a no-op', () => {
  const old = [item('1', [url(1)], { 0: { tags: [] } })],
    initial = plan(old, [item()]),
    again = plan(initial.items, [item()], {
      photoChoices: initial.photoChoices,
    })
  assert.deepEqual(again.issues, [])
  assert.deepEqual(again.items[0].photoEdits, { 0: { tags: [] } })
  assert.equal(again.photoSummary.changedProducts, 0)
  assert.equal(again.photoSummary.editedKept, 1)
})

test('untouched identical originals preserve saved thumbnails across different preview encodings', () => {
  const old = [item()],
    incoming = [{ ...item(), thumbnail: thumbnail('reencoded-preview') }],
    result = plan(old, incoming)
  assert.deepEqual(result.issues, [])
  assert.equal(result.photoSummary.changedProducts, 0)
  assert.equal(result.items[0].thumbnail, old[0].thumbnail)
})

test('gallery reordering follows original identity, preserving each edit without transferring by position', () => {
  const old = [item('1', [url(1), url(2)], { 0: tag('A'), 1: tag('B') })],
    incoming = [item('1', [url(2), url(1)])],
    result = plan(old, incoming)
  assert.deepEqual(result.issues, [])
  assert.deepEqual(result.items[0].photos, [url(2), url(1)])
  assert.equal(result.items[0].photoEdits[0].tags[0].code, 'B')
  assert.equal(result.items[0].photoEdits[1].tags[0].code, 'A')
  assert.equal(result.items[0].thumbnail, url(2))
  assert.equal(result.items[0].sourcePhotos, undefined)
})

test('ambiguous changed galleries require explicit pairing, then retain or replace only the mapped image', () => {
  const old = [item('1', [url(1), url(2)], { 0: tag('A'), 1: tag('B') })],
    incoming = [item('1', [url(3), url(4)])],
    initial = plan(old, incoming)
  assert.equal(
    initial.issues.filter(
      (value) => value.code === 'STORE_UPDATE_PHOTO_PAIRING_REQUIRED'
    ).length,
    2
  )
  const first = initial.photoChanges[0].slots[0],
    second = initial.photoChanges[0].slots[1],
    result = plan(old, incoming, {
      photoChoices: {
        1: {
          [first.key]: {
            action: 'current',
            currentPhoto: first.currentOptions[1].key,
          },
          [second.key]: {
            action: 'workbook',
            currentPhoto: first.currentOptions[0].key,
          },
        },
      },
    })
  assert.deepEqual(result.issues, [])
  assert.deepEqual(result.items[0].photos, [url(2), url(4)])
  assert.equal(result.items[0].photoEdits[0].tags[0].code, 'B')
  assert.equal(result.items[0].photoEdits[1], undefined)
  assert.deepEqual(result.items[0].sourcePhotos, [url(3), url(4)])
})

test('historical recovery is explicit, account/order/entry scoped and retains all current non-photo fields', () => {
  const old = [item()],
    past = snapshot([item('1', [url(2)], { 0: tag('RECOVER') })])
  past.observedAt = '2026-10-28T04:00:00.000Z'
  const foreign = { ...past, accountId: 'foreign' },
    otherOrder = { ...past, orderId: '2002' },
    initial = plan(old, old, {
      history: [
        { snapshot: foreign },
        { snapshot: otherOrder },
        { snapshot: past },
      ],
    })
  assert.equal(initial.items[0].photoEdits, undefined)
  assert.equal(initial.photoSummary.previousSelected, 0)
  assert.equal(initial.photoChanges[0].slots[0].previousOptions.length, 1)
  const source = initial.photoChanges[0].slots[0].previous,
    result = plan(old, old, {
      history: [{ snapshot: past }],
      photoChoices: choose(initial, '1', 0, {
        action: 'previous',
        previousPhoto: source.key,
        previousObservedAt: source.observedAt,
      }),
    })
  assert.deepEqual(result.issues, [])
  assert.equal(result.photoSummary.previousSelected, 1)
  assert.deepEqual(result.items[0].photos, [url(2)])
  assert.deepEqual(result.items[0].sourcePhotos, [url(1)])
  assert.equal(result.items[0].photoEdits[0].tags[0].code, 'RECOVER')
  for (const field of [
    'entryId',
    'quantity',
    'price',
    'sourceRow',
    'sourceGroup',
    'title',
  ])
    assert.equal(result.items[0][field], old[0][field])
})

test('historical choices are regenerated from evidence and stale or unrelated references block', () => {
  const old = [item()],
    past = snapshot([item('1', [url(1)], { 0: tag('HISTORY') })]),
    initial = plan(old, old, { history: [past] }),
    slot = initial.photoChanges[0].slots[0]
  for (const choice of [
    { action: 'previous', previousPhoto: 'foreign-reference' },
    {
      action: 'previous',
      previousPhoto: slot.previous.key,
      previousObservedAt: '2025-01-01T00:00:00.000Z',
    },
    { action: 'current', currentPhoto: 'unknown-current' },
  ]) {
    const result = plan(old, old, {
      history: [past],
      photoChoices: choose(initial, '1', 0, choice),
    })
    assert.ok(
      result.issues.some(
        (value) => value.code === 'STORE_UPDATE_PHOTO_CHOICE_INVALID'
      )
    )
  }
})

test('same-asset duplicate gallery positions need explicit identities and retain separate tag choices', () => {
  const old = [item('1', [url(1), url(1)], { 0: tag('A'), 1: tag('B') })],
    incoming = [item('1', [url(2), url(3)])],
    initial = plan(old, incoming),
    slots = initial.photoChanges[0].slots
  const result = plan(old, incoming, {
    photoChoices: {
      1: {
        [slots[0].key]: {
          action: 'current',
          currentPhoto: slots[0].currentOptions[1].key,
        },
        [slots[1].key]: {
          action: 'current',
          currentPhoto: slots[0].currentOptions[0].key,
        },
      },
    },
  })
  assert.deepEqual(result.issues, [])
  assert.deepEqual(result.items[0].photos, [url(1), url(1)])
  assert.deepEqual(
    Object.values(result.items[0].photoEdits).map((edit) => edit.tags[0].code),
    ['B', 'A']
  )
})

test('different historical edits on one original require an explicit historical selection', () => {
  const old = [item()],
    history = snapshot([
      item('1', [url(1), url(1)], { 0: tag('A'), 1: tag('B') }),
    ]),
    initial = plan(old, old, { history: [history] }),
    slot = initial.photoChanges[0].slots[0]
  assert.equal(slot.previousOptions.length, 2)
  assert.equal(slot.previous, null)
  const unresolved = plan(old, old, {
    history: [history],
    photoChoices: choose(initial, '1', 0, { action: 'previous' }),
  })
  assert.ok(
    unresolved.issues.some(
      (value) => value.code === 'STORE_UPDATE_PHOTO_CHOICE_INVALID'
    )
  )
  const selected = slot.previousOptions[1],
    result = plan(old, old, {
      history: [history],
      photoChoices: choose(initial, '1', 0, {
        action: 'previous',
        previousPhoto: selected.key,
        previousObservedAt: selected.observedAt,
      }),
    })
  assert.deepEqual(result.issues, [])
  assert.equal(result.items[0].photoEdits[0].tags[0].code, 'B')
})

test('extra edited originals remain selectable when the workbook removes a gallery image', () => {
  const old = [item('1', [url(1), url(2)], { 1: tag('RETAIN') })],
    incoming = [item()],
    initial = plan(old, incoming)
  assert.deepEqual(initial.issues, [])
  assert.deepEqual(initial.items[0].photos, [url(1), url(2)])
  const result = plan(old, incoming, {
    photoChoices: choose(initial, '1', 1, { action: 'remove' }),
  })
  assert.deepEqual(result.issues, [])
  assert.deepEqual(result.items[0].photos, [url(1)])
  assert.equal(result.items[0].photoEdits, undefined)
})

test('malformed choices and unsupported actions cannot silently replace edited photos', () => {
  const old = [item('1', [url(1)], { 0: tag('SAFE') })],
    incoming = [item()],
    initial = plan(old, incoming)
  for (const photoChoices of [
    null,
    [],
    { 1: [] },
    { 1: { invalid: { action: 'workbook' } } },
    choose(initial, '1', 0, { action: 'invalid' }),
  ]) {
    const result = plan(old, incoming, { photoChoices })
    assert.ok(
      result.issues.some(
        (value) => value.code === 'STORE_UPDATE_PHOTO_CHOICE_INVALID'
      )
    )
  }
})
