import { test, expect } from './extension-fixture.mjs'
import { createDemoRecords } from '../../preview/library-fixture.js'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import {
  seedSmartOrder,
  openSmartLibrary,
  libraryBackup,
  revealOrderCard,
} from './smart-workspace-helpers.mjs'

const first = '100000000000000001',
  second = '100000000000000002'
const entries = (preparation) =>
  preparation.groups.flatMap((group) =>
    group.variants.flatMap((variant) => variant.entryIds)
  )
const panel = (page) => page.locator('[data-action="purchase-code-review"]')
const commit = (review) =>
  review.locator('[data-action="assign-purchase-codes"]')
const sourceRows = (page) => page.locator('#sheet-body tr[data-selection-key]')
async function openSelection(page) {
  await page.locator('#review-purchase-codes').click()
  const review = panel(page)
  await expect(review).toHaveAttribute('aria-busy', 'false')
  return review
}
function unchanged(after, before) {
  for (const key of [
    'orders',
    'preparations',
    'allocations',
    'issuedCodes',
    'cartonBatches',
  ])
    expect(after[key]).toEqual(before[key])
}

test('selected subset alone is reviewed without another selection UI and one confirmation assigns it', async ({
  extension,
}) => {
  await seedSmartOrder(extension, { count: 17, assignCodes: false })
  const page = await openSmartLibrary(extension),
    rows = sourceRows(page)
  await rows.nth(0).getByRole('checkbox').check()
  await rows.nth(1).getByRole('checkbox').check()
  const before = await libraryBackup(extension),
    review = await openSelection(page)
  await expect(review).toHaveAttribute('data-scope', 'selected-products')
  await expect(review.locator('article')).toHaveCount(2)
  await expect(review.getByRole('checkbox')).toHaveCount(0)
  await expect(
    review.locator(
      '[data-action="select-all-code-products"], [data-action="clear-code-products"]'
    )
  ).toHaveCount(0)
  await expect(review.locator('.purchase-code-review-items')).toHaveAttribute(
    'data-row-count',
    '2'
  )
  const reviewed = await review.locator('.purchase-code').allTextContents()
  expect(reviewed.every((code) => /^CE2609[0-9]{4}[A-Z0-9]*$/.test(code))).toBe(
    true
  )
  unchanged(await libraryBackup(extension), before)
  await commit(review).click()
  await expect(review).toBeHidden()
  const after = await libraryBackup(extension)
  expect(entries(after.preparations[0]).sort()).toEqual(['2001', '2002'])
  expect(after.orders).toEqual(before.orders)
  await page.reload()
  await expect(sourceRows(page)).toHaveCount(17)
  const reopened = await libraryBackup(extension)
  expect(reopened.preparations).toEqual(after.preparations)
})

test('Back and Cancel preserve Orders selection and reserve nothing; an unrelated missing supplier is ignored', async ({
  extension,
}) => {
  await seedSmartOrder(extension, {
    count: 3,
    orderId: first,
    assignCodes: false,
  })
  await seedSmartOrder(extension, {
    count: 3,
    orderId: second,
    assignCodes: false,
  })
  await extension.inspector.evaluate(async (orderId) => {
    const repository = await window.testRepository,
      record = await repository.getOrder(orderId)
    await repository.saveSnapshot({
      ...record.snapshot,
      sellerUnavailable: true,
      sellerName: 'Seller unavailable',
      sellerMemberLogin: '',
      observedAt: new Date().toISOString(),
    })
  }, second)
  const page = await openSmartLibrary(extension)
  const rows = page.locator(`#sheet-body tr[data-selection-key*="${first}"]`)
  await rows.first().getByRole('checkbox').check()
  const before = await libraryBackup(extension)
  for (const name of ['Back', 'Cancel']) {
    const review = await openSelection(page)
    await expect(review.locator('article')).toHaveCount(1)
    await expect(commit(review)).toBeEnabled()
    await review.getByRole('button', { name, exact: true }).click()
    await expect(review).toBeHidden()
    await expect(rows.first().getByRole('checkbox')).toBeChecked()
    await expect(page.locator('#review-purchase-codes')).toBeFocused()
    unchanged(await libraryBackup(extension), before)
  }
})

