import { workbookFile } from '../fixtures/store-workbook-fixture.mjs'
import { test, expect } from './extension-fixture.mjs'
import {
  editOrderProduct,
  closeOrderProduct,
} from './smart-workspace-helpers.mjs'

function plateWorkbook() {
  const rows = [
    ['pic', 'desc', 'boxes', 'perbox', 'price', 'amount', 'group', 'var'],
  ]
  const perbox = [12, 14, 16, 18, 20, 22],
    prices = [1, 2, 3, 4, 5, 6]
  let total = 0
  for (let index = 0; index < 6; index++) {
    const amount = 2 * perbox[index] * prices[index]
    total += amount
    rows.push([
      '',
      `Synthetic ${[6, 7, 8, 9, 10, 10][index]}寸 plate ${index + 1}`,
      2,
      perbox[index],
      prices[index],
      amount,
      5,
      'abcdef'[index],
    ])
  }
  rows.push(['', 'Synthetic unrelated cup', 1, 4, 2, 8, 6, 'a'])
  rows.push(['total', total + 8, 'total'])
  return workbookFile({
    name: '4567.xlsx',
    rows,
    photoSpans: [{ from: 1, to: 8 }],
  })
}

async function openImport(extension) {
  const page = await extension.context.newPage()
  await page.clock.setFixedTime(new Date('2026-10-21T04:00:00Z'))
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await expect(page.locator('#view-orders')).toBeEnabled()
  await page
    .getByRole('button', { name: 'Import spreadsheet', exact: true })
    .click()
  const dialog = page.locator('.store-import-dialog')
  await dialog
    .getByLabel('Workbook', { exact: true })
    .setInputFiles(plateWorkbook())
  await expect(dialog.locator('.store-import-product')).toHaveCount(7)
  await dialog.locator('input[name="purchaseDate"]').fill('2026-10-20')
  const all = dialog.locator('input[name="allReviews"]')
  if (await all.isVisible()) await all.check()
  await dialog.locator('input[name="photosReviewed"]').check()
  await dialog
    .getByRole('button', { name: 'Review products and codes', exact: true })
    .click()
  const review = dialog.locator('[data-action="store-import-code-review"]')
  await expect(review).toBeVisible()
  return { page, dialog, review }
}

async function editDetails(page, trigger, fields, { replace = false } = {}) {
  await trigger.click()
  const details = page.locator('.product-detail-dialog')
  await expect(details).toBeVisible()
  for (const [field, value] of Object.entries(fields)) {
    await details.locator(`[data-detail-select="${field}"]`).check()
    await details.locator(`[data-detail-field="${field}"]`).fill(value)
  }
  if (replace)
    await details
      .getByRole('radio', { name: 'Replace all values', exact: true })
      .check()
  await details.locator('[data-action="apply-product-details"]').click()
  await expect(details).toHaveCount(0)
}

async function backup(extension) {
  return extension.inspector.evaluate(async () =>
    (await window.testRepository).exportBackup()
  )
}

function plateGroup(backup) {
  const source = new Map(
    backup.orders[0].snapshot.items.map((item) => [item.entryId, item])
  )
  return backup.preparations[0].groups.find((group) =>
    group.variants.some((variant) =>
      variant.entryIds.some((id) => source.get(id).sourceGroup === '5')
    )
  )
}

async function commit(dialog) {
  const save = dialog.getByRole('button', {
    name: 'Import and assign codes',
    exact: true,
  })
  await expect(save).toBeEnabled()
  await save.click()
  await expect(dialog).toHaveCount(0)
}

async function expectValues(locator, expected) {
  await expect
    .poll(() => locator.evaluateAll((nodes) => nodes.map((node) => node.value)))
    .toEqual(expected)
}

