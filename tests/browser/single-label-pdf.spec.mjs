import { readFile, writeFile } from 'node:fs/promises'
import { test, expect } from './extension-fixture.mjs'
import {
  openPrintDialogFixture,
  showPrintDialog,
} from './print-dialog-fixture.mjs'
import { observePrintExport, exportPdf } from './export-completion-helpers.mjs'

async function downloadBytes(extension, download) {
  let saved
  await expect
    .poll(async () => {
      const files = await extension.inspector.evaluate(() =>
        chrome.downloads.search({})
      )
      saved = files.find(
        (entry) => entry.url === download.url() && entry.state === 'complete'
      )
      return Boolean(saved)
    })
    .toBe(true)
  return readFile(saved.filename)
}

for (const [language, buttonName, repeatName] of [
  ['en', 'Export 1-label PDF', 'Repeat code per page'],
  ['es', 'Exportar PDF de 1 etiqueta', 'Repetir código por página'],
  ['zh', '导出单标签 PDF', '每页仅重复同一编码'],
]) {
  test(`single-label PDF exports one large page per code in ${language}, independent of quantities and sheet settings`, async ({
    extension,
  }, testInfo) => {
    test.setTimeout(60_000)
    const { page, dialog } = await openPrintDialogFixture(extension, {
      kind: 'labels',
      language,
      viewport: { width: 390, height: 820 },
    })
    await dialog
      .getByRole('checkbox', { name: repeatName, exact: true })
      .check()
    // A4 sheet choices and quantities (including zero) do not affect this output.
    const quantities = dialog.locator('.print-quantity-input input')
    await quantities.first().fill('1654')
    const files = []
    page.on('download', (download) => files.push(download))
    const settled = await observePrintExport(page)
    const button = dialog.getByRole('button', { name: buttonName, exact: true })
    const bounds = await button.boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
    await button.click()
    expect(await settled()).toEqual({ saved: true })
    await expect.poll(() => files.length).toBe(2)
    const pdfDownload = files.find((file) =>
      file.suggestedFilename().endsWith('.pdf')
    )
    expect(pdfDownload.suggestedFilename()).toMatch(/-1-label\.pdf$/)
    const bytes = await downloadBytes(extension, pdfDownload)
    const pdf = bytes.toString('latin1')
    expect([...pdf.matchAll(/\/Type \/Page\b/g)]).toHaveLength(3)
    expect(pdf).toContain('/MediaBox [0 0 566.929 283.465]')
    expect(pdf).not.toContain('/MediaBox [0 0 595.276 841.89]')
    const placements = [
      ...pdf.matchAll(/q ([\d.]+) 0 0 ([\d.]+) [\d.]+ [\d.]+ cm \/Im\d+ Do Q/g),
    ]
    expect(placements).toHaveLength(3)
    for (const placement of placements) {
      expect(Number(placement[1])).toBeCloseTo((200 * 72) / 25.4, 2)
      expect(Number(placement[2])).toBeCloseTo((100 * 72) / 25.4, 2)
    }
    expect(
      pdf.match(/q 566\.929 0 0 283\.465 0 0 cm \/Im\d+ Do Q/g)
    ).toHaveLength(3)
    // Large artwork is newly rendered at 300 dpi, not an enlarged 40 mm bitmap.
    expect(pdf).toContain('/Width 2362 /Height 1181')
    const summary = JSON.parse(
      (
        await downloadBytes(
          extension,
          files.find((file) => file.suggestedFilename().endsWith('.json'))
        )
      ).toString()
    )
    expect(summary.labelFormat).toBe('single-label')
    expect(summary.pages).toBe(3)
    expect(summary.perPage).toBe(1)
    expect(
      summary.products.map((row) => [row.requested, row.extra, row.total])
    ).toEqual([
      [1, 0, 1],
      [1, 0, 1],
      [1, 0, 1],
    ])
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('1688-print-recent'))[0].labelFormat
      )
    ).toBe('single-label')
    await expect(button).toBeEnabled()
    if (language === 'en') {
      await writeFile(testInfo.outputPath('single-label.pdf'), bytes)
      await quantities.first().fill('1')
      await page.setViewportSize({ width: 1280, height: 1000 })
      await expect(dialog.locator('canvas.print-preview')).toHaveAttribute(
        'data-preview-state',
        'ready'
      )
      await dialog.screenshot({ path: testInfo.outputPath('print-labels.png') })
    }
    await dialog.locator('[data-action="close-print-dialog"]').click()
    await page.close()
  })
}

