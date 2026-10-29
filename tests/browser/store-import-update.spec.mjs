import { test, expect } from './extension-fixture.mjs'
import { workbookFile, png } from '../fixtures/store-workbook-fixture.mjs'
import { SYNTHETIC_PHOTO } from '../fixtures/container-fixture.mjs'
import { readFile } from 'node:fs/promises'
import { CFB } from 'xlsx'
import { savedBrowserDownload } from './smart-workspace-helpers.mjs'

const originalRows = [
  { group: '1', description: 'Synthetic cup', price: '3.00' },
  { group: '2', description: 'Synthetic tray', price: '3.00' },
  { group: '3', description: 'Synthetic bowl', price: '3.00' },
]
const updatedRows = [
  {
    group: '2',
    description: 'Synthetic tray',
    boxes: 2,
    price: '3.00',
    kg: 2.5,
    cbm: 0.04,
  },
  {
    group: '4',
    description: 'Synthetic vase',
    price: '5.00',
    kg: 3,
    cbm: 0.05,
  },
  { group: '1', description: 'Synthetic cup', price: '4.00', kg: 2, cbm: 0.03 },
]

function source(rows = originalRows) {
  const values = rows.map((row, index) => ({
    row: index + 2,
    title: row.description,
    description: row.description,
    group: row.group,
    boxes: row.boxes || 1,
    perbox: 10,
    quantity: (row.boxes || 1) * 10,
    price: row.price,
    amount: ((row.boxes || 1) * 10 * Number(row.price)).toFixed(2),
    photos: [`data:image/png;base64,${png.toString('base64')}`],
    variants: [],
  }))
  return {
    filename: '4321.xlsx',
    sheetName: 'Products',
    purchaseDate: '2026-10-20',
    store: { key: 'market:4321', number: '4321', name: '4321', kind: 'market' },
    rows: values,
    total: values.reduce((sum, row) => sum + Number(row.amount), 0).toFixed(2),
  }
}

function workbook(rows = updatedRows, photoBytes = png) {
  return workbookFile({
    name: '4321.xlsx',
    photoBytes,
    rows: [
      [
        'pic',
        'desc',
        'boxes',
        'perbox',
        'price',
        'amount',
        'group',
        'var',
        'kg',
        'cbm',
      ],
      ...rows.map((row) => [
        '',
        row.description,
        row.boxes || 1,
        10,
        Number(row.price),
        (row.boxes || 1) * 10 * Number(row.price),
        row.group,
        '',
        row.kg ?? '',
        row.cbm ?? '',
      ]),
      [
        'total',
        rows.reduce(
          (sum, row) => sum + (row.boxes || 1) * 10 * Number(row.price),
          0
        ),
        'total',
      ],
    ],
    photoSpans: [{ from: 1, to: rows.length + 1 }],
  })
}

async function seed(extension, rows = originalRows) {
  return extension.inspector.evaluate(async (raw) => {
    const db = await window.testRepository
    const review = await db.reviewStoreOrderImport(raw)
    for (const group of review.preparation.groups) {
      group.spanishName = 'NOMBRE PROPIO'
      group.category = '手动品类'
      group.naming = {
        spanishName: { source: 'manual', value: 'NOMBRE PROPIO' },
        category: { source: 'manual', value: '手动品类' },
      }
      for (const variant of group.variants) {
        variant.material = '手动材质'
        variant.materialSource = 'manual'
      }
    }
    const order = await db.importStoreOrder({
      ...review,
      intentId: crypto.randomUUID(),
    })
    await db.setNotes(order.snapshot.orderId, {
      notes: 'Preserved note',
      tags: ['Preserved tag'],
    })
    return order.snapshot.orderId
  }, source(rows))
}

async function state(extension) {
  return extension.inspector.evaluate(async () => {
    const db = await window.testRepository
    const backup = await db.exportBackup({})
    return Object.fromEntries(
      [
        'orders',
        'history',
        'preparations',
        'cartonBatches',
        'allocations',
        'issuedCodes',
      ].map((key) => [key, backup[key]])
    )
  })
}

async function open(extension, file = workbook(), rowCount = 3) {
  const page = await extension.context.newPage()
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#view-orders')).toBeEnabled()
  await page
    .getByRole('button', { name: 'Import spreadsheet', exact: true })
    .click()
  const dialog = page.locator('.store-import-dialog')
  await dialog.getByLabel('Workbook', { exact: true }).setInputFiles(file)
  if (rowCount === null)
    await expect(dialog.locator('.store-import-product').first()).toBeVisible()
  else
    await expect(dialog.locator('.store-import-product')).toHaveCount(rowCount)
  return { page, dialog }
}

async function changes(dialog) {
  const all = dialog.locator('input[name="allReviews"]')
  if ((await all.isVisible()) && (await all.isEnabled())) await all.check()
  await dialog.locator('input[name="photosReviewed"]').check()
  await dialog.locator('[data-action="review-import-changes"]').click()
  const review = dialog.locator('[data-action="store-import-update-review"]')
  await expect(review).toBeVisible()
  return review
}