test('Back preserves the same-selection draft and its original source guard while Cancel discards it', async ({
  extension,
}) => {
  await seedSmartOrder(extension, { count: 2, assignCodes: false })
  const page = await openSmartLibrary(extension)
  await page.locator('#select-rows').click()
  const before = await libraryBackup(extension)
  let review = await openSelection(page)
  await editPreparedDetails(
    review,
    page,
    { spanishName: 'BACK DRAFT', material: '' },
    { replace: true }
  )
  const base = review.locator('[data-review-code="baseCode"]').first()
  await base.fill('CE26090109')
  await base.blur()
  await expect(commit(review)).toBeEnabled()
  const codes = await review.locator('.purchase-code').allTextContents()
  await review.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(review).toBeHidden()
  unchanged(await libraryBackup(extension), before)
  review = await openSelection(page)
  await expect(commit(review)).toBeEnabled()
  expect(await review.locator('.purchase-code').allTextContents()).toEqual(
    codes
  )
  await expect(
    review.locator('[data-detail-comparison="spanishName"] strong')
  ).toHaveText(['BACK DRAFT', 'BACK DRAFT'])
  await expect(
    review.locator('[data-detail-comparison="material"] strong')
  ).toHaveText(['—', '—'])
  await review.getByRole('button', { name: 'Back', exact: true }).click()
  await extension.inspector.evaluate(async (orderId) => {
    const repository = await window.testRepository,
      record = await repository.getOrder(orderId)
    await repository.saveSnapshot({
      ...record.snapshot,
      status: 'Synthetic changed source',
      observedAt: new Date().toISOString(),
    })
  }, first)
  const changed = await libraryBackup(extension)
  review = await openSelection(page)
  await expect(commit(review)).toBeDisabled()
  await expect(review.getByRole('status')).toContainText('Close this review')
  expect(await review.locator('.purchase-code').allTextContents()).toEqual(
    codes
  )
  await expect(
    review.locator('[data-detail-comparison="spanishName"] strong')
  ).toHaveText(['BACK DRAFT', 'BACK DRAFT'])
  unchanged(await libraryBackup(extension), changed)
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  review = await openSelection(page)
  await expect(commit(review)).toBeEnabled()
  await expect(
    review
      .locator('[data-detail-comparison="spanishName"] strong')
      .filter({ hasText: 'BACK DRAFT' })
  ).toHaveCount(0)
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  unchanged(await libraryBackup(extension), changed)
})

test('order selection and empty product selection never expand scope', async ({
  extension,
}) => {
  const ref = await seedSmartOrder(extension, { count: 3, assignCodes: false })
  const page = await openSmartLibrary(extension)
  const card = await revealOrderCard(page, ref)
  await card.getByRole('checkbox').check()
  await expect(page.locator('#review-purchase-codes')).toBeDisabled()
  await page
    .locator('#review-purchase-codes')
    .evaluate((button) => button.click())
  await expect(panel(page)).toHaveCount(0)
  expect((await libraryBackup(extension)).preparations).toEqual([])
})

test('selected products across orders are grouped and already assigned codes remain unchanged', async ({
  extension,
}) => {
  await seedSmartOrder(extension, {
    count: 3,
    orderId: first,
    assignCodes: true,
  })
  await seedSmartOrder(extension, {
    count: 3,
    orderId: second,
    assignCodes: false,
    supplierId: 'other-synthetic-shop',
  })
  const page = await openSmartLibrary(extension)
  for (const orderId of [first, second])
    await page
      .locator(`#sheet-body tr[data-selection-key*="${orderId}"]`)
      .first()
      .getByRole('checkbox')
      .check()
  const before = await libraryBackup(extension),
    review = await openSelection(page)
  await expect(review.locator('[data-order-review]')).toHaveCount(2)
  await expect(review.locator('article')).toHaveCount(2)
  await expect(
    review.getByText('Already assigned — unchanged', { exact: true })
  ).toHaveCount(1)
  await expect(review.getByText('New assignment', { exact: true })).toHaveCount(
    1
  )
  await expect(
    review.locator('[data-action="review-product-families"]')
  ).toHaveCount(0)
  await expect(
    review.getByText('Existing prepared family', { exact: true })
  ).toBeVisible()
  await commit(review).click()
  await expect(review).toBeHidden()
  const after = await libraryBackup(extension)
  // Confirmation advances the selected purchase's save clock; its complete
  // assignment and authored values must remain unchanged.
  const {
      revision: savedRevision,
      updatedAt: savedAt,
      ...savedValues
    } = after.preparations.find((p) => p.orderId === first),
    {
      revision: priorRevision,
      updatedAt: priorAt,
      ...priorValues
    } = before.preparations.find((p) => p.orderId === first)
  expect(savedValues).toEqual(priorValues)
  expect(savedRevision).toBeGreaterThanOrEqual(priorRevision)
  expect(Date.parse(savedAt)).toBeGreaterThanOrEqual(Date.parse(priorAt))
  expect(entries(after.preparations.find((p) => p.orderId === second))).toEqual(
    ['2001']
  )
})

