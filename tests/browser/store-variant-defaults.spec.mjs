import { test, expect } from './extension-fixture.mjs'
import {
  evenVariantWorkbook,
  evenVariantSplitInput,
  EVEN_SPLIT_EXPECTED,
} from '../fixtures/even-variant-split.mjs'
import { workbookFile } from '../fixtures/store-workbook-fixture.mjs'
import { suggestStoreVariantQuantities } from '../../src/store-workbook-model.js'

async function open(extension, file = evenVariantWorkbook(), count = 8) {
  const page = await extension.context.newPage()
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#view-orders')).toBeEnabled()
  await page
    .getByRole('button', { name: 'Import spreadsheet', exact: true })
    .click()
  const dialog = page.locator('.store-import-dialog')
  await dialog.getByLabel('Workbook', { exact: true }).setInputFiles(file)
  await expect(dialog.locator('.store-import-product')).toHaveCount(count)
  return { page, dialog }
}
async function acknowledge(dialog) {
  const date = dialog.getByLabel('Purchase date', { exact: true })
  if (await date.isEnabled()) await date.fill('2026-10-20')
  const all = dialog.locator('input[name="allReviews"]')
  if (await all.isEnabled()) await all.check()
  await dialog.locator('input[name="photosReviewed"]').check()
}
const values = (card) =>
  card
    .locator('.store-import-allocation input')
    .evaluateAll((inputs) => inputs.map((input) => input.value))
async function state(extension) {
  return extension.inspector.evaluate(async () => {
    const db = await window.testRepository,
      result = await db.exportBackup({})
    return Object.fromEntries(
      ['orders', 'history', 'preparations', 'cartonBatches', 'issuedCodes'].map(
        (key) => [key, result[key]]
      )
    )
  })
}

test('eight rows prefill 30 quantities and one confirmation saves exact goods, money and shared cartons once', async ({
  extension,
}) => {
  test.setTimeout(60000)
  const { page, dialog } = await open(extension)
  const cards = dialog.locator('.store-import-product')
  for (let index = 0; index < 8; index++) {
    expect(await values(cards.nth(index))).toEqual(
      EVEN_SPLIT_EXPECTED[index].map(String)
    )
    await expect(
      cards.nth(index).locator('.store-import-allocation-total')
    ).toHaveClass(/is-valid/)
  }
  expect((await state(extension)).orders).toHaveLength(0)
  await acknowledge(dialog)
  await dialog.locator('[data-action="review-import-codes"]').click()
  const save = dialog.locator('[data-action="import-and-assign-codes"]')
  await expect(save).toBeEnabled()
  await save.evaluate((button) => {
    button.click()
    button.click()
  })
  await expect(dialog).toHaveCount(0)
  const saved = await state(extension),
    items = saved.orders[0].snapshot.items
  expect(saved.orders).toHaveLength(1)
  expect(saved.history).toHaveLength(0)
  expect(items).toHaveLength(30)
  expect(items.map((item) => item.quantity)).toEqual(
    EVEN_SPLIT_EXPECTED.flat().map(String)
  )
  expect(items.reduce((sum, item) => sum + Number(item.quantity), 0)).toBe(5400)
  expect(saved.cartonBatches.reduce((sum, batch) => sum + batch.count, 0)).toBe(
    18
  )
  expect(saved.orders[0].snapshot.totals.payable).toBe('10740.00')
  await page.reload()
  expect(
    (await state(extension)).orders[0].snapshot.items.map(
      (item) => item.quantity
    )
  ).toEqual(items.map((item) => item.quantity))
})

test('editable split survives languages, photo edits, Back and code reset; Cancel saves nothing', async ({
  extension,
}) => {
  test.setTimeout(60000)
  const { page, dialog } = await open(extension),
    before = await state(extension),
    first = dialog.locator('.store-import-product').first(),
    inputs = first.locator('.store-import-allocation input')
  await inputs.nth(0).fill('200')
  await inputs.nth(1).fill('250')
  for (const [language, text] of [
    ['es', 'Se reparte por igual'],
    ['zh', '默认平均分配'],
    ['en', 'Split evenly by default'],
  ]) {
    await page.setViewportSize({ width: 390, height: 740 })
    await dialog
      .locator(`.popup-language-toggle [data-language="${language}"]`)
      .click()
    await expect(first).toContainText(text)
    expect(await values(first)).toEqual(['200', '250', '225', '225'])
    expect(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
    ).toBe(true)
  }
  await inputs.nth(0).focus()
  await expect(inputs.nth(0)).toBeFocused()
  await expect(inputs.nth(0)).toHaveAttribute('aria-describedby', /-help /)
  await first
    .getByRole('button', {
      name: 'View or adjust row 19, photo 1',
      exact: true,
    })
    .click()
  const viewer = page.getByRole('dialog', {
    name: 'Product photo',
    exact: true,
  })
  await viewer.getByRole('button', { name: 'Edit photo', exact: true }).click()
  await viewer.getByLabel('Canvas fit', { exact: true }).selectOption('cover')
  await viewer.getByRole('button', { name: 'Save photo', exact: true }).click()
  await viewer
    .getByRole('button', { name: 'Close product photo', exact: true })
    .click()
  expect(await values(first)).toEqual(['200', '250', '225', '225'])
  await acknowledge(dialog)
  await dialog.locator('[data-action="review-import-codes"]').click()
  const save = dialog.locator('[data-action="import-and-assign-codes"]')
  await expect(save).toBeEnabled()
  await dialog.locator('[data-action="reset-import-codes"]').click()
  await expect(save).toBeEnabled()
  await dialog.locator('[data-action="back-import-workbook"]').click()
  expect(await values(first)).toEqual(['200', '250', '225', '225'])
  await inputs.nth(0).fill('')
  await expect(inputs.nth(0)).toHaveValue('')
  await expect(first.locator('.store-import-allocation-total')).toHaveClass(
    /is-error/
  )
  await inputs.nth(0).fill('200')
  await inputs.nth(1).fill('249')
  await dialog.locator('[data-action="review-import-codes"]').click()
  await expect(dialog.locator('.store-import-status')).toContainText(
    'the sum must be 900'
  )
  await dialog
    .getByRole('button', { name: 'Close import', exact: true })
    .click()
  expect(await state(extension)).toEqual(before)
})