async function editPhotos(extension, orderId) {
  return extension.inspector.evaluate(async (orderId) => {
    const db = await window.testRepository,
      record = (await db.exportBackup({})).orders.find(
        (record) => record.snapshot.orderId === orderId
      )
    for (const [index, item] of record.snapshot.items.entries()) {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 640
      const context = canvas.getContext('2d')
      context.fillStyle = ['#ffeeaa', '#aaffee', '#eeaaff'][index % 3]
      context.fillRect(0, 0, 640, 640)
      await db.setProductPhoto(orderId, item.entryId, {
        originalPhoto: item.photos[0],
        thumbnail: canvas.toDataURL('image/png'),
        edit: {
          fit: 'cover',
          scale: 1.2,
          x: 0.05,
          y: 0,
          background: '#ffffff',
          tags: [
            {
              id: `tag-${item.entryId}`,
              code: `TAG ${item.entryId}`,
              x: 0.5,
              y: 0.5,
              labelX: 0.8,
              labelY: 0.2,
            },
          ],
          tagScale: 2,
          pointerScale: 1,
          invertPointer: false,
        },
      })
    }
  }, orderId)
}

test('edited shared-original photos render independently, keep by default and replace only the reviewed image after retry', async ({
  extension,
}) => {
  test.setTimeout(60000)
  const orderId = await seed(extension)
  await editPhotos(extension, orderId)
  const before = await state(extension),
    updated = originalRows.map((row, index) => ({
      ...row,
      boxes: index === 0 ? 2 : 1,
      kg: 2.5,
    })),
    { page, dialog } = await open(extension, workbook(updated)),
    review = await changes(dialog)
  await expect(review).toContainText('3 edited photos kept')
  await review.locator('[data-update-filter="photos"]').click()
  const first = review.locator('[data-incoming-row="2"]'),
    second = review.locator('[data-incoming-row="3"]'),
    current = first
      .locator('figure')
      .filter({ hasText: 'Current edited photo' })
      .locator('img'),
    result = first
      .locator('figure')
      .filter({ hasText: 'Result after update' })
      .locator('img'),
    workbookImage = first
      .locator('figure')
      .filter({ hasText: 'Workbook photo' })
      .locator('img')
  await expect(current).toHaveAttribute('src', /^data:image\//)
  await expect(result).toHaveAttribute('src', /^data:image\//)
  await expect(
    second
      .locator('figure')
      .filter({ hasText: 'Current edited photo' })
      .locator('img')
  ).toHaveAttribute('src', /^data:image\//)
  expect(await current.getAttribute('src')).toBe(
    await result.getAttribute('src')
  )
  expect(await current.getAttribute('src')).not.toBe(
    await workbookImage.getAttribute('src')
  )
  expect(await current.getAttribute('src')).not.toBe(
    await second
      .locator('figure')
      .filter({ hasText: 'Current edited photo' })
      .locator('img')
      .getAttribute('src')
  )
  await first
    .getByRole('button', { name: 'Enlarge Current edited photo', exact: true })
    .click()
  const preview = page.locator('.store-update-photo-preview')
  await expect(preview).toBeVisible()
  await expect(preview.locator('img')).toHaveAttribute('src', /^data:image\//)
  await preview.getByRole('button', { name: 'Done', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 740 })
  for (const [language, caption] of [
    ['es', 'Foto editada actual'],
    ['zh', '当前编辑后的图片'],
    ['en', 'Current edited photo'],
  ]) {
    await dialog
      .locator(`.popup-language-toggle [data-language="${language}"]`)
      .click()
    await expect(first).toContainText(caption)
    expect(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
    ).toBe(true)
  }
  expect(await state(extension)).toEqual(before)
  await first
    .getByRole('radio', { name: 'Use workbook photo', exact: true })
    .check()
  await expect(review).toContainText('2 edited photos kept')
  await expect(
    first.getByRole('radio', { name: 'Use workbook photo', exact: true })
  ).toBeChecked()
  await dialog.locator('[data-action="review-update-codes"]').click()
  await dialog.locator('[data-action="back-import-workbook"]').click()
  await expect(
    first.getByRole('radio', { name: 'Use workbook photo', exact: true })
  ).toBeChecked()
  expect(await state(extension)).toEqual(before)
  await dialog.locator('[data-action="review-update-codes"]').click()
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'orders') {
        IDBObjectStore.prototype.put = put
        throw new Error('Synthetic photo update failure')
      }
      return put.apply(this, args)
    }
  })
  await dialog.locator('[data-action="update-store-purchase"]').click()
  await expect(dialog).toContainText('Synthetic photo update failure')
  expect(await state(extension)).toEqual(before)
  await dialog.locator('[data-action="back-import-workbook"]').click()
  await expect(
    first.getByRole('radio', { name: 'Use workbook photo', exact: true })
  ).toBeChecked()
  await dialog.locator('[data-action="review-update-codes"]').click()
  await dialog.locator('[data-action="update-store-purchase"]').click()
  await expect(dialog).toHaveCount(0)
  const after = await state(extension),
    items = after.orders[0].snapshot.items,
    oldItems = before.orders[0].snapshot.items
  expect(items[0].photoEdits).toBeUndefined()
  expect(items[0].quantity).toBe('20')
  for (const index of [1, 2]) {
    expect(items[index].photoEdits).toEqual(oldItems[index].photoEdits)
    expect(items[index].thumbnail).toBe(oldItems[index].thumbnail)
  }
  expect(after.preparations[0].groups).toEqual(before.preparations[0].groups)
})

