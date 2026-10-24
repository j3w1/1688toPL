import { readFile } from 'node:fs/promises'
import { CFB, read, utils } from 'xlsx'
import { DOMParser } from 'linkedom'
import { test, expect } from './extension-fixture.mjs'
import { openPrintDialogFixture } from './print-dialog-fixture.mjs'
import { savedBrowserDownload } from './smart-workspace-helpers.mjs'

const basicColumns = [
  'thumbnail',
  'description',
  'quantity',
  'price',
  'cartonNumberBlank',
]

async function openExcel(
  extension,
  {
    count = 2,
    columns,
    language = 'en',
    preference,
    evidence,
    viewport,
    rawCosts = false,
    multipleStores = false,
    missingStore = false,
    visualRow = false,
  } = {}
) {
  const { page, dialog: print } = await openPrintDialogFixture(extension, {
    viewport,
  })
  await print.locator('[data-action="close-print-dialog"]').click()
  await page.evaluate(
    ({
      count,
      columns,
      language,
      preference,
      evidence,
      rawCosts,
      multipleStores,
      missingStore,
      visualRow,
    }) => {
      Print.setLanguage('en', { persist: false })
      if (preference)
        localStorage.setItem(
          '1688-excel-image-columns',
          JSON.stringify(preference)
        )
      window.excelRows = Array.from({ length: count }, (_, index) => ({
        accountId: 'local',
        orderId: '7001',
        entryId: String(101 + index),
        groupId: `group-${index}`,
        sellerName: 'Synthetic Excel store',
        sellerMemberLogin: 'synthetic-excel',
        orderDate: '2026-10-16',
        title: `Original title ${index + 1}`,
        description: `Original title ${index + 1}\n颜色: 红色\n货号: MODEL-${index + 1}`,
        productNumber: `MODEL-${index + 1}`,
        sourceSize: '6寸',
        thumbnail: `synthetic-photo-${index % 2}`,
        quantity: String(10 + index),
        price: '2.50',
        effectiveUnitPrice: '4.75',
        effectiveAmount: ((10 + index) * 4.75).toFixed(2),
        discount: '0.00',
        spanishName: `PRODUCTO ${index + 1}`,
        chineseCategory: '合成品',
        material: 'Glass',
        barcode: '',
        baseCode: '',
      }))
      window.excelEvidence = evidence || {}
      if (visualRow)
        Object.assign(window.excelRows[0], {
          sourceType: 'spreadsheet',
          barcode: 'CE26100101A',
          baseCode: 'CE26100101',
        })
      if (multipleStores) {
        window.excelRows[1].sellerName = 'Second synthetic store'
        window.excelRows[1].sellerMemberLogin = 'second-synthetic-store'
      }
      if (missingStore)
        for (const row of window.excelRows) {
          row.sellerName = ''
          row.sellerMemberLogin = ''
        }
      if (rawCosts) {
        window.excelRows[0].quantity = '12'
        window.excelRows[0].discount = '1.00'
        for (const row of window.excelRows) {
          delete row.effectiveUnitPrice
          delete row.effectiveAmount
        }
      }
      window.excelLoadCalls = 0
      window.excelLoadMode = 'ready'
      window.excelDrawnText = []
      const fillText = CanvasRenderingContext2D.prototype.fillText
      CanvasRenderingContext2D.prototype.fillText = function (value, ...args) {
        window.excelDrawnText.push(String(value))
        return fillText.call(this, value, ...args)
      }
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 16
      const context = canvas.getContext('2d')
      context.fillStyle = '#417948'
      context.fillRect(0, 0, 16, 16)
      const photo = canvas.toDataURL('image/png')
      document.querySelector('#launch').onclick = () => {
        window.excelOpening = Print.openExcelOutput(window.excelRows, {
          language,
          columns,
          evidence: window.excelEvidence,
          loadImage: async () => {
            window.excelLoadCalls++
            if (window.excelLoadMode === 'fail')
              throw new Error('Synthetic export photo unavailable')
            if (window.excelLoadMode === 'hold')
              await new Promise((resolve) => {
                window.releaseExcelLoad = resolve
              })
            return photo
          },
          renderCartonMark: async () => (await fetch(photo)).blob(),
        })
      }
    },
    {
      count,
      columns,
      language,
      preference,
      evidence,
      rawCosts,
      multipleStores,
      missingStore,
      visualRow,
    }
  )
  await page.locator('#launch').click()
  const dialog = page.locator('.image-copy-dialog')
  await ready(dialog)
  return {
    page,
    dialog,
    exportButton: dialog.locator('[data-action="download-excel-table"]'),
  }
}

