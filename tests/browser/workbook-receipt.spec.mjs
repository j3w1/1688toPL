import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import XLSX from 'xlsx'
import { createDemoRecords } from '../../preview/library-fixture.js'
import { expect, test } from './extension-fixture.mjs'
import {
  loadedSourceContainer,
  openContainerOutput,
  sealContainerThroughUI,
} from './smart-workspace-helpers.mjs'

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const urlHash = (url) => createHash('sha256').update(url, 'utf8').digest('hex')

test('sealed workbook receipts join distinct Chromium downloads of the same frozen revision', async ({
  extension,
}, testInfo) => {
  const record = await extension.inspector.evaluate(
    `(${createDemoRecords.toString()})(document)[0]`
  )
  const restored = await extension.inspector.evaluate(
    (record) =>
      chrome.runtime.sendMessage({
        type: 'BACKUP_RESTORE',
        backup: {
          format: '1688-order-library',
          version: 1,
          exportedAt: new Date().toISOString(),
          orders: [record],
          history: [],
          images: [],
        },
      }),
    record
  )
  expect(restored.ok, restored.error).toBe(true)
  const containerId = await loadedSourceContainer(extension, [
    {
      accountId: record.accountId || 'local',
      orderId: record.snapshot.orderId,
    },
  ])
  const page = await extension.context.newPage()
  await page.addInitScript(() => {
    window.receipts = []
    const returnedAnchors = []
    const originalClick = HTMLElement.prototype.click
    HTMLElement.prototype.click = function () {
      if (
        this instanceof HTMLAnchorElement &&
        window.failDownloadSuffix &&
        this.download.endsWith(window.failDownloadSuffix)
      )
        throw new Error('Synthetic download initiation failure')
      originalClick.call(this)
      if (this instanceof HTMLAnchorElement && this.download) {
        const control = document.querySelector(
          '[data-action="download-packing-list"]'
        )
        returnedAnchors.push({
          href: this.href,
          disabled: control.disabled,
          invocationId: control.getAttribute('data-invocation-id'),
        })
      }
    }
    document.addEventListener('packing-workbook-initiated', (event) => {
      window.receipts.push({
        detail: event.detail,
        returnedAnchors: [...returnedAnchors],
      })
    })
  })
  await page.clock.setFixedTime(new Date('2026-10-15T04:00:00Z'))
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  await openContainerOutput(page, containerId)

  const cdp = await extension.context.newCDPSession(page)
  const starts = []
  const progress = new Map()
  cdp.on('Browser.downloadWillBegin', (event) => starts.push(event))
  cdp.on('Browser.downloadProgress', (event) => progress.set(event.guid, event))
  await cdp.send('Browser.setDownloadBehavior', {
    behavior: 'default',
    eventsEnabled: true,
  })
  const receipts = () => page.evaluate(() => window.receipts)
  const openExport = page.locator('[data-action="export-packing-list"]')
  const dialog = page.locator('.packing-export-dialog')
  const download = dialog.locator('[data-action="download-packing-list"]')
  const detailedJson = dialog.getByLabel('Include detailed automation JSON', {
    exact: true,
  })
  const dialogStatus = dialog.locator('.packing-export-footer [role="status"]')
  const close = dialog.getByRole('button', {
    name: 'Close export',
    exact: true,
  })
  const status = page.locator('#workspace-status')
  const readInvocation = async () => {
    await expect(download).toBeEnabled()
    await expect(download).toHaveAttribute('data-invocation-id', uuid)
    return download.getAttribute('data-invocation-id')
  }

  await openExport.click()
  await expect(download).toBeEnabled()
  expect(await download.getAttribute('data-invocation-id')).toBeNull()
  await download.click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(() => starts.length).toBe(1)
  expect(starts[0].suggestedFilename).toMatch(/^DRAFT-packing-list-.*\.xlsx$/)
  expect(await receipts()).toEqual([])

  await page.locator('[data-view="loading"]').click()
  await sealContainerThroughUI(page, { markAll: false })
  await openContainerOutput(page, containerId)
  const manifest = await extension.inspector.evaluate(
    async (id) => (await window.testRepository).getContainerManifest({ id }),
    containerId
  )
  expect(manifest.status).toBe('sealed')
  expect(manifest.products.length).toBeGreaterThan(1)
  await page
    .locator('tr[data-container-row] input[type="checkbox"]')
    .first()
    .check()

  await openExport.click()
  const abandoned = await readInvocation()
  await close.click()
  await expect(dialog).toHaveCount(0)
  expect(await receipts()).toEqual([])
  expect(starts).toHaveLength(1)

  await openExport.click()
  const failed = await readInvocation()
  expect(failed).not.toBe(abandoned)
  await page.evaluate(() => {
    window.failDownloadSuffix = '.xlsx'
  })
  await download.click()
  await expect(dialogStatus).toHaveText('Synthetic download initiation failure')
  const retry = await readInvocation()
  expect(retry).not.toBe(failed)
  expect(await receipts()).toEqual([])
  expect(starts).toHaveLength(1)

  const observations = []
  for (const outcome of [
    'workbook-only',
    'companion-error',
    'with-companion',
  ]) {
    if (outcome !== 'workbook-only') await openExport.click()
    const invocationId = await readInvocation()
    if (outcome === 'workbook-only') expect(invocationId).toBe(retry)
    await expect(detailedJson).not.toBeChecked()
    if (outcome !== 'workbook-only') await detailedJson.check()
    await dialog
      .getByLabel('Store and order headings', { exact: true })
      .uncheck()
    await dialog.getByLabel('Totals row', { exact: true }).uncheck()
    await expect(download).toHaveAttribute('data-invocation-id', invocationId)
    await page.evaluate((fail) => {
      window.failDownloadSuffix = fail ? '.json' : ''
    }, outcome === 'companion-error')
    await download.click()
    if (outcome === 'companion-error')
      await expect(dialogStatus).toHaveText(
        'Synthetic download initiation failure'
      )
    else await expect(dialog).toHaveCount(0)

    // Join independently gathered streams. Either one can arrive first.
    await expect
      .poll(async () => (await receipts()).length)
      .toBe(observations.length + 1)
    const { detail, returnedAnchors } = (await receipts()).at(-1)
    expect(detail).toEqual({
      invocation_id: invocationId,
      container_id: containerId,
      revision_id: manifest.revisionId,
      blob_url_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    await expect
      .poll(
        () =>
          starts.filter(({ url }) => urlHash(url) === detail.blob_url_sha256)
            .length
      )
      .toBe(1)
    const match = starts.find(
      ({ url }) => urlHash(url) === detail.blob_url_sha256
    )
    expect(returnedAnchors).toContainEqual({
      href: match.url,
      disabled: true,
      invocationId: null,
    })
    expect(match.suggestedFilename).toMatch(/^packing-list-.*\.xlsx$/)
    await expect.poll(() => progress.get(match.guid)?.state).toBe('completed')
    const bytes = await readFile(
      join(extension.downloadPath, match.suggestedFilename)
    )
    expect(bytes.length).toBeGreaterThan(0)
    expect(progress.get(match.guid).receivedBytes).toBe(bytes.length)
    const workbook = XLSX.read(bytes, { type: 'buffer' })
    expect(workbook.SheetNames).toEqual(['Packing list', 'Cartons', 'Se quedó'])
    const products = workbook.Sheets['Packing list']
    expect(products.A2.v).toContain(containerId)
    expect(products.A2.v).toContain(manifest.revisionId)
    const rows = XLSX.utils.sheet_to_json(products, { header: 1 })
    const quantityColumn = rows[4].indexOf('Qty')
    expect(quantityColumn).toBeGreaterThanOrEqual(0)
    expect(
      rows
        .slice(5)
        .map((row) => row[quantityColumn])
        .sort()
    ).toEqual(manifest.products.map((row) => Number(row.quantity)).sort())
    observations.push({
      ...detail,
      guid: match.guid,
      filename: match.suggestedFilename,
      completed_bytes: bytes.length,
      sheets: workbook.SheetNames,
    })
    if (outcome === 'companion-error') {
      expect(await readInvocation()).not.toBe(invocationId)
      expect(JSON.parse(await status.getAttribute('data-files'))).toEqual([
        observations[0].filename,
      ])
      await close.click()
      await expect(dialog).toHaveCount(0)
    }
  }
  await expect.poll(() => starts.length).toBe(5)
  const companion = starts.find(({ suggestedFilename }) =>
    suggestedFilename.endsWith('.json')
  )
  expect(companion.suggestedFilename).toBe(
    observations.at(-1).filename.replace(/\.xlsx$/, '.json')
  )
  expect(
    observations.map(({ blob_url_sha256 }) => blob_url_sha256)
  ).not.toContain(urlHash(companion.url))
  for (const key of ['invocation_id', 'blob_url_sha256', 'guid'])
    expect(new Set(observations.map((entry) => entry[key])).size).toBe(3)
  const { product: chromium } = await cdp.send('Browser.getVersion')
  await testInfo.attach('synthetic-workbook-downloads', {
    body: JSON.stringify({ chromium, downloads: observations }, null, 2),
    contentType: 'application/json',
  })
})
