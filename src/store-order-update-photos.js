import { stableValue } from './inventory-model.js'

const clone = (value) => structuredClone(value)
const same = (a, b) => stableValue(a) === stableValue(b)

export const importedProductPhotos = (item) =>
  item.sourcePhotos || item.photos || []

function references(item, observedAt) {
  return (item?.photos || []).map((url, photoIndex) => ({
    key: `${observedAt ? `history:${observedAt}` : 'photo'}:${photoIndex}:${url}`,
    url,
    photoIndex,
    ...(Object.hasOwn(item.photoEdits || {}, String(photoIndex))
      ? { edit: clone(item.photoEdits[photoIndex]) }
      : {}),
    ...(photoIndex === 0 && item.thumbnail
      ? { thumbnail: item.thumbnail }
      : {}),
    ...(observedAt ? { observedAt } : {}),
  }))
}

function historicPhotos(history, snapshot, item) {
  const seen = new Set(),
    result = []
  for (const record of history
    .map((value) => value.snapshot || value)
    .filter(
      (value) =>
        value.accountId === snapshot.accountId &&
        value.orderId === snapshot.orderId
    )
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt))) {
    const previous = record.items.find(
      (value) => value.entryId === item.entryId
    )
    for (const photo of references(previous, record.observedAt)) {
      if (photo.edit === undefined) continue
      const signature = stableValue([photo.url, photo.edit])
      if (seen.has(signature)) continue
      seen.add(signature)
      result.push(photo)
    }
  }
  return result
}

const effectivePhotos = (item) => [
  item.photos,
  item.photoEdits || {},
  item.thumbnail,
]
const findReference = (options, key) => {
  const exact = options.find((value) => value.key === key)
  if (exact) return exact
  const urls = options.filter((value) => value.url === key)
  return urls.length === 1 ? urls[0] : undefined
}