test('existing-purchase update uses editable defaults and changes reviewed variant quantities without duplicating cartons or codes', async ({
  extension,
}) => {
  test.setTimeout(60000)
  const raw = evenVariantSplitInput()
  raw.rows = raw.rows.map((row) => ({
    ...row,
    variantAllocations: row.variants.map((variant, index) => ({
      ...variant,
      quantity: Number(suggestStoreVariantQuantities(row)[index]),
    })),
  }))
  raw.rows[0].variantAllocations[0].quantity = 200
  raw.rows[0].variantAllocations[1].quantity = 250
  await extension.inspector.evaluate(async (raw) => {
    const db = await window.testRepository,
      review = await db.reviewStoreOrderImport(raw)
    await db.importStoreOrder({ ...review, intentId: 'even-split-update-seed' })
  }, raw)
  const before = await state(extension),
    { dialog } = await open(extension)
  await expect(dialog.locator('select[name="importMode"]')).toHaveValue(
    'update'
  )
  const first = dialog.locator('.store-import-product').first(),
    inputs = first.locator('.store-import-allocation input')
  expect(await values(first)).toEqual(['225', '225', '225', '225'])
  await inputs.nth(0).fill('210')
  await inputs.nth(1).fill('240')
  await acknowledge(dialog)
  await dialog.locator('[data-action="review-import-changes"]').click()
  await expect(
    dialog.locator('[data-action="store-import-update-review"]')
  ).toContainText('Variant quantities')
  await dialog.locator('[data-action="review-update-codes"]').click()
  const save = dialog.locator('[data-action="update-store-purchase"]')
  await expect(save).toBeEnabled()
  await dialog.locator('[data-action="back-import-workbook"]').click()
  await dialog.locator('[data-action="review-update-codes"]').click()
  await expect(save).toBeEnabled()
  await save.evaluate((button) => {
    button.click()
    button.click()
  })
  await expect(dialog).toHaveCount(0)
  const after = await state(extension)
  expect(after.orders).toHaveLength(1)
  expect(after.orders[0].snapshot.orderId).toBe(
    before.orders[0].snapshot.orderId
  )
  expect(
    after.orders[0].snapshot.items.slice(0, 4).map((item) => item.quantity)
  ).toEqual(['210', '240', '225', '225'])
  expect(after.orders[0].snapshot.totals.payable).toBe('10740.00')
  expect(after.history).toHaveLength(before.history.length + 1)
  expect(after.cartonBatches.map((batch) => [batch.id, batch.count])).toEqual(
    before.cartonBatches.map((batch) => [batch.id, batch.count])
  )
  expect(after.preparations[0].groups.map((group) => group.baseCode)).toEqual(
    before.preparations[0].groups.map((group) => group.baseCode)
  )
})

test('insufficient pieces stay actionable and sheet changes seed fresh defaults without saving anything', async ({
  extension,
}) => {
  const rows = [
    ['pic', 'desc', 'boxes', 'perbox', 'price', 'amount', 'group', 'var'],
    ['', 'Synthetic insufficient set', 1, 2, 3, 6, 1, 'abcd'],
    ['total', 6, 'total'],
  ]
  const { dialog } = await open(extension, workbookFile({ rows }), 1)
  await expect(dialog.locator('.store-import-allocation-total')).toContainText(
    '2 pieces cannot give all 4 variants'
  )
  await expect(dialog).not.toContainText('For the default split, extra pieces')
  expect(await values(dialog.locator('.store-import-product'))).toEqual([
    '',
    '',
    '',
    '',
  ])
  await dialog
    .getByLabel('Workbook', { exact: true })
    .setInputFiles(
      evenVariantWorkbook({ additionalSheets: [{ name: 'Alternate', rows }] })
    )
  await expect(dialog.locator('.store-import-product')).toHaveCount(8)
  await dialog.locator('.store-import-allocation input').first().fill('200')
  await dialog.getByLabel('Sheet', { exact: true }).selectOption('Alternate')
  await expect(dialog.locator('.store-import-product')).toHaveCount(1)
  await expect(dialog.locator('.store-import-allocation-total')).toContainText(
    '2 pieces cannot give all 4 variants'
  )
  await dialog.getByLabel('Sheet', { exact: true }).selectOption('Products')
  await expect(dialog.locator('.store-import-product')).toHaveCount(8)
  expect(await values(dialog.locator('.store-import-product').first())).toEqual(
    ['225', '225', '225', '225']
  )
  expect((await state(extension)).orders).toHaveLength(0)
})