test('real spreadsheet review respects declared endings and retains order/group/variant details across Back, reset, commit and backup reopening', async ({
  extension,
}) => {
  const { page, dialog, review } = await openImport(extension)
  const group = review.locator('[data-source-group="5"]')
  await expectValues(group.locator('[data-code-field="variantSuffix"]'), [
    'A',
    'B',
    'C',
    'D',
    'E',
    'F',
  ])
  await expectValues(group.locator('[data-code-field="sizeSuffix"]'), [
    '',
    '',
    '',
    '',
    '',
    '',
  ])
  await expect(group).toContainText('None declared')
  await editDetails(
    page,
    review.locator('[data-action="edit-order-details"]'),
    { spanishName: 'Compra comun', category: '器皿', material: 'Glass' }
  )
  await editDetails(
    page,
    group.locator('[data-action="edit-group-details"]'),
    {
      spanishName: 'Platos del grupo',
      category: '餐盘',
      material: 'Porcelain',
    },
    { replace: true }
  )
  await editDetails(
    page,
    group.locator('[data-action="edit-variant-details"]').first(),
    { spanishName: 'Plato especial', material: 'Glass' }
  )
  await expect(group).toContainText('PLATO ESPECIAL')
  await expect(group).toContainText('Mixed materials')
  await dialog.locator('[data-action="back-import-workbook"]').click()
  await dialog
    .getByRole('button', { name: 'Review products and codes', exact: true })
    .click()
  await expect(group).toContainText('PLATO ESPECIAL')
  await dialog.locator('[data-action="reset-import-codes"]').click()
  await expect(
    dialog.getByRole('button', { name: 'Import and assign codes', exact: true })
  ).toBeEnabled()
  await expect(group).toContainText('PLATO ESPECIAL')
  await expectValues(group.locator('[data-code-field="sizeSuffix"]'), [
    '',
    '',
    '',
    '',
    '',
    '',
  ])
  await commit(dialog)
  const saved = await backup(extension),
    prepared = plateGroup(saved)
  expect(saved.orders).toHaveLength(1)
  expect(saved.orders[0].snapshot.items).toHaveLength(7)
  expect(saved.orders[0].snapshot.totals.payable).toBe('792.00')
  expect(prepared.spanishName).toBe('PLATOS DEL GRUPO')
  expect(prepared.category).toBe('餐盘')
  expect(prepared.variants.map((variant) => variant.material)).toEqual([
    'Glass',
    'Porcelain',
    'Porcelain',
    'Porcelain',
    'Porcelain',
    'Porcelain',
  ])
  expect(prepared.variants[0].spanishName).toBe('PLATO ESPECIAL')
  expect(
    prepared.variants
      .slice(1)
      .every((variant) => variant.spanishName === undefined)
  ).toBe(true)
  const other = saved.preparations[0].groups.find(
    (group) => group.id !== prepared.id
  )
  expect(other.spanishName).toBe('COMPRA COMUN')
  expect(other.category).toBe('器皿')
  expect(other.variants[0].material).toBe('Glass')
  await page.reload()
  await expect(page.locator('#sheet-body')).toContainText('PLATO ESPECIAL')
  const probe = await extension.context.newPage()
  await probe.goto(`${extension.origin}/unsupported`)
  const roundtrip = await probe.evaluate(async (saved) => {
    const { openDatabase, validateBackup } = await import('/src/database.js')
    const name = `synthetic-product-details-${crypto.randomUUID()}`
    let repository = await openDatabase({ name })
    await repository.restoreBackup(saved)
    repository.close()
    repository = await openDatabase({ name })
    const result = await repository.exportBackup()
    validateBackup(result)
    repository.close()
    return result
  }, saved)
  expect(roundtrip.preparations).toEqual(saved.preparations)
  expect(roundtrip.orders).toEqual(saved.orders)
  expect(roundtrip.cartonBatches).toEqual(saved.cartonBatches)
  expect(roundtrip.images).toEqual(saved.images)
})