/** Resolve image choices against authoritative current/history evidence, never client pixels. */
export function planStoreUpdatePhotos({
  previous,
  snapshot,
  images = [],
  history = [],
  photoChoices = {},
}) {
  const issues = [],
    changes = [],
    choices = {},
    summary = {
      editedKept: 0,
      workbookSelected: 0,
      previousSelected: 0,
      changedProducts: 0,
      pending: 0,
    },
    originals = new Map(images.map((image) => [image.url, image.dataUrl])),
    oldItems = new Map(previous.items.map((item) => [item.entryId, item]))
  if (
    !photoChoices ||
    typeof photoChoices !== 'object' ||
    Array.isArray(photoChoices)
  ) {
    issues.push({
      code: 'STORE_UPDATE_PHOTO_CHOICE_INVALID',
      message: 'Review this product’s photo choices again.',
      severity: 'error',
    })
    photoChoices = {}
  }
  const items = snapshot.items.map((incoming) => {
    const old = oldItems.get(incoming.entryId),
      current = references(old),
      workbook = references(incoming),
      savedChoices = photoChoices[incoming.entryId] || {},
      past = old ? historicPhotos(history, previous, old) : [],
      assigned = new Map(),
      used = new Set(),
      explicitNew = new Set(),
      slots = [],
      selected = [],
      normalized = {},
      issue = (code, message, photoKey) => {
        issues.push({
          code,
          message,
          severity: 'error',
          entryId: incoming.entryId,
          incomingRow: incoming.sourceRow,
          row: incoming.sourceRow,
          photoKey,
        })
      }
    const inputChoicesValid =
      savedChoices &&
      typeof savedChoices === 'object' &&
      !Array.isArray(savedChoices)
    if (!inputChoicesValid)
      issue(
        'STORE_UPDATE_PHOTO_CHOICE_INVALID',
        'Review this product’s photo choices again.'
      )
    const input = inputChoicesValid ? savedChoices : {}
    const workbookKey = (photo) => `workbook:${photo.photoIndex}:${photo.url}`
    const allowedKeys = new Set([
      ...workbook.map(workbookKey),
      ...current.map((photo) => `current:${photo.photoIndex}:${photo.url}`),
    ])
    for (const [key, choice] of Object.entries(input))
      if (
        !allowedKeys.has(key) ||
        !choice ||
        typeof choice !== 'object' ||
        Array.isArray(choice)
      )
        issue(
          'STORE_UPDATE_PHOTO_CHOICE_INVALID',
          'Review this product’s photo choices again.',
          key
        )
    // Apply explicit pairings before deriving any unique remaining match.
    for (const photo of workbook) {
      const key = workbookKey(photo),
        choice = input[key]
      if (choice?.currentPhoto === 'new') {
        explicitNew.add(key)
        continue
      }
      if (!choice?.currentPhoto) continue
      const source = findReference(current, choice.currentPhoto)
      if (!source || used.has(source.key)) {
        issue(
          'STORE_UPDATE_PHOTO_CHOICE_INVALID',
          'Choose each current photo only once, or add the workbook photo as new.',
          key
        )
        continue
      }
      assigned.set(key, source)
      used.add(source.key)
    }
    for (const photo of workbook) {
      const key = workbookKey(photo)
      if (assigned.has(key) || explicitNew.has(key)) continue
      const matches = current.filter(
        (value) => !used.has(value.key) && value.url === photo.url
      )
      if (
        matches.length === 1 &&
        workbook.filter((value) => value.url === photo.url).length === 1
      ) {
        assigned.set(key, matches[0])
        used.add(matches[0].key)
      }
    }
    const remainingWorkbook = workbook.filter(
        (photo) =>
          !assigned.has(workbookKey(photo)) &&
          !explicitNew.has(workbookKey(photo))
      ),
      remainingCurrent = current.filter((photo) => !used.has(photo.key))
    if (remainingWorkbook.length === 1 && remainingCurrent.length === 1) {
      assigned.set(workbookKey(remainingWorkbook[0]), remainingCurrent[0])
      used.add(remainingCurrent[0].key)
    }
    const unpaired = current.filter((photo) => !used.has(photo.key))
    const resolve = (
      key,
      currentPhoto,
      workbookPhoto,
      pairingRequired,
      currentOptions
    ) => {
      if (
        workbookPhoto &&
        currentPhoto?.url === workbookPhoto.url &&
        currentPhoto.edit === undefined &&
        workbookPhoto.edit === undefined &&
        currentPhoto.thumbnail
      )
        workbookPhoto = { ...workbookPhoto, thumbnail: currentPhoto.thumbnail }
      const raw = input[key] || {},
        options = past.filter(
          (photo) =>
            !currentPhoto ||
            !same(
              [photo.url, photo.edit],
              [currentPhoto.url, currentPhoto.edit]
            )
        ),
        matchingHistory = options.filter(
          (photo) => photo.url === (currentPhoto?.url || workbookPhoto?.url)
        ),
        latestHistory = matchingHistory.filter(
          (photo) => photo.observedAt === matchingHistory[0]?.observedAt
        ),
        exactPrevious = latestHistory.length === 1 ? latestHistory[0] : null,
        previousPhoto =
          exactPrevious || (options.length === 1 ? options[0] : null)
      let action =
          raw.action ||
          (pairingRequired
            ? null
            : currentPhoto?.edit !== undefined
              ? 'current'
              : workbookPhoto
                ? 'workbook'
                : 'remove'),
        chosen = null
      if (pairingRequired) {
        summary.pending++
        issue(
          'STORE_UPDATE_PHOTO_PAIRING_REQUIRED',
          'Choose which current photo this workbook photo replaces, or add it as new.',
          key
        )
      } else if (action === 'current') chosen = currentPhoto
      else if (action === 'workbook') chosen = workbookPhoto
      else if (action === 'previous') {
        chosen = raw.previousPhoto
          ? findReference(options, raw.previousPhoto)
          : previousPhoto
        if (
          chosen &&
          raw.previousObservedAt &&
          chosen.observedAt !== raw.previousObservedAt
        )
          chosen = null
      } else if (action !== 'remove' || workbookPhoto) {
        issue(
          'STORE_UPDATE_PHOTO_CHOICE_INVALID',
          'Review this product’s photo choices again.',
          key
        )
        action = null
      }
      if (!pairingRequired && action && action !== 'remove' && !chosen)
        issue(
          'STORE_UPDATE_PHOTO_CHOICE_INVALID',
          'The selected photo is no longer available. Review the photo choices again.',
          key
        )
      if (chosen) {
        selected.push(chosen)
        if (action === 'current' && chosen.edit !== undefined)
          summary.editedKept++
        else if (action === 'workbook') summary.workbookSelected++
        else if (action === 'previous') summary.previousSelected++
      }
      normalized[key] = {
        action,
        ...(currentPhoto
          ? { currentPhoto: currentPhoto.key }
          : explicitNew.has(key)
            ? { currentPhoto: 'new' }
            : {}),
        ...(action === 'previous' && chosen
          ? { previousPhoto: chosen.key, previousObservedAt: chosen.observedAt }
          : {}),
      }
      slots.push({
        key,
        current: currentPhoto || null,
        workbook: workbookPhoto || null,
        previous: previousPhoto,
        currentOptions,
        previousOptions: options,
        action,
        selected: chosen,
        pairingRequired,
      })
    }
    for (const photo of workbook) {
      const key = workbookKey(photo),
        paired = assigned.get(key),
        pairingRequired =
          !paired && !explicitNew.has(key) && unpaired.length > 0
      resolve(key, paired, photo, pairingRequired, paired ? [paired] : unpaired)
    }
    for (const photo of unpaired)
      resolve(`current:${photo.photoIndex}:${photo.url}`, photo, null, false, [
        photo,
      ])
    if (!selected.length && !slots.some((slot) => slot.pairingRequired))
      issue(
        'STORE_UPDATE_PHOTO_EMPTY',
        'Keep at least one photo for this product.'
      )
    const result = { ...incoming },
      refs = selected.length ? selected : workbook,
      photos = refs.map((photo) => photo.url),
      edits = Object.fromEntries(
        refs.flatMap((photo, index) =>
          photo.edit === undefined ? [] : [[index, clone(photo.edit)]]
        )
      )
    result.photos = photos
    if (!same(photos, incoming.photos))
      result.sourcePhotos = [...incoming.photos]
    else delete result.sourcePhotos
    if (Object.keys(edits).length) result.photoEdits = edits
    else delete result.photoEdits
    result.thumbnail =
      refs[0]?.thumbnail ||
      (refs[0]?.edit === undefined && originals.get(refs[0]?.url)) ||
      refs[0]?.url ||
      incoming.thumbnail
    const changed =
        !!old && !same(effectivePhotos(old), effectivePhotos(result)),
      sourceChanged =
        !!old && !same(importedProductPhotos(old), incoming.photos),
      customized = current.some((photo) => photo.edit !== undefined)
    if (changed) summary.changedProducts++
    choices[incoming.entryId] = normalized
    changes.push({
      entryId: incoming.entryId,
      incomingRow: incoming.sourceRow,
      group: incoming.sourceGroup,
      title: incoming.title,
      productNumber: incoming.productNumber || '',
      sourceVariant: incoming.sourceVariant || '',
      sourceSize: incoming.sourceSize || '',
      slots,
      changed,
      sourceChanged,
      customized,
    })
    return result
  })
  return {
    items,
    photoChoices: choices,
    photoChanges: changes,
    photoSummary: summary,
    issues,
  }
}