test('history photo-only recovery is explicit, reversible and preserves the already updated purchase values', async ({
  extension,
}) => {
  const orderId = await seed(extension)
  await editPhotos(extension, orderId)
  await extension.inspector.evaluate(async (raw) => {
    const db = await window.testRepository,
      order = (await db.exportBackup({})).orders[0],
      target = { accountId: 'local', orderId: order.snapshot.orderId },
      review = await db.reviewStoreOrderUpdate({ ...raw, target }),
      photoChoices = structuredClone(review.photoChoices)
    for (const product of review.photoChanges)
      for (const slot of product.slots)
        photoChoices[product.entryId][slot.key].action = 'workbook'
    const replace = await db.reviewStoreOrderUpdate({ ...review, photoChoices })
    await db.updateStoreOrder({
      ...replace,
      intentId: 'simulate-reviewed-photo-replacement',
    })
  }, source())
  const before = await state(extension),
    { dialog } = await open(extension, workbook(originalRows)),
    review = await changes(dialog)
  await expect(review).toContainText('No changes to apply')
  await review.locator('[data-update-filter="photos"]').click()
  await expect(review.locator('[data-incoming-row="2"]')).toContainText(
    'Previous edited photo'
  )
  await review.locator('[data-photo-bulk="previous"]').click()
  await expect(review).toContainText('3 previous edits selected')
  await expect(
    dialog.locator('[data-action="review-update-codes"]')
  ).toBeEnabled()
  await review
    .getByRole('button', { name: 'Reset photo choices', exact: true })
    .click()
  await expect(review).toContainText('No changes to apply')
  expect(await state(extension)).toEqual(before)
  await review.locator('[data-photo-bulk="previous"]').click()
  await dialog.locator('[data-action="review-update-codes"]').click()
  await dialog.locator('[data-action="update-store-purchase"]').click()
  await expect(dialog).toHaveCount(0)
  const after = await state(extension)
  for (const item of after.orders[0].snapshot.items)
    expect(item.photoEdits['0'].tags[0].code).toBe(`TAG ${item.entryId}`)
  expect({
    ...after.orders[0].snapshot.spreadsheet,
    importedAt: before.orders[0].snapshot.spreadsheet.importedAt,
  }).toEqual(before.orders[0].snapshot.spreadsheet)
  expect(after.orders[0].snapshot.purchasedAt).toBe(
    before.orders[0].snapshot.purchasedAt
  )
  expect(
    after.orders[0].snapshot.items.map(({ quantity, price }) => ({
      quantity,
      price,
    }))
  ).toEqual(
    before.orders[0].snapshot.items.map(({ quantity, price }) => ({
      quantity,
      price,
    }))
  )
  expect(after.cartonBatches).toEqual(before.cartonBatches)
  expect(after.preparations[0].groups).toEqual(before.preparations[0].groups)
})

