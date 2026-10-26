import { test, expect } from './extension-fixture.mjs'
import { buildOrderFixture } from '../fixtures/order-fixture.mjs'
import { buildDiscountReviewFixture } from '../fixtures/discount-review-fixture.mjs'
import { libraryBackup } from './smart-workspace-helpers.mjs'

test.use({ importFlow: true })
const origin = 'https://air.1688.test'
const ids = ['9990000000000000071', '9990000000000000072']
const detail = (id) =>
  `${origin}/app/ctf-page/trade-order-detail/index.html?orderId=${id}`

async function pages(extension) {
  const visits = []
  const live = { ambiguous: true }
  await extension.context.route(`${origin}/**`, async (route) => {
    const url = new URL(route.request().url())
    const isList = url.pathname.includes('trade-order-list')
    const id = url.searchParams.get('orderId')
    if (!isList) visits.push(id)
    const body = isList
      ? `<order-app><q-pagination data-tracker="pagination-order-list" current="1" pagesize="10" total="2"></q-pagination>${ids.map((id) => `<order-item data-tracker-args="orderId=${id}"><a class="order-detail-action" href="${detail(id)}">Detail</a><q-checkbox data-tracker="checkbox-order-item" checked></q-checkbox>${'<div class="order-item-entry"></div>'.repeat(15)}</order-item>`).join('')}</order-app>`
      : `<script>${buildOrderFixture.toString()}\n${buildDiscountReviewFixture.toString()}\nwindow.discountFixture=buildDiscountReviewFixture(document,${JSON.stringify(id)},{ambiguous:${id !== ids[1] && live.ambiguous}});</script>`
    await route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html lang="en"><title>Synthetic discount import</title><body>${body}</body></html>`,
    })
  })
  const library = await extension.context.newPage()
  await library.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await library.goto(`${extension.extensionBaseUrl}/library.html`)
  return { library, visits, live }
}

test('Activity resumes normal import when changed source no longer needs a discount choice', async ({
  extension,
}) => {
  const { library, live } = await pages(extension)
  const list = await extension.context.newPage()
  await list.goto(
    `${origin}/app/ctf-page/trade-order-list/buyer-order-list.html`
  )
  await list
    .getByRole('button', { name: 'Import selected', exact: true })
    .click()
  await list
    .getByRole('button', { name: 'Import 2 selected orders', exact: true })
    .click()
  await library.getByRole('button', { name: /^Activity/ }).click()
  await expect(library.locator('#jobs')).toContainText(
    'Finished · discount review required',
    { timeout: 15_000 }
  )
  const opened = extension.context.waitForEvent('page')
  await library.locator('[data-action="review-order-discounts"]').click()
  const page = await opened
  await page.locator('[data-action="review-order-discounts"]').click()
  const dialog = page.getByRole('dialog', {
    name: 'Review discounts',
    exact: true,
  })
  await expect(dialog).toBeVisible()
  live.ambiguous = false
  await page.evaluate(() =>
    window.discountFixture.setAmounts({ adjustment: '0.00' })
  )
  await dialog.locator('[data-action="confirm-discount-review"]').click()
  await expect(dialog).toContainText(
    'Cancel and resume this import from Activity.'
  )
  await dialog.locator('[data-action="cancel-discount-review"]').click()
  await expect(library.locator('#order-count')).toHaveText('1')
  await page.getByRole('button', { name: 'Save order', exact: true }).click()
  await expect(page.locator('aside[aria-label="1688toPL"]')).toContainText(
    'Resume this import from Activity.'
  )
  await library
    .getByRole('button', { name: 'Resume / retry', exact: true })
    .click()
  await expect(library.locator('#jobs')).toContainText('Collection completed', {
    timeout: 15_000,
  })
  const restored = (await libraryBackup(extension)).orders.find(
    (entry) => entry.snapshot.orderId === ids[0]
  )
  expect(restored.snapshot.reconciliationReview).toBeUndefined()
  expect(restored.snapshot.totals.orderAdjustment).toBe('0.00')
  expect(restored.snapshot.totals.payable).toBe('5964.50')
})

test('bulk import continues past discount review, Activity recovers it, and the receipt survives refresh and restore', async ({
  extension,
}) => {
  const { library, visits } = await pages(extension)
  const list = await extension.context.newPage()
  await list.goto(
    `${origin}/app/ctf-page/trade-order-list/buyer-order-list.html`
  )
  await list
    .getByRole('button', { name: 'Import selected', exact: true })
    .click()
  await list
    .getByRole('button', { name: 'Import 2 selected orders', exact: true })
    .click()
  await library.getByRole('button', { name: /^Activity/ }).click()
  await expect(library.locator('#jobs')).toContainText(
    'Finished · discount review required',
    { timeout: 15_000 }
  )
  await expect(library.locator('#order-count')).toHaveText('1')
  expect(visits).toEqual(ids)
  const initialJobs = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'JOBS_QUERY' })
  )
  expect(initialJobs.ok).toBe(true)
  expect(initialJobs.data.jobs[0].orders[0]).toMatchObject({
    state: 'failed',
    reviewRequired: true,
  })
  expect(initialJobs.data.jobs[0].orders[0].lastFailure).toBeUndefined()
  const panel = list.getByRole('complementary', { name: '1688 order library' })
  await expect(panel).toContainText('1 saved · 1 need discount review')
  await expect(panel.locator('.progress > p')).not.toHaveClass('error')
  const reviewOpened = extension.context.waitForEvent('page')
  await panel.locator('[data-action="review-order-discounts"]').click()
  const reviewPage = await reviewOpened
  const reviewButton = reviewPage.locator(
    '[data-action="review-order-discounts"]'
  )
  await expect(reviewButton).toBeVisible()
  expect(reviewPage.url()).toContain('#1688topl-review=')
  await reviewButton.click()
  let dialog = reviewPage.getByRole('dialog', {
    name: 'Review discounts',
    exact: true,
  })
  await expect(dialog).toContainText('¥5960.00')
  await expect(dialog.locator('tbody tr')).toHaveCount(15)
  await dialog.locator('[data-action="cancel-discount-review"]').click()
  await expect(dialog).toBeHidden()
  expect((await libraryBackup(extension)).orders).toHaveLength(1)
  await reviewButton.click()
  dialog = reviewPage.getByRole('dialog', {
    name: 'Review discounts',
    exact: true,
  })
  await dialog.locator('[data-action="confirm-discount-review"]').click()
  await expect(dialog).toBeHidden()
  await expect(library.locator('#order-count')).toHaveText('2')
  await expect(library.locator('#jobs')).toContainText('Collection completed')
  const backup = await libraryBackup(extension)
  const record = backup.orders.find(
    (record) => record.snapshot.orderId === ids[0]
  )
  expect(record.snapshot.totals).toMatchObject({
    sourceDiscount: '315.50',
    orderAdjustment: '4.50',
    goodsNet: '5890.00',
    payable: '5960.00',
  })
  expect(record.snapshot.totals.rowIncludedAdjustment).toBeUndefined()
  expect(record.snapshot.reconciliationReview.choice).toContain(
    'seller-reduction-additional'
  )
  const receipt = record.snapshot.reconciliationReview
  await reviewPage.reload()
  await expect(
    reviewPage.getByRole('button', { name: 'Save order', exact: true })
  ).toBeVisible()
  await reviewPage
    .getByRole('button', { name: 'Save order', exact: true })
    .click()
  await expect(reviewPage.getByRole('dialog')).toHaveCount(0)
  await expect(
    reviewPage.locator('aside[aria-label="1688toPL"]')
  ).toContainText('15 products saved')
  const repeated = (await libraryBackup(extension)).orders.find(
    (entry) => entry.snapshot.orderId === ids[0]
  )
  expect(repeated.snapshot.reconciliationReview).toEqual(receipt)
  expect(repeated.revision).toBe(record.revision)
  const restored = await extension.inspector.evaluate(
    (backup) => chrome.runtime.sendMessage({ type: 'BACKUP_RESTORE', backup }),
    backup
  )
  expect(restored.ok, restored.error).toBe(true)
  const afterRestore = (await libraryBackup(extension)).orders.find(
    (entry) => entry.snapshot.orderId === ids[0]
  )
  expect(afterRestore.snapshot.reconciliationReview).toEqual(receipt)
  const completedJobs = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'JOBS_QUERY' })
  )
  expect(completedJobs.data.jobs[0].orders.map((order) => order.state)).toEqual(
    ['done', 'done']
  )
  expect(completedJobs.data.jobs[0].orders[0].reviewRequired).toBeUndefined()
})

test('Activity review actions remain reachable after the first three failures', async ({
  extension,
}) => {
  const { library } = await pages(extension)
  await extension.inspector.evaluate(async () => {
    const repository = await window.testRepository
    await repository.putJob({
      id: 'synthetic-discount-errors',
      accountId: 'local',
      state: 'completed-with-errors',
      kind: 'import',
      scope: 'selected',
      phase: 'details',
      total: 5,
      updatedAt: new Date().toISOString(),
      orders: Array.from({ length: 5 }, (_, index) => ({
        orderId: `999000000000000008${index}`,
        sourceUrl: `https://air.1688.test/app/ctf-page/trade-order-detail/index.html?orderId=999000000000000008${index}`,
        expectedRows: 15,
        state: 'failed',
        reviewRequired: true,
        error:
          'The order total balances, but the discount allocation needs your review.',
      })),
    })
    await chrome.runtime.sendMessage({ type: 'LIBRARY_UPDATED' })
  })
  await library.getByRole('button', { name: /^Activity/ }).click()
  await expect(
    library.locator('[data-action="review-order-discounts"]')
  ).toHaveCount(3)
  await library
    .getByRole('button', { name: 'Next failed orders', exact: true })
    .click()
  await expect(
    library.locator('[data-action="review-order-discounts"]')
  ).toHaveCount(2)
  const opened = extension.context.waitForEvent('page')
  await library.locator('[data-action="review-order-discounts"]').last().click()
  const order = await opened
  await expect(order).toHaveURL(
    /orderId=9990000000000000084#1688topl-review=synthetic-discount-errors$/
  )
  await library
    .getByRole('button', { name: 'Previous failed orders', exact: true })
    .click()
  await expect(
    library.locator('[data-action="review-order-discounts"]')
  ).toHaveCount(3)
})