test('complete source groups determine numbering for a selected later sibling and later assignment reuses its base', async ({
  extension,
}) => {
  await seedSmartOrder(extension, { count: 3, assignCodes: false })
  await extension.inspector.evaluate(async (orderId) => {
    const repository = await window.testRepository,
      record = await repository.getOrder(orderId),
      snapshot = structuredClone(record.snapshot)
    for (const [index, item] of snapshot.items.entries()) {
      const cup = index !== 1
      item.title = cup ? 'Synthetic cup' : 'Synthetic lamp'
      item.productNumber = cup ? 'SYNTHETIC-CUP' : 'SYNTHETIC-LAMP'
      item.description = `${item.title} ${index === 0 ? 'red' : index === 2 ? 'blue' : ''}`
      item.skuProperties = cup
        ? [{ label: 'Color', value: index === 0 ? 'Red' : 'Blue' }]
        : []
    }
    snapshot.observedAt = '2026-10-26T12:00:00.000Z'
    await repository.saveSnapshot(snapshot)
  }, first)
  const page = await openSmartLibrary(extension),
    rows = sourceRows(page)
  await rows.nth(1).getByRole('checkbox').check()
  await rows.nth(2).getByRole('checkbox').check()
  const before = await libraryBackup(extension)
  let review = await openSelection(page)
  await expect(
    review.locator('article[data-entry-id="2002"] .purchase-code')
  ).toHaveText('CE26090102')
  await expect(
    review.locator('article[data-entry-id="2003"] .purchase-code')
  ).toHaveText('CE26090101B')
  await commit(review).click()
  await expect(review).toBeHidden()
  const partial = await libraryBackup(extension),
    cup = partial.preparations[0].groups.find((group) =>
      group.variants.some((variant) => variant.entryIds.includes('2003'))
    )
  expect(entries(partial.preparations[0]).sort()).toEqual(['2002', '2003'])
  await page.locator('#clear-rows').click()
  await rows
    .filter({ hasText: 'Synthetic cup red' })
    .getByRole('checkbox')
    .check()
  review = await openSelection(page)
  await expect(review.locator('article .purchase-code')).toHaveText(
    'CE26090101A'
  )
  await commit(review).click()
  await expect(review).toBeHidden()
  const after = await libraryBackup(extension),
    finalCup = after.preparations[0].groups.find((group) => group.id === cup.id)
  expect(finalCup.baseCode).toBe(cup.baseCode)
  expect(
    finalCup.variants.flatMap((variant) => variant.entryIds).sort()
  ).toEqual(['2001', '2003'])
  expect(after.orders).toEqual(before.orders)
  expect(after.cartonBatches).toEqual(before.cartonBatches)
})

test('large selected reviews stay bounded and retain every selected row for assignment', async ({
  extension,
}) => {
  await seedSmartOrder(extension, { count: 150, assignCodes: false })
  const page = await openSmartLibrary(extension)
  await page.locator('#select-rows').click()
  const review = await openSelection(page),
    scroller = review.locator('.purchase-code-review-items')
  await expect(scroller).toHaveAttribute('data-row-count', '150')
  expect(await review.locator('article').count()).toBeLessThan(150)
  await scroller.evaluate((node) => {
    node.scrollTop = node.scrollHeight
  })
  await expect(review.locator('article[data-entry-id="2150"]')).toBeVisible()
  await commit(review).click()
  await expect(review).toBeHidden()
  expect(
    entries((await libraryBackup(extension)).preparations[0])
  ).toHaveLength(150)
})

test('same-title horse and elephants share one automatic family despite different article stems', async ({
  extension,
}) => {
  await seedSmartOrder(extension, { count: 3, assignCodes: false })
  await extension.inspector.evaluate(async (orderId) => {
    const repository = await window.testRepository,
      record = await repository.getOrder(orderId),
      snapshot = structuredClone(record.snapshot)
    for (const [index, item] of snapshot.items.entries()) {
      item.title = '合成树脂家居工艺品'
      item.productNumber = ['7128F-02', '7128K-01', '7128K-02'][index]
      item.skuProperties = [
        {
          label: '颜色',
          value: ['大号—吻情深-金色', '招财母子象', '招财大象'][index],
        },
        { label: '尺寸', value: '如图所示' },
      ]
      item.description = `${item.title}\n${item.skuProperties.map((property) => `${property.label}：${property.value}`).join('\n')}`
    }
    snapshot.observedAt = '2026-10-26T12:00:00.000Z'
    await repository.saveSnapshot(snapshot)
  }, first)
  const page = await openSmartLibrary(extension)
  await page.locator('#select-rows').click()
  const before = await libraryBackup(extension),
    review = await openSelection(page)
  await expect(review.locator('[data-product-family]')).toHaveCount(1)
  await expect(
    review.locator('article[data-entry-id="2001"] .purchase-code')
  ).toHaveText('CE26090101A')
  await expect(
    review.locator('article[data-entry-id="2002"] .purchase-code')
  ).toHaveText('CE26090101B')
  await expect(
    review.locator('article[data-entry-id="2003"] .purchase-code')
  ).toHaveText('CE26090101C')
  await expect(
    review.locator('[data-action="resolve-code-sizes"]')
  ).toBeHidden()
  unchanged(await libraryBackup(extension), before)
  await commit(review).click()
  await expect(review).toBeHidden()
  const after = await libraryBackup(extension)
  expect(after.orders).toEqual(before.orders)
  expect(after.cartonBatches).toEqual(before.cartonBatches)
  expect(
    after.preparations[0].groups.map((group) =>
      group.variants.map(
        (variant) =>
          `${group.baseCode}${variant.variantSuffix}${variant.sizeSuffix}`
      )
    )
  ).toEqual([['CE26090101A', 'CE26090101B', 'CE26090101C']])
})