async function ready(dialog) {
  await expect(dialog.locator('.copy-preview img').first()).toBeVisible()
  await expect(dialog.locator('.copy-preview')).toHaveAttribute(
    'aria-busy',
    'false'
  )
  await expect(
    dialog.locator('[data-action="download-excel-table"]')
  ).toBeEnabled()
}

async function exportExcel(extension, page, button) {
  const pending = page.waitForEvent('download')
  await button.click()
  const download = await pending
  const bytes = await readFile(await savedBrowserDownload(extension, download))
  const workbook = read(bytes, { type: 'buffer', cellStyles: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  return {
    download,
    bytes,
    workbook,
    sheet,
    grid: utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true }),
  }
}

function part(archive, name) {
  const index = archive.FullPaths.findIndex((path) => path.endsWith(`/${name}`))
  expect(index, `Missing XLSX part ${name}`).toBeGreaterThanOrEqual(0)
  return Buffer.from(archive.FileIndex[index].content).toString('utf8')
}

async function expand(details) {
  if ((await details.getAttribute('open')) === null)
    await details.locator(':scope > summary').click()
}

test('one editable sheet matches chosen preview columns and freezes source rows without hidden costs', async ({
  extension,
}) => {
  const { page, dialog, exportButton } = await openExcel(extension, {
    preference: { order: basicColumns, selected: basicColumns },
  })
  await expect(dialog).toHaveAccessibleName('Excel...')
  await expect(
    dialog.getByRole('button', { name: 'Copy image', exact: true })
  ).toBeEnabled()
  const previewText = await page.evaluate(() => excelDrawnText.join(' '))
  expect(previewText).toContain('Quantity')
  expect(previewText).toContain('Original title 1')
  await page.evaluate(() => {
    excelRows[0].quantity = '999'
    excelRows[0].title = 'Changed after opening'
    excelRows.push({ ...excelRows[0], entryId: '999' })
  })
  const { bytes, workbook, sheet, grid } = await exportExcel(
    extension,
    page,
    exportButton
  )
  expect(workbook.SheetNames).toEqual(['Products'])
  expect(grid[1]).toEqual([
    'Photo',
    'Product description',
    'Quantity',
    'Price (元)',
    'Carton no.',
  ])
  const products = grid.slice(2).filter((row) => typeof row[2] === 'number')
  expect(products).toHaveLength(2)
  expect(products.map((row) => row[2])).toEqual([10, 11])
  expect(products.map((row) => row[3])).toEqual([2.5, 2.5])
  expect(products.every((row) => row[4] === '')).toBe(true)
  expect(products[0][1]).toContain('Original title 1')
  expect(JSON.stringify(grid)).not.toContain('Changed after opening')
  expect(JSON.stringify(grid)).not.toContain('47.50')
  const archive = CFB.read(bytes, { type: 'buffer' })
  const xml = part(archive, 'xl/worksheets/sheet1.xml')
  expect(xml).not.toContain('hidden="1"')
  expect(xml).not.toContain('47.50')
  expect(
    archive.FullPaths.filter((path) => /\/xl\/media\/[^/]+$/.test(path))
  ).toHaveLength(1)
  expect(
    Object.values(sheet).filter((cell) => cell?.t === 'n').length
  ).toBeGreaterThanOrEqual(4)
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(dialog).toHaveCount(0)
})