test('pairing a changed workbook photo to an edited current image keeps its crop and tags by default', async ({
  extension,
}) => {
  test.setTimeout(60000)
  const raw = source()
  raw.rows[0].photos.push(SYNTHETIC_PHOTO)
  const orderId = await extension.inspector.evaluate(async (raw) => {
    const db = await window.testRepository,
      review = await db.reviewStoreOrderImport(raw),
      saved = await db.importStoreOrder({
        ...review,
        intentId: 'paired-photo-seed',
      }),
      item = saved.snapshot.items[0]
    await db.setProductPhoto(saved.snapshot.orderId, item.entryId, {
      originalPhoto: item.photos[0],
      thumbnail: raw.rows[0].photos[0],
      edit: {
        fit: 'cover',
        scale: 1.3,
        tags: [
          {
            id: 'preserve',
            code: 'KEEP ME',
            x: 0.5,
            y: 0.5,
            labelX: 0.9,
            labelY: 0.1,
          },
        ],
      },
    })
    return saved.snapshot.orderId
  }, raw)
  const originalPhoto = await extension.inspector.evaluate(async (orderId) => {
    const db = await window.testRepository,
      item = (await db.exportBackup({})).orders.find(
        (record) => record.snapshot.orderId === orderId
      ).snapshot.items[0]
    return {
      original: (await db.getImage(item.photos[0])).dataUrl,
      edit: item.photoEdits['0'],
      entryId: item.entryId,
    }
  }, orderId)
  const renderer = await extension.context.newPage()
  await renderer.goto(`${extension.origin}/fixture.html`)
  const expectedThumbnail = await renderer.evaluate(
    async ({ original, edit }) => {
      const { squareProductPhoto } = await import('/src/product-photo.js')
      return squareProductPhoto(original, edit)
    },
    originalPhoto
  )
  const expectedTableThumbnail = await renderer.evaluate(async (thumbnail) => {
    const { pngThumbnail } = await import('/src/clipboard.js')
    return pngThumbnail(thumbnail, { size: 240 })
  }, expectedThumbnail)
  await renderer.close()
  await extension.inspector.evaluate(
    async ({ orderId, entryId, thumbnail }) => {
      const db = await window.testRepository
      await db.setProductPhoto(orderId, entryId, { thumbnail })
    },
    { orderId, entryId: originalPhoto.entryId, thumbnail: expectedThumbnail }
  )
  const before = await state(extension),
    newer = await extension.inspector.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 48
      const context = canvas.getContext('2d')
      context.fillStyle = '#17ac80'
      context.fillRect(0, 0, 48, 48)
      return canvas.toDataURL('image/png')
    }),
    { page, dialog } = await open(
      extension,
      workbook(originalRows, Buffer.from(newer.split(',')[1], 'base64'))
    ),
    review = await changes(dialog),
    product = review.locator('[data-incoming-row="2"]')
  await product.locator('.store-update-photo-product summary').click()
  const pairing = product.getByLabel(
    'Which current photo does this workbook image replace?',
    { exact: true }
  )
  await expect(pairing).toBeVisible()
  await pairing.selectOption({ label: 'Current photo 1' })
  const first = product.locator('.store-update-photo-slot').first()
  await expect(
    first.getByRole('radio', { name: 'Keep current photo', exact: true })
  ).toBeChecked()
  await expect(
    dialog.locator('[data-action="review-update-codes"]')
  ).toBeEnabled()
  expect(await state(extension)).toEqual(before)
  await dialog.locator('[data-action="review-update-codes"]').click()
  await dialog.locator('[data-action="update-store-purchase"]').click()
  await expect(dialog).toHaveCount(0)
  const after = await state(extension),
    previous = before.orders.find(
      (record) => record.snapshot.orderId === orderId
    ).snapshot.items[0],
    updated = after.orders.find((record) => record.snapshot.orderId === orderId)
      .snapshot.items[0]
  expect(updated.photoEdits['0']).toEqual(previous.photoEdits['0'])
  expect(updated.thumbnail).toBe(expectedThumbnail)
  expect(updated.photos[0]).toBe(previous.photos[0])
  expect(updated.sourcePhotos[0]).not.toBe(previous.photos[0])
  await page.reload()
  const row = page
    .locator('#sheet-body tr[data-selection-key]')
    .filter({ hasText: 'Synthetic cup' })
    .first()
  await expect(row.locator('.thumb-cell img')).toHaveAttribute(
    'src',
    expectedTableThumbnail
  )
  await row
    .getByRole('button', {
      name: `Zoom product photo ${originalPhoto.entryId}`,
      exact: true,
    })
    .click()
  const viewer = page.getByRole('dialog', {
    name: 'Product photo',
    exact: true,
  })
  await expect(viewer.locator('.photo-viewport img')).toHaveAttribute(
    'src',
    expectedThumbnail
  )
  await viewer
    .getByRole('button', { name: 'Close product photo', exact: true })
    .click()
  if (await page.locator('#clear-rows').isEnabled())
    await page.locator('#clear-rows').click()
  await row
    .getByRole('checkbox', {
      name: `Select product ${originalPhoto.entryId}`,
      exact: true,
    })
    .check()
  await page.evaluate(() =>
    localStorage.setItem(
      '1688-excel-image-columns',
      JSON.stringify({
        order: ['thumbnail', 'description', 'quantity'],
        selected: ['thumbnail', 'description', 'quantity'],
      })
    )
  )
  await page.locator('#copy-excel-image').click()
  const excel = page.locator('.image-copy-dialog'),
    exportButton = excel.locator('[data-action="download-excel-table"]')
  await expect(exportButton).toBeEnabled()
  const pending = page.waitForEvent('download')
  await exportButton.click()
  const download = await pending,
    bytes = await readFile(await savedBrowserDownload(extension, download)),
    archive = CFB.read(bytes, { type: 'buffer' }),
    photos = archive.FullPaths.flatMap((path, index) =>
      /\/xl\/media\/[^/]+$/.test(path)
        ? [{ path, bytes: Buffer.from(archive.FileIndex[index].content) }]
        : []
    )
  expect(photos).toHaveLength(1)
  const exported = `data:image/${photos[0].path.endsWith('.png') ? 'png' : 'jpeg'};base64,${photos[0].bytes.toString('base64')}`
  const samples = await page.evaluate(
    async ({ expected, exported, incoming }) => {
      const sample = async (source) => {
        const image = new Image()
        image.src = source
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const context = canvas.getContext('2d')
        context.drawImage(image, 0, 0)
        return [
          ...context.getImageData(
            Math.floor(canvas.width * 0.1),
            Math.floor(canvas.height * 0.85),
            1,
            1
          ).data,
        ].slice(0, 3)
      }
      return Promise.all([sample(expected), sample(exported), sample(incoming)])
    },
    { expected: expectedThumbnail, exported, incoming: newer }
  )
  expect(
    samples[1].every((value, index) => Math.abs(value - samples[0][index]) < 15)
  ).toBe(true)
  expect(
    samples[1].reduce(
      (sum, value, index) => sum + Math.abs(value - samples[2][index]),
      0
    )
  ).toBeGreaterThan(100)
  await excel.getByRole('button', { name: 'Done', exact: true }).click()
})

