import { test, expect } from './extension-fixture.mjs'
import { workbookFile, png } from '../fixtures/store-workbook-fixture.mjs'
import { SYNTHETIC_PHOTO } from '../fixtures/container-fixture.mjs'

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
  await expect(images).toHaveCount(2)
  await expect(changedPhoto).toContainText('Current photo')
  await expect(changedPhoto).toContainText('Updated photo')
  for (const image of await images.all()) {
    await expect(image).toHaveAttribute('src', /^data:image\//)
    await image.evaluate((node) => node.decode())
    expect(await image.evaluate((node) => node.naturalWidth)).toBeGreaterThan(0)
  }
  expect(await images.nth(0).getAttribute('src')).not.toBe(
    await images.nth(1).getAttribute('src')
  )
  const added = review.locator('[data-incoming-row="3"] img')
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