test('detail controls, rapid column edits and popup language feed both preview and workbook', async ({
  extension,
}) => {
  const columns = ['description', 'quantity', 'price']
  const { page, dialog, exportButton } = await openExcel(extension, {
    preference: { order: columns, selected: columns },
  })
  await expand(dialog.locator('.excel-style-details'))
  await dialog.locator('[data-image-detail="title"]').uncheck()
  await dialog.locator('[data-image-detail="specifications"]').uncheck()
  await page.evaluate(() => {
    excelDrawnText = []
    const price = document.querySelector(
      '[data-column="price"] .excel-column-toggle'
    )
    price.click()
    document
      .querySelector('[data-column="effectiveAmount"] .excel-column-toggle')
      .click()
  })
  await dialog.locator('.popup-language-toggle [data-language="es"]').click()
  await ready(dialog)
  await expect
    .poll(() => page.evaluate(() => excelDrawnText.join(' ')))
    .toContain('Cantidad')
  const { workbook, grid } = await exportExcel(extension, page, exportButton)
  expect(workbook.SheetNames).toEqual(['Productos'])
  expect(grid[1]).toEqual([
    'Descripción del producto',
    'Cantidad',
    'Subtotal (元)',
  ])
  expect(JSON.stringify(grid)).not.toContain('Original title')
  expect(JSON.stringify(grid)).not.toContain('红色')
  expect(JSON.stringify(grid)).toContain('MODEL-1')
  expect(
    grid
      .slice(2)
      .filter((row) => typeof row[1] === 'number')
      .map((row) => row[2])
  ).toEqual([47.5, 52.25])
  expect(await page.evaluate(() => Print.getLanguage())).toBe('en')
})

test('ordinary source rows derive optional adjusted prices and discounted subtotals without extra charge metadata', async ({
  extension,
}) => {
  const { page, exportButton } = await openExcel(extension, {
    count: 1,
    rawCosts: true,
    columns: [
      'description',
      'quantity',
      'price',
      'effectiveUnitPrice',
      'discount',
      'effectiveAmount',
    ],
  })
  const { grid, sheet } = await exportExcel(extension, page, exportButton)
  const products = grid.slice(2).filter((row) => typeof row[1] === 'number')
  expect(products).toHaveLength(1)
  expect(products[0].slice(1)).toEqual([12, 2.5, 2.5, 1, 29])
  const subtotal = Object.entries(sheet)
    .filter(([address]) => /^F\d+$/.test(address))
    .map(([, cell]) => cell)
    .find((cell) => cell.v === 29)
  expect(subtotal.t).toBe('n')
  expect(subtotal.f).toBeUndefined()
  const text = await page.evaluate(() => excelDrawnText.join(' '))
  expect(text).toContain('29.00')
})

test('old supplier-column preferences migrate and resetting columns keeps newly added optional costs off', async ({
  extension,
}) => {
  const { dialog } = await openExcel(extension, {
    preference: {
      order: [
        'supplierWeight',
        'supplierDimensions',
        'supplierCarton',
        'quantity',
      ],
      selected: ['supplierWeight', 'supplierDimensions', 'supplierCarton'],
    },
  })
  const selected = () =>
    dialog.locator(
      '.excel-column-item:has(.excel-column-toggle[aria-pressed="true"])'
    )
  expect(
    await selected().evaluateAll((nodes) =>
      nodes.map((node) => node.dataset.column)
    )
  ).toEqual(['cartonWeight', 'cartonDimensions', 'cartonNumberBlank'])
  await expect(
    dialog.getByText('Supplier details', { exact: true })
  ).toHaveCount(0)
  await dialog
    .getByRole('button', { name: 'Default columns', exact: true })
    .click()
  await ready(dialog)
  await expect(
    dialog.locator('[data-column="price"] .excel-column-toggle')
  ).toHaveAttribute('aria-pressed', 'true')
  for (const key of ['effectiveUnitPrice', 'discount', 'effectiveAmount'])
    await expect(
      dialog.locator(`[data-column="${key}"] .excel-column-toggle`)
    ).toHaveAttribute('aria-pressed', 'false')
})

