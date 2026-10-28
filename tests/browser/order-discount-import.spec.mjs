import { test, expect } from './extension-fixture.mjs'
import { buildOrderFixture } from '../fixtures/order-fixture.mjs'
import {
  buildDiscountReviewFixture,
  sixRowDiscountPattern,
} from '../fixtures/discount-review-fixture.mjs'
import { libraryBackup } from './smart-workspace-helpers.mjs'

test.use({ importFlow: true })
const origin = 'https://air.1688.test'
const ids = ['9990000000000000071', '9990000000000000072']
const detail = (id) =>
  `${origin}/app/ctf-page/trade-order-detail/index.html?orderId=${id}`

async function pages(extension, options = {}) {
  const visits = []
  const live = { ambiguous: true, signedAdjustment: false, ...options }
  await extension.context.route(`${origin}/**`, async (route) => {
    const url = new URL(route.request().url())
    const isList = url.pathname.includes('trade-order-list')
    const id = url.searchParams.get('orderId')
    if (!isList) visits.push(id)
    const body = isList
      ? `<order-app><q-pagination data-tracker="pagination-order-list" current="1" pagesize="10" total="2"></q-pagination>${ids.map((id) => `<order-item data-tracker-args="orderId=${id}"><a class="order-detail-action" href="${detail(id)}">Detail</a><q-checkbox data-tracker="checkbox-order-item" checked></q-checkbox>${'<div class="order-item-entry"></div>'.repeat(live.pattern?.length ?? 15)}</order-item>`).join('')}</order-app>`
      : `<script>${buildOrderFixture.toString()}\n${buildDiscountReviewFixture.toString()}\nwindow.discountFixture=buildDiscountReviewFixture(document,${JSON.stringify(id)},${JSON.stringify({ ...live, ambiguous: id !== ids[1] && live.ambiguous })});</script>`
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

test('six-product PLUS and seller reductions pass packaged Save order, bulk import, refresh and restore without review', async ({
  extension,
}) => {
  const { library } = await pages(extension, {
    pattern: sixRowDiscountPattern,
    signedAdjustment: true,
    amounts: {
      adjustment: '66.30',
      shop: '0.00',
      shipping: '600.00',
      redPacket: '0.00',
    },
  })
  const order = await extension.context.newPage()
  await order.goto(detail(ids[0]))
  await order.getByRole('button', { name: 'Save order', exact: true }).click()
  await expect(order.locator('aside[aria-label="1688toPL"]')).toContainText(
    '6 products saved'
  )
  await expect(
    order.getByRole('dialog', { name: 'Review discounts', exact: true })
  ).toHaveCount(0)
  await order.getByRole('button', { name: 'Save order', exact: true }).click()
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
  await expect(library.locator('#jobs')).toContainText('Collection completed', {
    timeout: 15000,
  })
  await expect(library.locator('#order-count')).toHaveText('2')
  const before = await libraryBackup(extension)
  for (const record of before.orders) {
    expect(record.snapshot.items).toHaveLength(6)
    expect(record.snapshot.totals).toMatchObject({
      goodsGross: '10654.00',
      sourceDiscount: '532.70',
      orderAdjustment: '66.30',
      orderLevelAdjustment: '66.30',
      goodsNet: '10055.00',
      shipping: '600.00',
      payable: '10655.00',
    })
    expect(
      record.snapshot.items.every(
        (item) =>
          item.allocatedDiscount === '0.00' &&
          item.discount === item.sourceDiscount
      )
    ).toBe(true)
    expect(record.snapshot.reconciliationReview.mode).toBe('automatic')
  }
  await expect(
    library.locator('[data-action="review-order-discounts"]')
  ).toHaveCount(0)
  const refresh = await extension.inspector.evaluate(
    (orderIds) =>
      chrome.runtime.sendMessage({ type: 'REFRESH_ORDERS', orderIds }),
    ids
  )
  expect(refresh.ok, refresh.error).toBe(true)
  await expect
    .poll(
      async () => {
        const result = await extension.inspector.evaluate(() =>
          chrome.runtime.sendMessage({ type: 'JOBS_QUERY' })
        )
        return result.data.jobs.every((job) => job.state === 'completed')
      },
      { timeout: 15000 }
    )
    .toBe(true)
  const after = await libraryBackup(extension)
  expect(after.orders.map((record) => record.revision)).toEqual(
    before.orders.map((record) => record.revision)
  )
  expect(
    after.orders.map((record) => record.snapshot.reconciliationReview)
  ).toEqual(before.orders.map((record) => record.snapshot.reconciliationReview))
  const restored = await extension.inspector.evaluate(
    (backup) => chrome.runtime.sendMessage({ type: 'BACKUP_RESTORE', backup }),
    after
  )
  expect(restored.ok, restored.error).toBe(true)
  const roundTrip = await libraryBackup(extension)
  expect(roundTrip.orders.map((record) => record.snapshot.totals)).toEqual(
    after.orders.map((record) => record.snapshot.totals)
  )
})

for (const [language, label] of [
  ['en', 'Seller reduction (order level)'],
  ['es', 'Rebaja del vendedor (a nivel del pedido)'],
  ['zh', '卖家减价（订单级，未分摊到商品）'],
]) {
  test(`a signed fully itemized footer reduction saves without review and keeps its order-level summary in ${language}`, async ({
    extension,
  }) => {
    const { library } = await pages(extension, { signedAdjustment: true })
    const page = await extension.context.newPage()
    await page.goto(detail(ids[0]))
    await expect(
      page.locator('[data-action="review-order-discounts"]')
    ).toBeHidden()
    await page.getByRole('button', { name: 'Save order', exact: true }).click()
    await expect(library.locator('#order-count')).toHaveText('1')
    await expect(
      page.getByRole('dialog', { name: 'Review discounts', exact: true })
    ).toHaveCount(0)
    const before = (await libraryBackup(extension)).orders[0]
    expect(before.snapshot.items).toHaveLength(15)
    expect(
      before.snapshot.items.every(
        (item) =>
          item.allocatedDiscount === '0.00' &&
          item.discount === item.sourceDiscount
      )
    ).toBe(true)
    expect(before.snapshot.totals).toMatchObject({
      sourceDiscount: '315.50',
      orderAdjustment: '4.50',
      orderLevelAdjustment: '4.50',
      goodsNet: '5890.00',
      payable: '5960.00',
    })
    expect(before.snapshot.totals.rowIncludedAdjustment).toBeUndefined()
    expect(before.snapshot.totals.orderDiscount).toBeUndefined()
    expect(before.snapshot.reconciliationReview).toMatchObject({
      version: 2,
      mode: 'automatic',
    })
    expect(before.snapshot.reconciliationReview.reviewedAt).toBeUndefined()
    await page.reload()
    await page.getByRole('button', { name: 'Save order', exact: true }).click()
    await expect(page.locator('aside[aria-label="1688toPL"]')).toContainText(
      '15 products saved'
    )
    const after = (await libraryBackup(extension)).orders[0]
    expect(after.revision).toBe(before.revision)
    expect(after.snapshot.reconciliationReview).toEqual(
      before.snapshot.reconciliationReview
    )
    await library
      .locator(`#language-toggle [data-language="${language}"]`)
      .click()
    await library.setViewportSize({ width: 390, height: 740 })
    await library.locator('.order-card').first().click()
    const details = library.locator('#order-details')
    await expect(details).toBeVisible()
    await expect(details.locator('dt').filter({ hasText: label })).toHaveText(
      label
    )
    const reduction = details
      .locator('dt')
      .filter({ hasText: label })
      .locator('xpath=following-sibling::dd[1]')
    await expect(reduction).toContainText('4.50')
    expect(
      await details.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
    ).toBe(true)
  })
}

test('bulk import automatically saves fully itemized signed footer reductions without a discount-review queue', async ({
  extension,
}) => {
  const { library, visits } = await pages(extension, { signedAdjustment: true })
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
  await expect(library.locator('#jobs')).toContainText('Collection completed', {
    timeout: 15_000,
  })
  await expect(library.locator('#order-count')).toHaveText('2')
  await expect(
    library.locator('[data-action="review-order-discounts"]')
  ).toHaveCount(0)
  expect(visits).toEqual(ids)
  const jobs = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'JOBS_QUERY' })
  )
  expect(jobs.data.jobs[0].orders.map((order) => order.state)).toEqual([
    'done',
    'done',
  ])
  expect(jobs.data.jobs[0].orders.every((order) => !order.reviewRequired)).toBe(
    true
  )
  const saved = (await libraryBackup(extension)).orders.find(
    (record) => record.snapshot.orderId === ids[0]
  )
  expect(saved.snapshot.reconciliationReview).toMatchObject({
    version: 2,
    mode: 'automatic',
  })
  expect(saved.snapshot.totals.orderLevelAdjustment).toBe('4.50')
  expect(
    saved.snapshot.items.every((item) => item.allocatedDiscount === '0.00')
  ).toBe(true)
})