test('carton reductions and additions review in every language and update the same batches once', async ({
  extension,
}) => {
  test.setTimeout(60000)
  const old = originalRows.map((row, index) => ({
      ...row,
      boxes: [6, 5, 1][index],
    })),
    updated = old.map((row, index) => ({
      ...row,
      boxes: [4, 4, 3][index],
      kg: 2.5,
      cbm: 0.04,
    }))
  await seed(extension, old)
  await extension.inspector.evaluate(async () => {
    const db = await window.testRepository,
      backup = await db.exportBackup({})
    for (const batch of backup.cartonBatches)
      await db.saveCartonBatch({
        ...batch,
        entitlementIndices: Array.from(
          { length: batch.count },
          (_, i) => 2 + i * 3
        ),
        unitLabels: { 2: 'Supplier first carton' },
      })
  })
  const before = await state(extension),
    { page, dialog } = await open(extension, workbook(updated)),
    review = await changes(dialog)
  await expect(review).toContainText('All 3 unit prices unchanged')
  await expect(review).toContainText('3 rows gain weight/volume data')
  await page.setViewportSize({ width: 390, height: 740 })
  for (const [language, reduced, increased, retired] of [
    [
      'es',
      'Cajas reducidas: 6 → 4',
      'Cajas aumentadas: 1 → 3',
      '0 cajas añadidas · 2 cajas retiradas',
    ],
    ['zh', '箱数减少：6 → 4', '箱数增加：1 → 3', '新增 0 箱 · 移除 2 箱'],
    [
      'en',
      'Cartons reduced: 6 → 4',
      'Cartons increased: 1 → 3',
      '0 cartons added · 2 cartons retired',
    ],
  ]) {
    await dialog
      .locator(`.popup-language-toggle [data-language="${language}"]`)
      .click()
    await expect(
      review.locator('[data-incoming-row="2"] .store-update-cartons')
    ).toContainText(reduced)
    await expect(
      review.locator('[data-incoming-row="2"] .store-update-cartons')
    ).toContainText(retired)
    await expect(
      review.locator('[data-incoming-row="4"] .store-update-cartons')
    ).toContainText(increased)
    expect(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
    ).toBe(true)
  }
  await expect(
    review.locator('[data-incoming-row="3"] .store-update-cartons')
  ).toContainText('Cartons reduced: 5 → 4')
  await dialog.locator('[data-action="review-update-codes"]').click()
  await expect(
    dialog.locator('[data-action="update-store-purchase"]')
  ).toBeEnabled()
  await dialog.locator('[data-action="back-import-workbook"]').click()
  await expect(review).toBeVisible()
  await expect(review).toContainText('Cartons reduced: 6 → 4')
  expect(await state(extension)).toEqual(before)
  await dialog.locator('[data-action="review-update-codes"]').click()
  await dialog
    .locator('[data-action="update-store-purchase"]')
    .evaluate((node) => {
      node.click()
      node.click()
    })
  await expect(dialog).toHaveCount(0)
  const after = await state(extension)
  expect(after.orders).toHaveLength(1)
  expect(after.history).toHaveLength(before.history.length + 1)
  expect(after.cartonBatches).toHaveLength(3)
  expect(after.preparations[0].groups.map((group) => group.baseCode)).toEqual(
    before.preparations[0].groups.map((group) => group.baseCode)
  )
  for (const [index, previous] of before.cartonBatches.entries()) {
    const next = after.cartonBatches.find((batch) => batch.id === previous.id)
    expect(next.count).toBe([4, 4, 3][index])
    expect(next.entitlementIndices).toEqual(
      index === 2 ? [2, 3, 4] : [2, 5, 8, 11]
    )
    expect(next.unitLabels).toEqual({ 2: 'Supplier first carton' })
    expect(next.weight).toBe('2.5')
  }
  expect(after.orders[0].snapshot.totals.payable).toBe('330.00')
  const reopened = await open(extension, workbook(updated))
  const noChange = await changes(reopened.dialog)
  await expect(noChange).toContainText('No changes to apply')
  await reopened.dialog
    .getByRole('button', { name: 'Cancel', exact: true })
    .click()
})