test('saved Orders bulk details form one Undo/Redo step and reject a concurrently changed preparation without partial details', async ({
  extension,
}) => {
  const { page, dialog } = await openImport(extension)
  await commit(dialog)
  const before = await backup(extension)
  const action = page.locator(
    '#sheet-body .order-section-heading [data-action="edit-order-details"]'
  )
  await editDetails(page, action, {
    spanishName: 'Saved purchase',
    category: '餐具',
    material: 'Ceramic',
  })
  const saved = await backup(extension)
  expect(
    saved.preparations[0].groups.every(
      (group) =>
        group.spanishName === 'SAVED PURCHASE' && group.category === '餐具'
    )
  ).toBe(true)
  await expect(page.locator('#undo-order-products')).toBeEnabled()
  await page.locator('#undo-order-products').click()
  await expect(page.locator('#redo-order-products')).toBeEnabled()
  const undone = await backup(extension)
  expect(
    undone.preparations[0].groups.map((group) => [
      group.spanishName,
      group.category,
    ])
  ).toEqual(
    before.preparations[0].groups.map((group) => [
      group.spanishName,
      group.category,
    ])
  )
  await page.locator('#redo-order-products').click()
  const redone = await backup(extension)
  expect(
    redone.preparations[0].groups.map((group) => [
      group.spanishName,
      group.category,
    ])
  ).toEqual(
    saved.preparations[0].groups.map((group) => [
      group.spanishName,
      group.category,
    ])
  )
  await action.click()
  const details = page.locator('.product-detail-dialog')
  await details.locator('[data-detail-select="material"]').check()
  await details
    .locator('[data-detail-field="material"]')
    .fill('Concurrent draft material')
  await details
    .getByRole('radio', { name: 'Replace all values', exact: true })
    .check()
  await extension.inspector.evaluate(async () => {
    const repository = await window.testRepository
    const [order] = await repository.listOrders()
    const prepared = await repository.getPreparation(order.snapshot.orderId)
    prepared.groups[1].category = '另一个标签页'
    await repository.savePreparation(prepared)
  })
  const concurrent = await backup(extension)
  await details.locator('[data-action="apply-product-details"]').click()
  await expect(details).toBeVisible()
  await expect(
    details.locator('[data-action="apply-product-details"]')
  ).toBeEnabled()
  await expect(details.locator('[data-detail-field="material"]')).toHaveValue(
    'Concurrent draft material'
  )
  expect((await backup(extension)).preparations).toEqual(
    concurrent.preparations
  )
  await details.locator('[data-action="cancel-product-details"]').click()
})

test('the existing size-handling review repairs six saved extra endings without recreating purchase or carton evidence', async ({
  extension,
}) => {
  const { page, dialog } = await openImport(extension)
  await commit(dialog)
  await extension.inspector.evaluate(async () => {
    const repository = await window.testRepository
    const [order] = await repository.listOrders()
    const prepared = await repository.getPreparation(order.snapshot.orderId)
    const entryIds = new Set(
      order.snapshot.items
        .filter((item) => item.sourceGroup === '5')
        .map((item) => item.entryId)
    )
    const group = prepared.groups.find((group) =>
      group.variants.some((variant) =>
        variant.entryIds.some((id) => entryIds.has(id))
      )
    )
    for (const [index, variant] of group.variants.entries())
      variant.sizeSuffix = ['XS', 'S', 'M', 'L', 'XL', 'XL'][index]
    await repository.savePreparation(prepared)
  })
  await page.reload()
  await expect(
    page.locator('#sheet-body tr[data-selection-key]').first()
  ).toBeVisible()
  const before = await backup(extension),
    old = plateGroup(before)
  let editor = await editOrderProduct(page, 0)
  await editor.locator('[data-size-mode="none"]').click()
  const review = page.getByRole('dialog', {
    name: 'Change size handling?',
    exact: true,
  })
  await expect(review).toBeVisible()
  for (const variant of old.variants) {
    await expect(review).toContainText(
      old.baseCode + variant.variantSuffix + variant.sizeSuffix
    )
    await expect(review).toContainText(old.baseCode + variant.variantSuffix)
  }
  await review
    .getByRole('button', { name: 'Apply size handling', exact: true })
    .click()
  await expect(review).toHaveCount(0)
  editor = page.locator('dialog[data-action="edit-order-product"]')
  await expect(editor).toBeVisible()
  await closeOrderProduct(editor)
  const after = await backup(extension),
    repaired = plateGroup(after)
  expect(repaired.baseCode).toBe(old.baseCode)
  expect(repaired.variants.map((variant) => variant.variantSuffix)).toEqual([
    'A',
    'B',
    'C',
    'D',
    'E',
    'F',
  ])
  expect(repaired.variants.map((variant) => variant.sizeSuffix)).toEqual([
    '',
    '',
    '',
    '',
    '',
    '',
  ])
  expect(repaired.variants.map((variant) => variant.size)).toEqual(
    old.variants.map((variant) => variant.size)
  )
  expect(after.orders).toEqual(before.orders)
  expect(after.cartonBatches).toEqual(before.cartonBatches)
  expect(after.images).toEqual(before.images)
  expect(
    after.preparations[0].groups.filter((group) => group.id !== repaired.id)
  ).toEqual(
    before.preparations[0].groups.filter((group) => group.id !== old.id)
  )
})