test('numeric cylinder articles prepare by title with available order and group editors', async ({
  extension,
}) => {
  await seedSmartOrder(extension, { count: 6, assignCodes: false })
  await extension.inspector.evaluate(async (orderId) => {
    const repository = await window.testRepository,
      record = await repository.getOrder(orderId),
      snapshot = structuredClone(record.snapshot),
      articles = ['1520', '1230', '1540', '1515', '1525', '1530'],
      dimensions = [
        '口径15 高20cm【防摔直筒】',
        '口径12 高30cm【防摔直筒】',
        '口径15高40cm【防摔直筒】',
        '口径15高15cm【防摔直筒】',
        '口径15高25cm【防摔直筒】',
        '口径15高30cm【防摔直筒】',
      ]
    for (const [index, item] of snapshot.items.entries()) {
      item.title = 'Synthetic transparent cylinder family'
      item.productNumber = articles[index]
      item.skuProperties = [{ label: '尺寸', value: dimensions[index] }]
      item.description = item.title + '\n尺寸：' + dimensions[index]
    }
    snapshot.observedAt = new Date().toISOString()
    await repository.saveSnapshot(snapshot)
  }, first)
  const page = await openSmartLibrary(extension)
  await page.locator('#select-rows').click()
  const before = await libraryBackup(extension),
    review = await openSelection(page)
  await expect(review.locator('[data-product-family]')).toHaveCount(1)
  await expect(review.locator('.purchase-code')).toHaveText(
    ['A', 'B', 'C', 'D', 'E', 'F'].map((ending) => 'CE26090101' + ending)
  )
  await expect(
    review.locator('[data-review-details="edit-order-details"]')
  ).toBeEnabled()
  await expect(
    review.locator('[data-review-details="edit-group-details"]')
  ).toBeEnabled()
  await expect(
    review.locator('[data-action="review-product-families"]')
  ).toHaveCount(0)
  await expect(review.locator('[data-family-size-fallback]')).toHaveCount(1)
  await editPreparedDetails(
    review,
    page,
    { spanishName: 'CILINDRO CONFIRMADO' },
    { scope: 'group' }
  )
  await expect(
    review.locator('[data-detail-comparison="spanishName"] strong')
  ).toHaveText(Array(6).fill('CILINDRO CONFIRMADO'))
  unchanged(await libraryBackup(extension), before)
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  unchanged(await libraryBackup(extension), before)
})