test('a received-carton conflict names its product row and count while preserving the unsaved update', async ({
  extension,
}) => {
  const old = originalRows.map((row) => ({ ...row, boxes: 5 }))
  await seed(extension, old)
  await extension.inspector.evaluate(async () => {
    const db = await window.testRepository,
      backup = await db.exportBackup({}),
      batch = backup.cartonBatches[0]
    await db.saveCartonBatch({ ...batch, received: 5 })
  })
  const before = await state(extension),
    updated = old.map((row, index) => ({ ...row, boxes: index === 0 ? 4 : 5 })),
    { dialog } = await open(extension, workbook(updated)),
    review = await changes(dialog)
  const issue = review.locator('.store-update-issues [data-blocking="true"]')
  await expect(issue).toHaveCount(1)
  await expect(issue).toContainText('Group 1 · Excel row 2')
  await expect(issue).toContainText('Received: 5')
  await expect(issue).toContainText('Updated cartons: 4')
  await issue.click()
  await expect(review.locator('[data-incoming-row="2"]')).toBeFocused()
  await dialog.locator('[data-action="review-update-codes"]').click()
  const errors = dialog.locator('[data-action="store-import-code-errors"]')
  await expect(errors).toContainText(
    'Resolve these issues before updating the purchase.'
  )
  await expect(errors.locator('li')).toHaveCount(1)
  await expect(errors).toContainText('Group 1 · Excel row 2')
  await expect(
    dialog.locator('[data-action="update-store-purchase"]')
  ).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await state(extension)).toEqual(before)

  const removal = await open(extension, workbook(old.slice(1)), 2),
    removalReview = await changes(removal.dialog),
    removalIssue = removalReview.locator(
      '.store-update-issues [data-blocking="true"]'
    )
  await expect(removalIssue).toHaveCount(1)
  await expect(removalIssue).toContainText('Group 1 · Saved row 2')
  await removalIssue.click()
  await expect(removalReview.locator('[data-previous-row="2"]')).toBeFocused()
  await removal.dialog.locator('[data-action="review-update-codes"]').click()
  await expect(
    removal.dialog.locator('[data-action="store-import-code-errors"]')
  ).toContainText('Group 1 · Saved row 2')
  const removedProductError = removal.dialog.locator(
    '[data-action="store-import-code-errors"] li button'
  )
  await removedProductError.click()
  await expect(removedProductError).toBeFocused()
  await expect(
    removal.dialog.locator('[data-action="update-store-purchase"]')
  ).toBeDisabled()
  await removal.dialog
    .getByRole('button', { name: 'Cancel', exact: true })
    .click()
  expect(await state(extension)).toEqual(before)
})

test('update review separates price and quantity changes and atomically preserves matched identities, codes and authored details', async ({
  extension,
}) => {
  const orderId = await seed(extension)
  const before = await state(extension)
  const { page, dialog } = await open(extension)
  await expect(dialog.locator('select[name="importMode"]')).toHaveValue(
    'update'
  )
  await expect(dialog.locator('select[name="updatePurchase"]')).toHaveValue(
    `local/${orderId}`
  )
  await expect(dialog.locator('input[name="purchaseDate"]')).toHaveValue(
    '2026-10-20'
  )
  await expect(dialog.locator('input[name="purchaseDate"]')).toBeDisabled()
  const review = await changes(dialog)
  await expect(
    review.locator('[data-action="store-update-totals"]')
  ).toContainText('150.00')
  await review.locator('[data-update-filter="prices"]').click()
  await expect(review.locator('[data-incoming-row="4"]')).toBeVisible()
  await expect(review.locator('[data-incoming-row="2"]')).toBeHidden()
  await review.locator('[data-update-filter="added"]').click()
  await expect(review.locator('[data-incoming-row="3"]')).toBeVisible()
  await review.locator('[data-update-filter="all"]').click()
  await dialog.locator('[data-action="review-update-codes"]').click()
  await expect(
    dialog.locator('[data-action="store-import-code-review"]')
  ).toBeVisible()
  await expect(
    dialog.locator('[data-action="update-store-purchase"]')
  ).toBeEnabled()
  await dialog.locator('[data-action="update-store-purchase"]').click()
  await expect(dialog).toHaveCount(0)
  const after = await state(extension)
  expect(after.orders).toHaveLength(1)
  const saved = after.orders[0]
  expect(saved.snapshot.orderId).toBe(orderId)
  expect(saved.snapshot.purchasedAt).toBe(before.orders[0].snapshot.purchasedAt)
  expect(saved.snapshot.totals.payable).toBe('150.00')
  expect(saved.notes).toBe('Preserved note')
  expect(saved.tags).toEqual(['Preserved tag'])
  const oldItems = before.orders[0].snapshot.items
  for (const group of ['1', '2']) {
    const old = oldItems.find((item) => item.sourceGroup === group)
    const next = saved.snapshot.items.find((item) => item.sourceGroup === group)
    expect(next.entryId).toBe(old.entryId)
    const previousGroup = before.preparations[0].groups.find((g) =>
      g.variants.some((v) => v.entryIds.includes(old.entryId))
    )
    const nextGroup = after.preparations[0].groups.find((g) =>
      g.variants.some((v) => v.entryIds.includes(next.entryId))
    )
    expect(nextGroup.id).toBe(previousGroup.id)
    expect(nextGroup.baseCode).toBe(previousGroup.baseCode)
    expect(nextGroup.spanishName).toBe('NOMBRE PROPIO')
    expect(nextGroup.category).toBe('手动品类')
    expect(nextGroup.variants[0].material).toBe('手动材质')
  }
  expect(after.cartonBatches.filter((batch) => !batch.deletedAt)).toHaveLength(
    3
  )
  expect(after.cartonBatches.filter((batch) => batch.deletedAt)).toHaveLength(1)
  expect(after.history).toHaveLength(1)
  await page.reload()
  await expect(page.locator('#view-orders')).toBeEnabled()
  expect((await state(extension)).orders[0].snapshot.totals.payable).toBe(
    '150.00'
  )
})