test('cancellation preserves the real clipboard and source values', async ({
  extension,
}) => {
  await extension.context.grantPermissions([
    'clipboard-read',
    'clipboard-write',
  ])
  const { page, dialog } = await openExcel(extension, {
    columns: ['description', 'quantity'],
  })
  await page.evaluate(async () =>
    navigator.clipboard.writeText('synthetic-excel-cancel-sentinel')
  )
  const before = await page.evaluate(() => structuredClone(excelRows))
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'synthetic-excel-cancel-sentinel'
  )
  expect(await page.evaluate(() => excelRows)).toEqual(before)
  expect(await page.evaluate(() => excelOpening)).toBe(false)
})

test('one pending export rejects repeated activation and keeps the captured draft for another deliberate export', async ({
  extension,
}) => {
  const { page, dialog, exportButton } = await openExcel(extension, {
    columns: basicColumns,
  })
  const downloads = []
  page.on('download', (download) => downloads.push(download))
  await page.evaluate(() => {
    excelLoadMode = 'hold'
  })
  await exportButton.click()
  await expect
    .poll(() => page.evaluate(() => typeof window.releaseExcelLoad))
    .toBe('function')
  await expect(exportButton).toBeDisabled()
  await expect(
    dialog.getByRole('button', { name: 'Done', exact: true })
  ).toBeDisabled()
  await exportButton.evaluate((button) => {
    void button.onclick()
    void button.onclick()
  })
  await page.evaluate(() => {
    excelLoadMode = 'ready'
    releaseExcelLoad()
  })
  await expect(dialog.locator('.image-copy-progress')).toHaveText(
    'Excel workbook saved.'
  )
  expect(downloads).toHaveLength(1)
  await expect(exportButton).toBeEnabled()
  const { download } = await exportExcel(extension, page, exportButton)
  expect(download.suggestedFilename()).toBe('Synthetic Excel store_货清单.xlsx')
  expect(downloads).toHaveLength(2)
})

test('failed workbook assets keep the popup and values, then a successful retry downloads once', async ({
  extension,
}) => {
  const { page, dialog, exportButton } = await openExcel(extension, {
    columns: basicColumns,
  })
  const downloads = []
  page.on('download', (download) => downloads.push(download))
  const source = await page.evaluate(() => structuredClone(excelRows))
  await page.evaluate(() => {
    excelLoadMode = 'fail'
  })
  await exportButton.click()
  await expect(dialog.locator('.image-copy-progress')).toHaveText(
    'Excel export failed. Try again.'
  )
  await expect(exportButton).toBeEnabled()
  expect(downloads).toHaveLength(0)
  expect(await page.evaluate(() => excelRows)).toEqual(source)
  await page.evaluate(() => {
    excelLoadMode = 'ready'
  })
  const { grid } = await exportExcel(extension, page, exportButton)
  expect(
    grid.slice(2).filter((row) => typeof row[2] === 'number')
  ).toHaveLength(2)
  expect(downloads).toHaveLength(1)
})

test('different linked carton weights retain aligned measurement groups in one product row', async ({
  extension,
}) => {
  const columns = [
    'description',
    'quantity',
    'cartonDimensions',
    'cartonWeight',
    'cartonNumberBlank',
  ]
  const { page, exportButton } = await openExcel(extension, {
    count: 1,
    columns,
    evidence: {
      batches: [
        {
          id: 'synthetic-physical',
          accountId: 'local',
          orderId: '7001',
          packingBasis: 'uniform',
          count: 2,
          received: 2,
          contents: [{ orderId: '7001', entryId: '101', quantity: '10' }],
          len: '20',
          wid: '30',
          ht: '40',
          weight: '5',
          weightBasis: 'carton',
          suppliedCbm: '',
          volumeBasis: 'carton',
          unitMeasurements: { 1: { weight: '7' } },
        },
      ],
    },
  })
  await page.evaluate(() => {
    excelEvidence.batches[0].weight = '999'
  })
  const { grid } = await exportExcel(extension, page, exportButton)
  const products = grid.slice(2).filter((row) => typeof row[1] === 'number')
  expect(products).toHaveLength(1)
  expect(products[0][1]).toBe(10)
  expect(products[0][2]).toContain('\n')
  expect(products[0][3]).toContain('\n')
  const dimensions = products[0][2].replace(/\s+/g, ' ')
  const weights = products[0][3].replace(/\s+/g, ' ')
  expect(dimensions).toContain('1 · 20 × 30 × 40 cm')
  expect(dimensions).toContain('2 · 20 × 30 × 40 cm')
  expect(weights).toContain('1 · 5 kg · per carton')
  expect(weights).toContain('2 · 7 kg · per carton')
  expect(products[0][4]).toBe('')
})