test('a concurrent claim rolls back all selected assignments and retains a review requiring confirmation again', async ({
  extension,
}) => {
  await seedSmartOrder(extension, {
    count: 3,
    orderId: first,
    assignCodes: false,
  })
  const page = await openSmartLibrary(extension)
  await page.locator('#select-rows').click()
  const review = await openSelection(page)
  await seedSmartOrder(extension, {
    count: 1,
    orderId: second,
    assignCodes: true,
  })
  const claimed = await libraryBackup(extension)
  await commit(review).click()
  await expect(review).toBeVisible()
  await expect(review).toHaveAttribute('aria-busy', 'false')
  await expect(review.getByRole('status')).toContainText(
    'confirm again to retry'
  )
  await expect(review.locator('article')).toHaveCount(3)
  unchanged(await libraryBackup(extension), claimed)
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('ambiguous source sizes receive variant letters and keep editable codes and authored details across retries', async ({
  extension,
}) => {
  await seedSmartOrder(extension, {
    count: 2,
    orderId: first,
    assignCodes: false,
  })
  await extension.inspector.evaluate(async (orderId) => {
    const repository = await window.testRepository,
      record = await repository.getOrder(orderId)
    const snapshot = structuredClone(record.snapshot)
    for (const [index, item] of snapshot.items.entries()) {
      const size = index === 0 ? '300ml/500ml' : '700ml/900ml'
      item.title = 'Synthetic ambiguous-size cup'
      item.productNumber = 'SYN-AMBIGUOUS'
      item.skuProperties = [
        { label: '颜色', value: '红色' },
        { label: '尺寸', value: size },
      ]
      item.description = `Synthetic ambiguous-size cup\n颜色：红色\n尺寸：${size}`
    }
    snapshot.observedAt = new Date().toISOString()
    await repository.saveSnapshot(snapshot)
  }, first)
  const page = await openSmartLibrary(extension)
  await page.locator('#select-rows').click()
  const before = await libraryBackup(extension),
    review = await openSelection(page)
  await expect(commit(review)).toBeEnabled()
  await expect(review.locator('.purchase-code')).toHaveText([
    'CE26090101A',
    'CE26090101B',
  ])
  await expect(review.locator('[data-family-size-fallback]')).toHaveCount(1)
  await expect(
    review.locator('[data-action="resolve-code-sizes"]')
  ).toBeHidden()
  await editPreparedDetails(review, page, {
    spanishName: 'SIZE DRAFT NAME',
    category: '尺寸草稿',
  })
  const ending = review.locator('[data-review-code="variantSuffix"]').first()
  await ending.fill('%')
  await ending.blur()
  await expect(commit(review)).toBeDisabled()
  await expect(ending).toHaveAttribute('aria-invalid', 'true')
  await ending.fill('B')
  await ending.blur()
  await expect(commit(review)).toBeDisabled()
  await ending.fill('X')
  await ending.blur()
  await expect(commit(review)).toBeEnabled()
  await expect(review.locator('.purchase-code')).toHaveText([
    'CE26090101X',
    'CE26090101B',
  ])
  await review
    .locator('[data-action="reset-preparation-code-suggestions"]')
    .click()
  await expect(commit(review)).toBeEnabled()
  await expect(review.locator('.purchase-code')).toHaveText([
    'CE26090101A',
    'CE26090101B',
  ])
  unchanged(await libraryBackup(extension), before)
  await seedSmartOrder(extension, {
    count: 1,
    orderId: second,
    assignCodes: true,
  })
  const claimed = await libraryBackup(extension)
  await commit(review).click()
  await expect(review).toBeVisible()
  await expect(review).toHaveAttribute('aria-busy', 'false')
  await expect(review.getByRole('status')).toContainText(
    'confirm again to retry'
  )
  await expect(commit(review)).toBeEnabled()
  unchanged(await libraryBackup(extension), claimed)
  await expect(
    review.locator('[data-detail-comparison="spanishName"] strong').first()
  ).toHaveText('SIZE DRAFT NAME')
  const retryCodes = await review.locator('.purchase-code').allTextContents()
  expect(retryCodes.map((code) => code.slice(-1))).toEqual(['A', 'B'])
  await commit(review).click()
  await expect(review).toBeHidden()
  const saved = await libraryBackup(extension),
    preparation = saved.preparations.find((value) => value.orderId === first)
  expect(
    preparation.groups[0].variants.map((variant) => variant.sizeSuffix).sort()
  ).toEqual(['', ''])
  expect(
    preparation.groups[0].variants.every((variant) => !variant.needsSizeMapping)
  ).toBe(true)
  await page.reload()
  expect((await libraryBackup(extension)).preparations).toEqual(
    saved.preparations
  )
})

test('a source change rejects confirmation and keeps old evidence blocked until the review is reopened', async ({
  extension,
}) => {
  await seedSmartOrder(extension, {
    count: 2,
    orderId: first,
    assignCodes: false,
  })
  const page = await openSmartLibrary(extension)
  await page.locator('#select-rows').click()
  const review = await openSelection(page),
    codes = await review.locator('.purchase-code').allTextContents()
  await extension.inspector.evaluate(async (orderId) => {
    const repository = await window.testRepository,
      record = await repository.getOrder(orderId),
      snapshot = structuredClone(record.snapshot)
    snapshot.items[0].description = 'Changed source evidence after code review'
    snapshot.observedAt = new Date().toISOString()
    await repository.saveSnapshot(snapshot)
  }, first)
  const changed = await libraryBackup(extension)
  await commit(review).click()
  await expect(review).toHaveAttribute('aria-busy', 'false')
  await expect(commit(review)).toBeDisabled()
  await expect(review.getByRole('status')).toContainText('Close this review')
  expect(await review.locator('.purchase-code').allTextContents()).toEqual(
    codes
  )
  unchanged(await libraryBackup(extension), changed)
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
})

async function editPreparedDetails(
  review,
  page,
  fields,
  { replace = false, scope = 'order', index = 0, expectApplied = true } = {}
) {
  const opener = review
    .locator(`[data-review-details="edit-${scope}-details"]`)
    .nth(index)
  await opener.click()
  const editor = page.locator('.product-detail-dialog')
  for (const [field, value] of Object.entries(fields)) {
    await editor.locator(`[data-detail-select="${field}"]`).check()
    await editor.locator(`[data-detail-field="${field}"]`).fill(value)
  }
  if (replace)
    await editor.locator('input[name="custom-values"][value="replace"]').check()
  await editor.locator('[data-action="apply-product-details"]').click()
  if (expectApplied) {
    // Click completion does not await the asynchronous draft preview. An open
    // child modal makes the parent inert even though fill() can return there.
    await expect(editor).toBeHidden()
    await expect(review).toHaveAttribute('aria-busy', 'false')
    await expect(opener).toBeEnabled()
  }
  return editor
}

test('automatic title families and code edits remain unsaved and reset without losing details', async ({
  extension,
}) => {
  await seedSmartOrder(extension, {
    count: 3,
    orderId: first,
    assignCodes: false,
  })
  await extension.inspector.evaluate(async (orderId) => {
    const repository = await window.testRepository,
      record = await repository.getOrder(orderId),
      snapshot = structuredClone(record.snapshot)
    const articles = ['HAT01401', 'HAT01403', 'HAT01402'],
      values = ['红色（短）', '红色（长）', '粉色（短）']
    for (const [index, item] of snapshot.items.entries()) {
      item.title = 'Synthetic festive hat family'
      item.description = `${item.title}\n颜色：${values[index]}`
      item.productNumber = articles[index]
      item.skuProperties = [{ label: '颜色', value: values[index] }]
    }
    snapshot.observedAt = '2026-10-26T13:00:00.000Z'
    await repository.saveSnapshot(snapshot)
  }, first)
  const page = await openSmartLibrary(extension)
  await page.locator('#select-rows').click()
  const before = await libraryBackup(extension),
    review = await openSelection(page)
  await expect(review.locator('.purchase-code')).toHaveText([
    'CE26090101AS',
    'CE26090101AL',
    'CE26090101BS',
  ])
  await expect(review).toContainText('Coding mode: Variants and sizes')
  await expect(
    review.locator('[data-action="review-product-families"]')
  ).toHaveCount(0)
  await expect(review.locator('[data-product-family]')).toHaveCount(1)
  await expect(review).toContainText('Grouped by source title')
  await editPreparedDetails(review, page, {
    spanishName: 'NOMBRE CONFIRMADO',
    material: 'Metal',
  })
  const base = review.locator('[data-review-code="baseCode"]').first()
  await base.fill('CE')
  await expect(base).not.toHaveAttribute('aria-invalid', 'true')
  await expect(commit(review)).toBeDisabled()
  await base.fill('CE26090109')
  await base.blur()
  await expect(commit(review)).toBeEnabled()
  await expect(review.locator('.purchase-code')).toHaveText([
    'CE26090109AS',
    'CE26090109AL',
    'CE26090109BS',
  ])
  await review
    .locator('[data-action="reset-preparation-code-suggestions"]')
    .click()
  await expect(commit(review)).toBeEnabled()
  await expect(review.locator('.purchase-code')).toHaveText([
    'CE26090101AS',
    'CE26090101AL',
    'CE26090101BS',
  ])
  await expect(
    review.locator('[data-detail-comparison="spanishName"] strong')
  ).toHaveText(['NOMBRE CONFIRMADO', 'NOMBRE CONFIRMADO', 'NOMBRE CONFIRMADO'])
  unchanged(await libraryBackup(extension), before)
  await commit(review).click()
  await expect(review).toBeHidden()
  const after = await libraryBackup(extension)
  expect(after.preparations[0].groups).toHaveLength(1)
  expect(after.preparations[0].productFamilies.version).toBe(2)
  expect(after.orders).toEqual(before.orders)
  expect(after.cartonBatches).toEqual(before.cartonBatches)
  await page.reload()
  expect((await libraryBackup(extension)).preparations).toEqual(
    after.preparations
  )
})

test('Prepare products automatically groups title-only families and commits only selected details with their codes', async ({
  extension,
}) => {
  await seedSmartOrder(extension, {
    count: 3,
    orderId: first,
    assignCodes: false,
  })
  await extension.inspector.evaluate(async (orderId) => {
    const repository = await window.testRepository,
      record = await repository.getOrder(orderId),
      snapshot = structuredClone(record.snapshot)
    for (const [index, item] of snapshot.items.entries()) {
      item.title = 'Synthetic family requiring review'
      item.productNumber = ''
      item.skuProperties = [{ label: '款式', value: ['甲', '乙', '丙'][index] }]
      item.description = `Synthetic family requiring review\n款式：${['甲', '乙', '丙'][index]}`
    }
    snapshot.observedAt = new Date().toISOString()
    await repository.saveSnapshot(snapshot)
  }, first)
  const page = await openSmartLibrary(extension),
    rows = sourceRows(page)
  await rows.nth(0).getByRole('checkbox').check()
  await rows.nth(1).getByRole('checkbox').check()
  const before = await libraryBackup(extension),
    review = await openSelection(page)
  await expect(
    review.getByRole('heading', { name: 'Prepare products', exact: true })
  ).toBeVisible()
  await expect(commit(review)).toBeEnabled()
  await expect(
    review.locator('[data-action="review-product-families"]')
  ).toHaveCount(0)
  await expect(review.locator('[data-product-family]')).toHaveCount(1)
  await expect(
    review.locator('[data-review-details="edit-order-details"]')
  ).toBeEnabled()
  await expect(
    review.locator('[data-review-details="edit-group-details"]')
  ).toBeEnabled()
  const context = review.locator('[data-family-context]')
  await context.locator('summary').click()
  await expect(context.locator('[data-context-entry="2003"]')).toBeVisible()
  await expect(context.getByRole('checkbox')).toHaveCount(0)
  const details = await editPreparedDetails(review, page, {
    spanishName: 'FAMILIA SINTÉTICA',
    category: '合成系列',
    material: 'Metal',
  })
  await expect(details).toBeHidden()
  for (const field of ['spanishName', 'category', 'material'])
    await expect(
      review.locator(`[data-detail-comparison="${field}"] strong`)
    ).toHaveCount(2)
  await expect(
    review.locator('[data-detail-comparison="spanishName"] strong').first()
  ).toHaveText('FAMILIA SINTÉTICA')
  unchanged(await libraryBackup(extension), before)
  await seedSmartOrder(extension, {
    count: 1,
    orderId: second,
    assignCodes: true,
  })
  const claimed = await libraryBackup(extension)
  await commit(review).click()
  await expect(review).toBeVisible()
  await expect(review).toHaveAttribute('aria-busy', 'false')
  unchanged(await libraryBackup(extension), claimed)
  await expect(
    review.locator('[data-detail-comparison="spanishName"] strong').first()
  ).toHaveText('FAMILIA SINTÉTICA')
  await expect(commit(review)).toBeEnabled()
  await commit(review).click()
  await expect(review).toBeHidden()
  const after = await libraryBackup(extension),
    preparation = after.preparations.find((value) => value.orderId === first)
  expect(preparation.groups).toHaveLength(1)
  expect(entries(preparation).sort()).toEqual(['2001', '2002'])
  expect(preparation.groups[0].spanishName).toBe('FAMILIA SINTÉTICA')
  expect(preparation.groups[0].category).toBe('合成系列')
  expect(preparation.productFamilies.families[0].entryIds).toEqual([
    '2001',
    '2002',
    '2003',
  ])
  expect(after.orders).toEqual(claimed.orders)
  await page.reload()
  expect((await libraryBackup(extension)).preparations).toEqual(
    after.preparations
  )
})

test('unsaved scoped details keep manual blanks by default, allow explicit replacement, and Cancel saves nothing', async ({
  extension,
}) => {
  await seedSmartOrder(extension, {
    count: 2,
    orderId: first,
    assignCodes: true,
  })
  await extension.inspector.evaluate(async (orderId) => {
    const repository = await window.testRepository,
      context = await repository.getOrderReconciliation({
        accountId: 'local',
        orderId,
      }),
      preparation = structuredClone(context.preparation)
    preparation.groups[0].spanishName = ''
    preparation.groups[0].naming = {
      ...preparation.groups[0].naming,
      spanishName: { source: 'manual', value: '' },
    }
    await repository.savePreparations([preparation], {
      expectedRevisions: [preparation.revision],
    })
  }, first)
  const page = await openSmartLibrary(extension)
  await page.locator('#select-rows').click()
  const before = await libraryBackup(extension),
    review = await openSelection(page)
  let editor = await editPreparedDetails(
    review,
    page,
    {
      spanishName: 'SUGGESTED BULK NAME',
    },
    { expectApplied: false }
  )
  // Existing authored names, including the deliberate blank, are protected by Keep custom values.
  await expect(editor).toBeVisible()
  await expect(editor.getByRole('status')).toContainText(
    'No values would change'
  )
  await editor.locator('[data-action="cancel-product-details"]').click()
  editor = await editPreparedDetails(
    review,
    page,
    { spanishName: 'REPLACEMENT NAME' },
    { replace: true }
  )
  await expect(editor).toBeHidden()
  await expect(
    review.locator('[data-detail-comparison="spanishName"] strong').first()
  ).toHaveText('REPLACEMENT NAME')
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  unchanged(await libraryBackup(extension), before)
})

async function harness(extension) {
  const records = await extension.inspector.evaluate(
      `(${createDemoRecords.toString()})(document)`
    ),
    page = await extension.context.newPage()
  const bundle = await build({
    entryPoints: [
      fileURLToPath(new URL('../../src/product-authoring.js', import.meta.url)),
    ],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'esm',
    target: 'chrome120',
  })
  await page.route(`${extension.origin}/src/product-authoring.js`, (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: bundle.outputFiles[0].text,
    })
  )
  await page.goto(`${extension.origin}/unsupported`)
  await page.evaluate(async (record) => {
    const { createProductAuthoring } =
        await import('/src/product-authoring.js'),
      { validatePackingPreferences } = await import('/src/packing-model.js'),
      { planPurchaseCodeReview } = await import('/src/purchase-codes.js')
    const opener = document.createElement('button')
    opener.id = 'opener'
    document.body.append(opener)
    const settings = document.createElement('button')
    settings.id = 'packing-settings'
    document.body.append(settings)
    record.snapshot.purchasedAt = '2026-09-12T12:00:00+08:00'
    record.snapshot.sellerMemberLogin = 'synthetic-review-shop'
    const state = {
        records: [record],
        preparations: [],
        allocations: [],
        issuedCodes: [],
        locks: [],
      },
      h = (window.codeHarness = {
        requests: [],
        writes: [],
        refs: record.snapshot.items.map((item) => ({
          accountId: record.snapshot.accountId,
          orderId: record.snapshot.orderId,
          entryId: item.entryId,
        })),
      })
    h.authoring = await createProductAuthoring({
      repository: {
        listPreparations: async () => [],
        getPackingPreferences: async () => validatePackingPreferences({}),
        reviewPurchaseCodes: (selection) =>
          new Promise((resolve) =>
            h.requests.push({
              resolve: (unresolved = false) => {
                const result = planPurchaseCodeReview(state, selection)
                if (unresolved) {
                  result.changes[0].after = ''
                  result.issues = [
                    {
                      code: 'PURCHASE_SIZE_REQUIRED',
                      severity: 'warning',
                      message:
                        'Resolve the source size before assigning a barcode.',
                    },
                  ]
                }
                h.lastResult = result
                resolve(result)
              },
              selection,
            })
          ),
        assignPurchaseCodes: (input) =>
          new Promise((resolve) => {
            h.writes.push(input)
            h.resolveSave = resolve
          }),
      },
      getRecords: () => [record],
      getSelectedRows: () => [],
    })
    opener.focus()
    h.done = h.authoring.reviewCodes([h.refs[0]])
  }, records[0])
  await expect(panel(page)).toBeVisible()
  return page
}

test('pending and closed reviews cannot submit or replace a newer dialog; repeated clicks save the exact reviewed plan once', async ({
  extension,
}) => {
  const page = await harness(extension)
  let review = panel(page)
  await expect(commit(review)).toBeDisabled()
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.evaluate(() => {
    document.querySelector('#opener').focus()
    codeHarness.done = codeHarness.authoring.reviewCodes([
      codeHarness.refs[1],
      codeHarness.refs[2],
    ])
  })
  review = panel(page)
  await expect(review.locator('article')).toHaveCount(2)
  await page.evaluate(() => codeHarness.requests[0].resolve())
  await expect(commit(review)).toBeDisabled()
  await page.evaluate(() => codeHarness.requests[1].resolve())
  await expect(commit(review)).toBeEnabled()
  await commit(review).evaluate((button) => {
    button.click()
    button.click()
  })
  await expect(commit(review)).toBeDisabled()
  const result = await page.evaluate(() => ({
    count: codeHarness.writes.length,
    plan: codeHarness.writes[0].plan,
    expected: codeHarness.lastResult.plan,
  }))
  expect(result.count).toBe(1)
  expect(result.plan).toEqual(result.expected)
  await page.evaluate(() => codeHarness.resolveSave())
  await expect(review).toBeHidden()
})

test('unresolved complete codes block confirmation even when planner only warns', async ({
  extension,
}) => {
  const page = await harness(extension)
  await page.evaluate(() => codeHarness.requests[0].resolve(true))
  await expect(panel(page)).toHaveAttribute('aria-busy', 'false')
  await expect(commit(panel(page))).toBeDisabled()
  await panel(page).getByRole('button', { name: 'Cancel', exact: true }).click()
})

for (const [language, labels] of [
  [
    'en',
    {
      back: 'Back',
      cancel: 'Cancel',
      confirm: 'Confirm preparation',
      sizes: 'Resolve size endings',
      none: 'Do not add size endings',
      apply: 'Apply',
    },
  ],
  [
    'es',
    {
      back: 'Volver',
      cancel: 'Cancelar',
      confirm: 'Confirmar preparación',
      sizes: 'Resolver terminaciones de talla',
      none: 'No añadir terminaciones de talla',
      apply: 'Aplicar',
    },
  ],
  [
    'zh',
    {
      back: '返回',
      cancel: '取消',
      confirm: '确认准备',
      sizes: '确认尺寸尾码',
      none: '不添加尺寸后缀',
      apply: '应用',
    },
  ],
]) {
  test(`selected-only confirmation is usable at phone width in ${language}`, async ({
    extension,
  }, testInfo) => {
    await seedSmartOrder(extension, { count: 3, assignCodes: false })
    await extension.inspector.evaluate(async (orderId) => {
      const repository = await window.testRepository,
        record = await repository.getOrder(orderId),
        snapshot = structuredClone(record.snapshot)
      for (const [index, item] of snapshot.items.slice(0, 2).entries()) {
        item.title = 'Synthetic ambiguous-size cup'
        item.productNumber = 'SYN-AMBIGUOUS'
        item.skuProperties = [
          { label: '颜色', value: '红色' },
          { label: '尺寸', value: index === 0 ? '300ml/500ml' : '700ml/900ml' },
        ]
        item.description = `Synthetic ambiguous-size cup ${index + 1}`
      }
      snapshot.observedAt = new Date().toISOString()
      await repository.saveSnapshot(snapshot)
    }, first)
    const page = await openSmartLibrary(extension)
    await page.locator(`#language-toggle [data-language="${language}"]`).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('#select-rows').click()
    const before = await libraryBackup(extension),
      review = await openSelection(page)
    await expect(review.getByRole('checkbox')).toHaveCount(0)
    await expect(commit(review)).toBeEnabled()
    await expect(
      review.locator('[data-action="review-product-families"]')
    ).toHaveCount(0)
    await expect(
      review.locator('[data-action="resolve-code-sizes"]')
    ).toBeHidden()
    await expect(review.locator('[data-family-size-fallback]')).toHaveCount(1)
    await expect(
      review.locator('[data-review-details="edit-order-details"]')
    ).toBeEnabled()
    const groupEditor = review
      .locator('[data-review-details="edit-group-details"]')
      .first()
    await groupEditor.click()
    const editor = page.locator('.product-detail-dialog')
    await expect(editor).toBeVisible()
    await editor
      .getByRole('button', { name: labels.cancel, exact: true })
      .click()
    await expect(editor).toBeHidden()
    for (const name of [labels.back, labels.cancel, labels.confirm]) {
      const control = review.getByRole('button', { name, exact: true })
      await control.focus()
      await expect(control).toBeFocused()
      const bounds = await control.boundingBox()
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(844)
    }
    await review.screenshot({
      path: testInfo.outputPath(`selected-code-review-${language}.png`),
    })
    await review
      .getByRole('button', { name: labels.cancel, exact: true })
      .click()
    await expect(review).toBeHidden()
    unchanged(await libraryBackup(extension), before)
  })
}