test('repeat-code sheets update preview, export counts and persist without changing carton marks', async ({
  extension,
}) => {
  const { page, dialog } = await openPrintDialogFixture(extension, {
    kind: 'labels',
  })
  const repeat = dialog.locator('[data-action="repeat-code-per-page"]')
  await expect(dialog).toHaveAttribute('data-pages', '1')
  await repeat.check()
  await expect(dialog).toHaveAttribute('data-pages', '2')
  await expect(dialog.locator('canvas.print-preview')).toHaveAttribute(
    'data-preview-state',
    'ready'
  )
  expect(
    await exportPdf(page, dialog.locator('[data-action="export-pdf"]'))
  ).toEqual({ saved: true })
  const job = await page.evaluate(
    () => JSON.parse(localStorage.getItem('1688-print-recent'))[0]
  )
  expect(job.layout.repeatCodePerPage).toBe(true)
  expect(job.pages).toBe(2)
  expect(job.total).toBe(140)
  await dialog.locator('[data-action="close-print-dialog"]').click()
  const again = await showPrintDialog(page, { kind: 'labels' })
  await expect(
    again.locator('[data-action="repeat-code-per-page"]')
  ).toBeChecked()
  await again.locator('[data-action="close-print-dialog"]').click()
  const marks = await showPrintDialog(page, { kind: 'marks' })
  await expect(
    marks.locator('[data-action="export-single-label-pdf"]')
  ).toHaveCount(0)
  await expect(
    marks.locator('[data-action="repeat-code-per-page"]')
  ).toHaveCount(0)
  await page.close()
})

test('large-label export rejects stale sources, retries, guards duplicate clicks and cancels without downloads', async ({
  extension,
}) => {
  test.setTimeout(60_000)
  const { page, dialog } = await openPrintDialogFixture(extension, {
    kind: 'labels',
  })
  const button = dialog.locator('[data-action="export-single-label-pdf"]')
  const files = []
  page.on('download', (download) => files.push(download))
  await page.evaluate(() => {
    globalThis.testPrintSourceValidator = () => {
      throw new Error('Source changed. Review again.')
    }
  })
  expect(await exportPdf(page, button)).toEqual({ saved: false })
  expect(files).toHaveLength(0)
  await expect(button).toBeEnabled()
  await expect(dialog.locator('.print-left > .print-status')).toContainText(
    'Source changed'
  )
  await page.evaluate(() => {
    globalThis.validationCalls = 0
    globalThis.testPrintSourceValidator = () => {
      if (++globalThis.validationCalls === 2)
        throw new Error('Source changed during export.')
    }
  })
  expect(await exportPdf(page, button)).toEqual({ saved: false })
  expect(files).toHaveLength(0)
  expect(
    await page.evaluate(() => localStorage.getItem('1688-print-recent'))
  ).toBeNull()
  await page.evaluate(() => {
    globalThis.validationCalls = 0
    globalThis.testPrintSourceValidator = () => {
      globalThis.validationCalls++
      return new Promise((resolve) => {
        globalThis.releaseValidation = resolve
      })
    }
  })
  const settled = await observePrintExport(page)
  await button.click()
  await expect(button).toBeDisabled()
  await expect(dialog.locator('[data-action="export-pdf"]')).toBeDisabled()
  await button.dispatchEvent('click')
  expect(await page.evaluate(() => globalThis.validationCalls)).toBe(1)
  await dialog.locator('[data-action="close-print-dialog"]').click()
  await page.evaluate(() => globalThis.releaseValidation())
  expect(await settled()).toEqual({ saved: false })
  expect(files).toHaveLength(0)
  expect(
    await page.evaluate(() => localStorage.getItem('1688-print-recent'))
  ).toBeNull()
  await page.evaluate(() => {
    globalThis.testPrintSourceValidator = null
  })
  const again = await showPrintDialog(page, { kind: 'labels' })
  expect(
    await exportPdf(
      page,
      again.locator('[data-action="export-single-label-pdf"]')
    )
  ).toEqual({ saved: true })
  await page.close()
})