test('Back and Cancel retain the review draft without writing source, assignments or cartons', async ({
  extension,
}) => {
  await seed(extension)
  const before = await state(extension)
  const { dialog } = await open(extension)
  await changes(dialog)
  await dialog.locator('[data-action="review-update-codes"]').click()
  const base = dialog.locator('[data-code-field="baseCode"]').first()
  await base.fill('CE26100188')
  await base.press('Tab')
  await dialog.locator('[data-action="back-import-workbook"]').click()
  await expect(
    dialog.locator('[data-action="store-import-update-review"]')
  ).toBeVisible()
  await dialog.locator('[data-action="review-update-codes"]').click()
  await expect(
    dialog.locator('[data-code-field="baseCode"]').first()
  ).toHaveValue('CE26100188')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(await state(extension)).toEqual(before)
})

test('an identical workbook is an explicit no-op and cannot create a duplicate purchase', async ({
  extension,
}) => {
  await seed(extension)
  const before = await state(extension)
  const { dialog } = await open(extension, workbook(originalRows))
  const review = await changes(dialog)
  await expect(review).toContainText('No changes to apply')
  await expect(
    dialog.locator('[data-action="review-update-codes"]')
  ).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await state(extension)).toEqual(before)
})

test('change review translates without remounting the draft and fits a narrow window', async ({
  extension,
}) => {
  await seed(extension)
  const { page, dialog } = await open(extension)
  await changes(dialog)
  const before = await state(extension)
  await page.setViewportSize({ width: 390, height: 740 })
  for (const [language, title, prices] of [
    ['es', 'Revisar cambios del Excel', 'Cambios de precio'],
    ['zh', '审核表格变更', '单价变更'],
    ['en', 'Review spreadsheet changes', 'Price changes'],
  ]) {
    await dialog
      .locator(`.popup-language-toggle [data-language="${language}"]`)
      .click()
    await expect(dialog).toHaveAttribute(
      'lang',
      language === 'zh' ? 'zh-CN' : language
    )
    await expect(
      dialog.locator('[data-action="review-update-codes"]')
    ).toBeEnabled()
    await expect(
      dialog.locator('[data-action="store-import-update-review"] h3')
    ).toHaveText(title)
    await expect(dialog.locator('[data-update-filter="prices"]')).toHaveText(
      prices
    )
    expect(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
    ).toBe(true)
    expect(
      await dialog.locator('[data-action="store-update-totals"]').innerText()
    ).not.toBe('')
  }
  await dialog.screenshot({
    path: test.info().outputPath('spreadsheet-update-narrow.png'),
  })
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await state(extension)).toEqual(before)
})

test('multiple same-store purchases require a target instead of guessing or replacing both', async ({
  extension,
}) => {
  await seed(extension)
  await seed(extension)
  const before = await state(extension)
  const { dialog } = await open(extension)
  await expect(dialog.locator('select[name="importMode"]')).toHaveValue(
    'update'
  )
  await expect(dialog.locator('select[name="updatePurchase"]')).toHaveValue('')
  const all = dialog.locator('input[name="allReviews"]')
  if ((await all.isVisible()) && (await all.isEnabled())) await all.check()
  await dialog.locator('input[name="photosReviewed"]').check()
  await dialog.locator('[data-action="review-import-changes"]').click()
  await expect(
    dialog.locator('[data-action="store-import-update-review"]')
  ).toBeHidden()
  await expect(dialog.locator('select[name="updatePurchase"]')).toHaveAttribute(
    'aria-invalid',
    'true'
  )
  await dialog
    .getByRole('button', { name: 'Close import', exact: true })
    .click()
  expect(await state(extension)).toEqual(before)
})