test('a saved human choice for identical signed evidence survives normal-page rereads without automatic recosting', async ({
  extension,
}) => {
  const { library } = await pages(extension, { signedAdjustment: true })
  const seedPage = await extension.context.newPage()
  await seedPage.goto(`${extension.origin}/unsupported`)
  await seedPage.addScriptTag({
    content: `${buildOrderFixture.toString()}\n${buildDiscountReviewFixture.toString()}\nbuildDiscountReviewFixture(document,${JSON.stringify(ids[0])},{signedAdjustment:true,sourceDomain:'com'});`,
  })
  const legacy = await seedPage.evaluate(async (orderId) => {
    const { reviewOrderSnapshot } = await import('/src/order-snapshot.js')
    const { planOrderReconciliationCandidates, confirmOrderReconciliation } =
      await import('/src/order-reconciliation.js')
    const current = reviewOrderSnapshot(
      document,
      `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${orderId}`
    )
    const planned = planOrderReconciliationCandidates(
      current.snapshot,
      current.snapshot.reconciliationReview.sourceTotals
    )
    return confirmOrderReconciliation(planned.review, {
      choice: planned.review.suggestedChoice,
      evidenceKey: planned.review.evidenceKey,
      reviewedAt: '2026-10-26T06:00:00.000Z',
    })
  }, ids[0])
  await extension.inspector.evaluate(
    async (snapshot) => (await window.testRepository).saveSnapshot(snapshot),
    legacy
  )
  await seedPage.close()
  const page = await extension.context.newPage()
  await page.goto(detail(ids[0]))
  await page.getByRole('button', { name: 'Save order', exact: true }).click()
  await expect(page.locator('aside[aria-label="1688toPL"]')).toContainText(
    '15 products saved'
  )
  await expect(
    page.getByRole('dialog', { name: 'Review discounts', exact: true })
  ).toHaveCount(0)
  const before = (await libraryBackup(extension)).orders[0]
  expect(before.snapshot.reconciliationReview).toEqual(
    legacy.reconciliationReview
  )
  expect(before.snapshot.totals.orderLevelAdjustment).toBeUndefined()
  expect(before.snapshot.items.map((item) => item.allocatedDiscount)).toEqual(
    legacy.items.map((item) => item.allocatedDiscount)
  )
  await page.reload()
  await page.getByRole('button', { name: 'Save order', exact: true }).click()
  await expect(page.locator('aside[aria-label="1688toPL"]')).toContainText(
    '15 products saved'
  )
  const after = (await libraryBackup(extension)).orders[0]
  expect(after.revision).toBe(before.revision)
  expect(after.snapshot.reconciliationReview).toEqual(
    legacy.reconciliationReview
  )
  await expect(library.locator('#order-count')).toHaveText('1')
})

test('retrying an earlier unsigned review imports newly explicit footer evidence automatically once', async ({
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
  await expect(library.locator('#order-count')).toHaveText('1')
  live.signedAdjustment = true
  await library
    .getByRole('button', { name: 'Resume / retry', exact: true })
    .click()
  await expect(library.locator('#jobs')).toContainText('Collection completed', {
    timeout: 15_000,
  })
  await expect(library.locator('#order-count')).toHaveText('2')
  const jobs = await extension.inspector.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'JOBS_QUERY' })
  )
  expect(jobs.data.jobs[0].orders.map((order) => order.state)).toEqual([
    'done',
    'done',
  ])
  expect(jobs.data.jobs[0].orders[0].reviewRequired).toBeUndefined()
  const saved = (await libraryBackup(extension)).orders.find(
    (record) => record.snapshot.orderId === ids[0]
  )
  expect(saved.snapshot.reconciliationReview).toMatchObject({
    version: 2,
    mode: 'automatic',
  })
  expect(saved.snapshot.totals.orderLevelAdjustment).toBe('4.50')
})

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
