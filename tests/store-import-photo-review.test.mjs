import test from 'node:test'
import assert from 'node:assert/strict'
import {
  storeUpdatePhotoChoices,
  storeUpdateBulkPhotoChoices,
} from '../src/store-import-photo-review.js'
import { storeUpdateRowsForFilter } from '../src/store-import-update-review.js'

test('photo choices preserve unrelated products, occurrence keys and a specifically reviewed historical version', () => {
  const current = {
      key: 'photo:1:same-url',
      url: 'same-url',
      edit: { tags: [] },
    },
    previous = {
      key: 'history:recent:0:same-url',
      url: 'same-url',
      observedAt: 'recent',
    },
    slot = { key: 'workbook:0:new-url', current, previous },
    review = { photoChoices: { other: { untouched: { action: 'current' } } } },
    before = structuredClone(review)
  const choices = storeUpdatePhotoChoices(review, '1', slot, 'previous', {
    previousPhoto: 'history:older:0:same-url',
    previousObservedAt: 'older',
  })
  assert.deepEqual(choices.other, review.photoChoices.other)
  assert.deepEqual(choices['1'][slot.key], {
    action: 'previous',
    previousPhoto: 'history:older:0:same-url',
    previousObservedAt: 'older',
  })
  assert.deepEqual(review, before)
})

test('bulk keep respects intentional empty edits and does not alter untouched or other product choices', () => {
  const edited = {
      key: 'a',
      current: { key: 'photo:0:shared', edit: {} },
      workbook: { url: 'new' },
    },
    untouched = {
      key: 'b',
      current: { key: 'photo:1:shared' },
      workbook: { url: 'newer' },
    },
    review = {
      photoChoices: {
        1: { b: { action: 'workbook' } },
        2: { a: { action: 'previous' } },
      },
      photoChanges: [{ entryId: '1', slots: [edited, untouched] }],
    }
  const choices = storeUpdateBulkPhotoChoices(review, 'edited')
  assert.deepEqual(choices['1'].a, {
    action: 'current',
    currentPhoto: 'photo:0:shared',
  })
  assert.deepEqual(choices['1'].b, { action: 'workbook' })
  assert.deepEqual(choices['2'], review.photoChoices['2'])
})

test('explicit workbook bulk choice replaces retained extras and treats unmatched originals as additions', () => {
  const review = {
    photoChanges: [
      {
        entryId: '1',
        slots: [
          { key: 'new', workbook: { url: 'incoming' }, pairingRequired: true },
          { key: 'old', current: { key: 'photo:0:old', edit: {} } },
        ],
      },
    ],
  }
  assert.deepEqual(storeUpdateBulkPhotoChoices(review, 'workbook'), {
    1: {
      new: { action: 'workbook', currentPhoto: 'new' },
      old: { action: 'remove', currentPhoto: 'photo:0:old' },
    },
  })
})

test('bulk historical recovery selects only available reviewed history references', () => {
  const previous = {
      key: 'history:date:0:original',
      url: 'original',
      observedAt: 'date',
    },
    review = {
      photoChanges: [
        {
          entryId: '1',
          slots: [{ key: 'recover', previous }, { key: 'unavailable' }],
        },
      ],
    }
  assert.deepEqual(storeUpdateBulkPhotoChoices(review, 'previous'), {
    1: {
      recover: {
        action: 'previous',
        previousPhoto: previous.key,
        previousObservedAt: 'date',
      },
    },
  })
})

test('Photos filter includes preserved custom edits and recovery candidates without claiming an effective change', () => {
  const rows = [
    {
      entry: 'custom',
      photoChanges: [{ customized: true, changed: false, slots: [] }],
    },
    {
      entry: 'incoming',
      photoChanges: [{ sourceChanged: true, changed: true, slots: [] }],
    },
    {
      entry: 'recover',
      photoChanges: [{ changed: false, slots: [{ previous: { url: 'old' } }] }],
    },
    {
      entry: 'same',
      photoChanges: [
        { changed: false, slots: [{ workbook: { url: 'same' } }] },
      ],
    },
  ]
  assert.deepEqual(
    storeUpdateRowsForFilter(rows, 'photos').map((row) => row.entry),
    ['custom', 'incoming', 'recover']
  )
  assert.equal(rows[0].photoChanges[0].changed, false)
})
