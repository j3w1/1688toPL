import { chromium, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { startPreview } from './preview.mjs'
import { workbookFile } from '../tests/fixtures/store-workbook-fixture.mjs'

async function waitForVisibleProductImages(page) {
  const images = page.locator(
    '#sheet-body tr[data-selection-key] .thumb-cell img'
  )
  let visibleCount = 0
  for (const image of await images.all()) {
    if (!(await image.isVisible())) continue
    const inView = await image.evaluate((image) => {
      const rect = image.getBoundingClientRect()
      const clip = image.closest('.table-scroll').getBoundingClientRect()
      return (
        rect.bottom > Math.max(0, clip.top) &&
        rect.top < Math.min(innerHeight, clip.bottom) &&
        rect.right > Math.max(0, clip.left) &&
        rect.left < Math.min(innerWidth, clip.right)
      )
    })
    if (!inView) continue
    visibleCount++
    const label = `Visible product photo "${await image.getAttribute('alt')}"`
    // IntersectionObserver assigns src asynchronously; a visible row alone
    // does not mean its lazy thumbnail has a source or decoded pixels yet.
    await expect(image, `${label}: source was not assigned`).toHaveAttribute(
      'src',
      /\S/
    )
    await expect(image, `${label}: load did not complete`).toHaveJSProperty(
      'complete',
      true
    )
    await image.evaluate(async (image) => {
      try {
        await image.decode()
      } catch (cause) {
        throw new Error(
          `Visible product photo "${image.alt}" failed to decode`,
          {
            cause,
          }
        )
      }
    })
    expect(
      await image.evaluate((image) => image.naturalWidth),
      `${label}: decoded image has no pixels`
    ).toBeGreaterThan(0)
  }
  expect(
    visibleCount,
    'Screenshot needs visible product photos'
  ).toBeGreaterThan(0)
}

// Production controllers/repository with synthetic purchases in a temporary
// browser only. A missing domain API fails loudly; no fallback preview model.
const preview = await startPreview()
const browser = await chromium.launch({ channel: 'chromium' })
try {
  await mkdir('screenshots', { recursive: true })
  await mkdir('work', { recursive: true })
  const page = await browser.newPage({
    viewport: { width: 1280, height: 960 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
  })
  await page.addInitScript(() =>
    localStorage.setItem('1688-library-purchase-months', '[]')
  )
  await page.goto(`${preview.url}/library.html`)
  await expect(
    page.locator('#sheet-body tr[data-selection-key]').nth(7)
  ).toBeVisible()
  await waitForVisibleProductImages(page)
  await page.screenshot({ path: 'screenshots/order-library-dark.png' })
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await waitForVisibleProductImages(page)
  await page.screenshot({ path: 'screenshots/order-library.png' })
  await page.locator('#copy-excel-image').click()
  const excel = page.locator('.image-copy-dialog')
  await expect(
    excel.getByRole('button', { name: 'Export Excel (.xlsx)', exact: true })
  ).toBeVisible()
  await expect(excel.locator('.copy-preview img').first()).toBeVisible()
  await excel
    .locator('.copy-preview img')
    .first()
    .evaluate((image) => image.decode())
  await excel.screenshot({ path: 'screenshots/excel-image-columns.png' })
  await excel.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await page
    .getByRole('button', { name: 'Import spreadsheet', exact: true })
    .click()
  const importer = page.getByRole('dialog', {
    name: 'Import store spreadsheet',
    exact: true,
  })
  await importer.getByRole('tab', { name: 'Markers', exact: true }).click()
  await importer.screenshot({
    path: 'screenshots/store-spreadsheet-import.png',
  })
  const importPhoto = await page
    .locator('#sheet-body .thumb-cell img')
    .first()
    .evaluate((image) => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      canvas.getContext('2d').drawImage(image, 0, 0)
      return canvas.toDataURL('image/png').split(',')[1]
    })
  await importer.getByLabel('Workbook', { exact: true }).setInputFiles(
    workbookFile({
      name: 'Synthetic factory.xlsx',
      total: 204,
      rows: [
        ['pic', 'desc', 'boxes', 'perbox', 'price', 'amount', 'group', 'var'],
        ['', 'Ceramic cup · white', 1, 24, 3, 72, 'Cups', 'A'],
        ['', 'Glass bowl', 1, 12, 5, 60, 'Bowls', ''],
        ['', 'Ceramic cup · blue', 1, 24, 3, 72, 'Cups', 'B'],
        ['total', 204, 'total'],
      ],
      photoBytes: Buffer.from(importPhoto, 'base64'),
      photoSpans: [{ from: 1, to: 4 }],
    })
  )
  await expect(importer.locator('.store-import-product')).toHaveCount(3)
  await importer.getByLabel('Purchase date', { exact: true }).fill('2026-10-20')
  await importer.locator('input[name="allReviews"]').check()
  await importer.locator('input[name="photosReviewed"]').check()
  await importer
    .getByRole('button', { name: 'Review products and codes', exact: true })
    .click()
  await expect(
    importer.locator('[data-action="store-import-code-review"]')
  ).toBeVisible()
  await expect(
    importer.getByRole('button', {
      name: 'Import and assign codes',
      exact: true,
    })
  ).toBeEnabled()
  for (const image of await importer
    .locator('.store-import-code-variant img')
    .all())
    await image.evaluate((image) => image.decode())
  await importer.screenshot({
    path: 'screenshots/store-import-code-review.png',
  })
  await importer.locator('[data-action="edit-order-details"]').click()
  const scopedDetails = page.locator('.product-detail-dialog')
  await scopedDetails.locator('[data-detail-select="spanishName"]').check()
  await scopedDetails
    .locator('[data-detail-field="spanishName"]')
    .fill('PRODUCTOS SINTETICOS')
  await scopedDetails.locator('[data-detail-select="category"]').check()
  await scopedDetails.locator('[data-detail-field="category"]').fill('合成品')
  await scopedDetails.locator('[data-detail-select="material"]').check()
  await scopedDetails.locator('[data-detail-field="material"]').fill('Ceramic')
  await scopedDetails.screenshot({
    path: 'screenshots/product-details-review.png',
  })
  await scopedDetails.locator('[data-action="cancel-product-details"]').click()
  await importer
    .getByRole('button', { name: 'Close import', exact: true })
    .click()
  const first = page.locator('#sheet-body tr[data-selection-key]').first()
  await first.locator('.description-cell').click({ position: { x: 5, y: 5 } })
  const details = page.locator('.product-details-dialog')
  await details.locator('img').evaluate((image) => image.decode())
  await details.screenshot({ path: 'screenshots/product-details.png' })
  await details
    .getByRole('button', { name: 'Close product details', exact: true })
    .click()
  await first.locator('[data-action="edit-order-product"]').click()
  const authoring = page.locator('.product-authoring-dialog')
  await authoring.getByRole('button', { name: 'Barcode', exact: true }).click()
  const labelPreview = page.getByAltText('Printable label preview')
  await expect(labelPreview).toBeVisible()
  await expect(labelPreview).toHaveAttribute('src', /^(blob:|data:image\/)/)
  await labelPreview.evaluate((image) => image.decode())
  expect(
    await labelPreview.evaluate((image) => image.naturalWidth)
  ).toBeGreaterThan(0)
  await page
    .locator('#label-dialog')
    .screenshot({ path: 'screenshots/label-editor.png' })
  await page
    .getByRole('button', { name: 'Close label editor', exact: true })
    .click()
  await page.locator('[data-action="open-order-cartons"]').first().click()
  await expect(page.locator('.reconciliation-summary')).toBeVisible()
  await page.screenshot({ path: 'screenshots/preparation.png' })
  await page.screenshot({ path: 'screenshots/order-cartons.png' })
  await page.locator('[data-action="view-packing"]').click()
  await page
    .locator('[data-action="choose-container"]')
    .selectOption({ label: 'Synthetic October 2026' })
  await expect(page.locator('.container-heading')).toContainText(
    'Synthetic October 2026'
  )
  await page
    .locator('.container-order-list [data-action="expand-container-order"]')
    .first()
    .click()
  const firstCarton = page.locator('[data-container-row]').first()
  await expect(firstCarton).toBeVisible()
  await page.screenshot({ path: 'screenshots/container-loading.png' })
  await page.locator('[data-action="mark-all-loaded"]').click()
  await expect(page.locator('#container-content')).toHaveAttribute(
    'aria-busy',
    'false'
  )
  await firstCarton
    .locator('[data-action="set-carton-loading"][data-state="left-behind"]')
    .click()
  await expect(
    firstCarton.getByText('Left behind', { exact: true })
  ).toBeVisible()
  await page
    .locator('[data-action="container-view"][data-view="packing-list"]')
    .click()
  await page.locator('[data-action="export-packing-list"]').click()
  const exported = page.locator('.packing-export-dialog')
  await expect(
    exported.getByRole('checkbox', {
      name: 'Include detailed automation JSON',
      exact: true,
    })
  ).not.toBeChecked()
  await expect(
    exported.getByRole('radio', { name: 'Se quedó', exact: true })
  ).toBeVisible()
  await exported.screenshot({ path: 'screenshots/packing-export.png' })
  await exported
    .getByRole('button', { name: 'Close export', exact: true })
    .click()
  await page
    .locator('[data-action="container-view"][data-view="left-behind"]')
    .click()
  await page.screenshot({ path: 'screenshots/container-left-behind.png' })
  await page.locator('[data-action="view-orders"]').click()
  await page.locator('[data-action="orders-products"]').click()
  await page.locator('#packing-settings').click()
  await page.getByRole('tab', { name: 'Labels', exact: true }).click()
  await page
    .locator('#settings-dialog')
    .screenshot({ path: 'screenshots/settings.png' })
  await page.getByRole('tab', { name: 'Appearance', exact: true }).click()
  await page
    .locator('#settings-dialog')
    .screenshot({ path: 'screenshots/appearance-settings.png' })
  await page
    .getByRole('button', { name: 'Close settings', exact: true })
    .click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'work/workspace-narrow-dark.png' })
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await page.screenshot({ path: 'work/workspace-narrow-light.png' })
  await page.setViewportSize({ width: 1280, height: 960 })
  await page.goto(`${preview.url}/?state=import`)
  await page.locator('.import-latest').waitFor()
  await page
    .locator('aside[aria-label="1688toPL"]')
    .screenshot({ path: 'screenshots/import-progress.png' })
} finally {
  await browser.close()
  await preview.close()
}