test('large selection uses image batches but exports every captured row in one worksheet', async ({
  extension,
}) => {
  const { page, dialog, exportButton } = await openExcel(extension, {
    count: 150,
    columns: ['number', 'description', 'quantity'],
  })
  await expect(
    dialog.getByRole('button', { name: 'Copy current image', exact: true })
  ).toBeEnabled()
  expect(
    await dialog.locator('.image-copy-batches > button').count()
  ).toBeGreaterThan(1)
  const { workbook, grid } = await exportExcel(extension, page, exportButton)
  expect(workbook.SheetNames).toEqual(['Products'])
  const products = grid.slice(2).filter((row) => typeof row[0] === 'number')
  expect(products).toHaveLength(150)
  expect(products[0][0]).toBe(1)
  expect(products.at(-1)[0]).toBe(150)
  expect(products.at(-1)[1]).toContain('Original title 150')
  expect(products.at(-1)[2]).toBe(159)
})

for (const [language, name, quantity] of [
  ['en', 'Products', 'Quantity'],
  ['es', 'Productos', 'Cantidad'],
  ['zh', '商品', '数量'],
])
  test(`narrow ${language} popup keeps export reachable and exports its local language`, async ({
    extension,
  }) => {
    const { page, dialog, exportButton } = await openExcel(extension, {
      language,
      columns: ['description', 'quantity', 'cartonNumberBlank'],
      viewport: { width: 390, height: 844 },
    })
    await expect(exportButton).toBeInViewport()
    expect((await dialog.boundingBox()).width).toBeLessThanOrEqual(390)
    const { workbook, grid, download } = await exportExcel(
      extension,
      page,
      exportButton
    )
    expect(workbook.SheetNames).toEqual([name])
    expect(download.suggestedFilename()).toBe(
      'Synthetic Excel store_货清单.xlsx'
    )
    expect(grid[1][1]).toBe(quantity)
    expect(
      grid.slice(2).filter((row) => typeof row[1] === 'number')
    ).toHaveLength(2)
    expect(await page.evaluate(() => Print.getLanguage())).toBe('en')
  })

for (const [language, suffix] of [
  ['en', 'list'],
  ['es', 'lista'],
  ['zh', '货清单'],
])
  test(`multiple stores use the local export date and ${language} list filename`, async ({
    extension,
  }) => {
    const { page, exportButton } = await openExcel(extension, {
      language,
      multipleStores: true,
      columns: ['description', 'quantity'],
    })
    const localNoon = await page.evaluate(() =>
      new Date(2026, 9, 24, 12).toISOString()
    )
    await page.clock.setFixedTime(new Date(localNoon))
    const { download, grid } = await exportExcel(extension, page, exportButton)
    expect(download.suggestedFilename()).toBe(`2026-10-24-${suffix}.xlsx`)
    expect(
      grid.slice(2).filter((row) => typeof row[1] === 'number')
    ).toHaveLength(2)
  })