test('ambiguous separately accounted rows require explicit matching before code review', async ({
  extension,
}) => {
  const duplicates = [
    { group: '1', description: 'Synthetic cup', price: '3.00' },
    { group: '1', description: 'Synthetic cup', price: '3.00' },
    { group: '2', description: 'Synthetic tray', price: '3.00' },
  ]
  await seed(extension, duplicates)
  const before = await state(extension)
  const changed = duplicates.map((row, index) => ({
    ...row,
    boxes: index === 0 ? 2 : 1,
  }))
  const { dialog } = await open(extension, workbook(changed))
  const review = await changes(dialog)
  await expect(
    dialog.locator('[data-action="review-update-codes"]')
  ).toBeDisabled()
  await expect(
    review.locator('select[name="update-mapping-2"]')
  ).toHaveAttribute('aria-invalid', 'true')
  await review.locator('select[name="update-mapping-2"]').selectOption('3')
  await expect(
    dialog.locator('[data-action="review-update-codes"]')
  ).toBeEnabled()
  await dialog.locator('[data-action="review-update-codes"]').click()
  await expect(
    dialog.locator('[data-action="update-store-purchase"]')
  ).toBeEnabled()
  await dialog.locator('[data-action="update-store-purchase"]').click()
  await expect(dialog).toHaveCount(0)
  const after = await state(extension)
  const originalSecond = before.orders[0].snapshot.items.find(
    (item) => item.sourceRow === 3
  )
  expect(
    after.orders[0].snapshot.items.find((item) => item.sourceRow === 2).entryId
  ).toBe(originalSecond.entryId)
  expect(
    after.orders[0].snapshot.items
      .filter((item) => item.sourceGroup === '1')
      .map((item) => item.quantity)
  ).toEqual(['20', '10'])
})

test('changed photos show saved and unsaved originals before any update is committed', async ({
  extension,
}) => {
  await seed(extension)
  const before = await state(extension)
  const { dialog } = await open(
    extension,
    workbook(updatedRows, Buffer.from(SYNTHETIC_PHOTO.split(',')[1], 'base64'))
  )
  const review = await changes(dialog)
  const changedPhoto = review.locator('[data-incoming-row="4"]'),
    images = changedPhoto.locator('img')
  await expect(images).toHaveCount(3)
  await expect(changedPhoto).toContainText('Current photo')
  await expect(changedPhoto).toContainText('Workbook photo')
  await expect(changedPhoto).toContainText('Result after update')
  for (const image of await images.all()) {
    await expect(image).toHaveAttribute('src', /^data:image\//)
    await image.evaluate((node) => node.decode())
    expect(await image.evaluate((node) => node.naturalWidth)).toBeGreaterThan(0)
  }
  expect(await images.nth(0).getAttribute('src')).not.toBe(
    await images.nth(1).getAttribute('src')
  )
  expect(await images.nth(2).getAttribute('src')).toBe(
    await images.nth(1).getAttribute('src')
  )
  const added = review.locator('[data-incoming-row="3"] img').first()
  await expect(added).toHaveAttribute('src', /^data:image\//)
  await added.evaluate((node) => node.decode())
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await state(extension)).toEqual(before)
})

test('large reviews bound mounted cards and resolve an offscreen ambiguous match on narrow screens', async ({
  extension,
}) => {
  test.setTimeout(60000)
  const many = Array.from({ length: 52 }, (_, index) => ({
    group: index >= 50 ? 'duplicate' : String(index + 1),
    description:
      index >= 50 ? 'Synthetic duplicate' : `Synthetic product ${index + 1}`,
    price: '3.00',
  }))
  await seed(extension, many)
  const before = await state(extension)
  const { page, dialog } = await open(
    extension,
    workbook(many.map((row) => ({ ...row, kg: 2, cbm: 0.03 }))),
    null
  )
  const review = await changes(dialog),
    list = review.locator('.store-update-list')
  // Until the two ambiguous incoming rows are mapped, their old counterparts
  // remain visible as pending removals in the complete comparison.
  await expect(list).toHaveAttribute('data-row-count', '54')
  expect(
    await list.locator('.store-update-product').count()
  ).toBeLessThanOrEqual(16)
  await expect(
    dialog.locator('[data-action="review-update-codes"]')
  ).toBeDisabled()
  await list.evaluate((node) => {
    node.scrollTop = node.scrollHeight
  })
  const mapping = list.locator('select[name="update-mapping-52"]')
  await expect(mapping).toBeAttached()
  await mapping.selectOption('53')
  await expect(list).toHaveAttribute('data-row-count', '52')
  await expect(
    dialog.locator('[data-action="review-update-codes"]')
  ).toBeEnabled()
  expect(
    await list.locator('.store-update-product').count()
  ).toBeLessThanOrEqual(16)
  await page.setViewportSize({ width: 390, height: 740 })
  expect(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
  ).toBe(true)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await state(extension)).toEqual(before)
})