test('a failed Orders detail transaction rolls back preparation, carton and assignment changes while preserving the open draft', async ({
  extension,
}) => {
  const { page, dialog } = await openImport(extension)
  await commit(dialog)
  const before = await backup(extension)
  await page
    .locator(
      '#sheet-body .order-section-heading [data-action="edit-order-details"]'
    )
    .click()
  const details = page.locator('.product-detail-dialog')
  await details.locator('[data-detail-select="category"]').check()
  await details.locator('[data-detail-field="category"]').fill('事务失败')
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    window.syntheticDetailsPut = put
    IDBObjectStore.prototype.put = function (...args) {
      const result = put.apply(this, args)
      if (this.name === 'preparations')
        throw new Error('Synthetic details transaction rollback')
      return result
    }
  })
  await details.locator('[data-action="apply-product-details"]').click()
  await expect(details.getByRole('status')).toHaveText(
    'Synthetic details transaction rollback'
  )
  await expect(details.locator('[data-detail-field="category"]')).toHaveValue(
    '事务失败'
  )
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = window.syntheticDetailsPut
  })
  const after = await backup(extension)
  expect({ ...after, exportedAt: '' }).toEqual({ ...before, exportedAt: '' })
  await details.locator('[data-action="cancel-product-details"]').click()
})

test('Orders category navigation waits for the group dialog before reopening the product editor', async ({
  extension,
}) => {
  const { page, dialog } = await openImport(extension)
  await commit(dialog)
  let editor = await editOrderProduct(page, 0)
  await editor.locator('[data-action="edit-variant-details"]').click()
  const variant = page.getByRole('dialog', {
    name: 'Edit variant details',
    exact: true,
  })
  await variant.locator('[data-action="edit-shared-group-category"]').click()
  const group = page.getByRole('dialog', {
    name: 'Edit group details',
    exact: true,
  })
  await expect(group).toBeVisible()
  await expect(
    page.locator('dialog[data-action="edit-order-product"]')
  ).toHaveCount(0)
  await group.locator('[data-detail-select="category"]').check()
  await group.locator('[data-detail-field="category"]').fill('分组修订')
  await group.locator('[data-action="apply-product-details"]').click()
  await expect(group).toHaveCount(0)
  editor = page.locator('dialog[data-action="edit-order-product"]')
  await expect(editor).toBeVisible()
  await expect(
    editor.getByRole('textbox', { name: 'Chinese category', exact: true })
  ).toHaveValue('分组修订')
  await editor.locator('[data-action="edit-variant-details"]').click()
  await variant.locator('[data-action="edit-shared-group-category"]').click()
  await expect(group).toBeVisible()
  await expect(
    page.locator('dialog[data-action="edit-order-product"]')
  ).toHaveCount(0)
  await group.locator('[data-action="cancel-product-details"]').click()
  await expect(editor).toBeVisible()
  await expect(page.locator('dialog[open]')).toHaveCount(1)
  await closeOrderProduct(editor)
})