test('an unnamed store uses the local-date fallback without exposing its order ID', async ({
  extension,
}) => {
  const { page, exportButton } = await openExcel(extension, {
    missingStore: true,
    columns: ['description', 'quantity'],
  })
  const localNoon = await page.evaluate(() =>
    new Date(2026, 9, 24, 12).toISOString()
  )
  await page.clock.setFixedTime(new Date(localNoon))
  const { download } = await exportExcel(extension, page, exportButton)
  expect(download.suggestedFilename()).toBe('2026-10-24-list.xlsx')
})

test('download retains preview typography, bold quantities and the exact shared code-badge artwork with editable underlying values', async ({
  extension,
}) => {
  const columns = [
    'description',
    'chineseCategory',
    'quantity',
    'barcode',
    'price',
  ]
  const { page, exportButton } = await openExcel(extension, {
    count: 1,
    columns,
    visualRow: true,
  })
  const expected = await page.evaluate(async (columns) => {
    const table = Print.planExcelTable(excelRows, { columns, language: 'en' })
    const asset = await Print.renderExcelCodeImage(table.rows[0].cells[3])
    const image = await createImageBitmap(asset.blob)
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    let black = 0,
      white = 0
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] !== 255) continue
      if (pixels[i] === 0 && pixels[i + 1] === 0 && pixels[i + 2] === 0) black++
      if (pixels[i] === 255 && pixels[i + 1] === 255 && pixels[i + 2] === 255)
        white++
    }
    image.close()
    return {
      bytes: [...new Uint8Array(await asset.blob.arrayBuffer())],
      black,
      white,
    }
  }, columns)
  expect(expected.black).toBeGreaterThan(100)
  expect(expected.white).toBeGreaterThan(10)
  const { bytes, sheet, grid } = await exportExcel(
    extension,
    page,
    exportButton
  )
  expect(sheet.A1.v).toBe('CE唛头 · List')
  expect(grid[1]).toEqual([
    'Product description',
    'Category & material',
    'Quantity',
    'Barcode code',
    'Price (元)',
  ])
  const archive = CFB.read(bytes, { type: 'buffer' })
  const images = archive.FullPaths.flatMap((path, index) =>
    /\/xl\/media\/[^/]+$/.test(path) ? [archive.FileIndex[index].content] : []
  )
  expect(images).toHaveLength(1)
  expect(Buffer.from(images[0])).toEqual(Buffer.from(expected.bytes))
  const parse = (value) => new DOMParser().parseFromString(value, 'text/xml')
  const xml = parse(part(archive, 'xl/worksheets/sheet1.xml'))
  const styles = parse(part(archive, 'xl/styles.xml'))
  const numeric = Object.entries(sheet).find(
    ([address, cell]) => /^C\d+$/.test(address) && cell.t === 'n'
  )
  expect(numeric[1].v).toBe(10)
  const quantityCell = [...xml.querySelectorAll('c')].find(
    (cell) => cell.getAttribute('r') === numeric[0]
  )
  const quantityStyle = [...styles.querySelectorAll('cellXfs > xf')][
    Number(quantityCell.getAttribute('s'))
  ]
  const quantityFont = [...styles.querySelectorAll('fonts > font')][
    Number(quantityStyle.getAttribute('fontId'))
  ]
  expect(quantityFont.querySelector('b')).not.toBeNull()
  expect(quantityFont.querySelector('name').getAttribute('val')).toBe(
    'Segoe UI'
  )
  expect(quantityFont.querySelector('sz').getAttribute('val')).toBe('14.25')
  expect(part(archive, 'xl/worksheets/sheet1.xml')).toContain(
    '<rPr><b/><sz val="16.5"/><rFont val="Segoe UI"'
  )
  const barcode = Object.entries(sheet).find(
    ([address, cell]) => /^D\d+$/.test(address) && cell.v === 'CE26100101A'
  )
  expect(barcode[1].t).toBe('s')
  const codeCell = [...xml.querySelectorAll('c')].find(
    (cell) => cell.getAttribute('r') === barcode[0]
  )
  const codeStyle = [...styles.querySelectorAll('cellXfs > xf')][
    Number(codeCell.getAttribute('s'))
  ]
  expect(codeStyle.getAttribute('numFmtId')).toBe('164')
})