test('a source-only refresh cannot replace the detail editor’s captured source revision', async ({
  extension,
}) => {
  const { page, dialog } = await openImport(extension)
  await commit(dialog)
  const before = await backup(extension)
  await page
    .locator(
      '#sheet-body .order-section-heading [data-action="edit-order-details"]'
    )
    .click()
  const details = page.locator('.product-detail-dialog')
  await details.locator('[data-detail-select="category"]').check()
  await details.locator('[data-detail-field="category"]').fill('保留中的编辑')
  await extension.inspector.evaluate(async () => {
    const repository = await window.testRepository
    const [order] = await repository.listOrders()
    await repository.saveSnapshot({
      ...order.snapshot,
      observedAt: '2026-10-22T04:00:00.000Z',
      status: 'Synthetic source-only refresh',
    })
  })
  await expect(
    page.locator('#sheet-body .order-section-heading .order-status')
  ).toHaveAttribute('title', 'Synthetic source-only refresh')
  const refreshed = await backup(extension)
  expect(refreshed.preparations).toEqual(before.preparations)
  await details.locator('[data-action="apply-product-details"]').click()
  await expect(details.getByRole('status')).toHaveAttribute(
    'data-error',
    'true'
  )
  await expect(details.locator('[data-detail-field="category"]')).toHaveValue(
    '保留中的编辑'
  )
  await expect(
    details.locator('[data-action="apply-product-details"]')
  ).toBeEnabled()
  const after = await backup(extension)
  expect(after.preparations).toEqual(refreshed.preparations)
  expect(after.orders).toEqual(refreshed.orders)
  expect(after.cartonBatches).toEqual(refreshed.cartonBatches)
  expect(after.issuedCodes).toEqual(refreshed.issuedCodes)
  await details.locator('[data-action="cancel-product-details"]').click()
})

test('description size suggestions require review and Reset returns to declared endings without discarding details', async ({
  extension,
}) => {
  const { page, dialog, review } = await openImport(extension)
  const group = review.locator('[data-source-group="5"]')
  await editDetails(page, group.locator('[data-action="edit-group-details"]'), {
    spanishName: 'Platos revisados',
    material: 'Ceramic',
  })
  const suggestion = group.locator(
    '[data-action="suggest-import-size-endings"]'
  )
  await suggestion.click()
  const comparison = page.getByRole('dialog', {
    name: 'Change size handling?',
    exact: true,
  })
  await expect(comparison).toBeVisible()
  await comparison.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expectValues(group.locator('[data-code-field="sizeSuffix"]'), [
    '',
    '',
    '',
    '',
    '',
    '',
  ])
  await suggestion.click()
  await comparison
    .getByRole('button', { name: 'Apply size handling', exact: true })
    .click()
  await expect(comparison).toHaveCount(0)
  await expectValues(group.locator('[data-code-field="sizeSuffix"]'), [
    'XS',
    'S',
    'M',
    'L',
    'XL',
    'XL',
  ])
  await expect(group.locator('[data-ending-origin]')).toHaveText(
    Array(6).fill('Custom code endings differ from the workbook declaration.')
  )
  await dialog.locator('[data-action="reset-import-codes"]').click()
  await expectValues(group.locator('[data-code-field="sizeSuffix"]'), [
    '',
    '',
    '',
    '',
    '',
    '',
  ])
  await expectValues(group.locator('[data-code-field="variantSuffix"]'), [
    'A',
    'B',
    'C',
    'D',
    'E',
    'F',
  ])
  await expect(group).toContainText('PLATOS REVISADOS')
  await expect(group).toContainText('Ceramic')
  expect((await backup(extension)).orders).toEqual([])
})
