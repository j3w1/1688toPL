import test from 'node:test'
import assert from 'node:assert/strict'
import { read, CFB } from 'xlsx'
import { DOMParser } from 'linkedom'
import {
  planExcelTable,
  planExcelImage,
  excelTableImageBatches,
} from '../src/excel-image.js'
import {
  planExcelOutputWorkbook,
  createExcelOutputWorkbook,
} from '../src/excel-output-workbook.js'
import { enrichExcelRows } from '../src/excel-carton-evidence.js'

const source = (extra = {}) => ({
  accountId: 'local',
  orderId: '1001',
  entryId: '1',
  groupId: 'g1',
  baseCode: 'CE26100101',
  barcode: 'CE26100101A',
  chineseCategory: '玻璃杯',
  spanishName: 'VASO',
  thumbnail: 'photo',
  title: 'Original cup',
  description: 'Original cup\n尺寸: 6寸',
  sellerName: 'Synthetic store',
  price: '2.50',
  quantity: '12',
  effectiveUnitPrice: '2.75',
  effectiveAmount: '33.00',
  discount: '0.50',
  material: '玻璃',
  productTags: ['Reviewed'],
  ...extra,
})
function table(rows, options = {}) {
  const previous = globalThis.document
  globalThis.document = {
    createElement: () => ({
      getContext: () => ({
        measureText: (text) => ({ width: [...String(text)].length * 8 }),
      }),
    }),
  }
  try {
    return planExcelTable(rows, {
      columns: ['barcode', 'description', 'quantity', 'price'],
      ...options,
    })
  } finally {
    globalThis.document = previous
  }
}
const products = (plan) =>
  plan.products.map((product) => plan.rows[product.row - 1])

for (const language of ['en', 'es', 'zh'])
  test(`editable ${language} workbook shares preview columns, content, source rows and cached formulas`, async () => {
    const preview = table(
      [source(), source({ entryId: '2', barcode: 'CE26100101B' })],
      {
        language,
        columns: [
          'barcode',
          'description',
          'quantity',
          'effectiveUnitPrice',
          'effectiveAmount',
          'cartonNumberBlank',
        ],
        details: { title: false, specifications: true, productTags: true },
      }
    )
    const plan = planExcelOutputWorkbook(preview)
    assert.deepEqual(
      plan.columns.map((column) => column.label),
      preview.columns.map((column) => column.label)
    )
    const cells = products(plan)[0].cells
    assert.equal(cells[0].value, 'CE26100101A')
    assert.equal(cells[2].type, 'number')
    assert.equal(cells[2].value, '12')
    assert.ok(!cells[1].value.includes('Original cup'))
    assert.ok(cells[1].value.includes('Reviewed'))
    assert.equal(
      cells[4].formula,
      `ROUND(C${plan.products[0].row}*D${plan.products[0].row},2)`
    )
    assert.equal(cells[5].value, '')
    const bytes = await createExcelOutputWorkbook(preview)
    const book = read(bytes, { type: 'array' })
    assert.deepEqual(book.SheetNames, [
      { en: 'Products', es: 'Productos', zh: '商品' }[language],
    ])
    const sheet = book.Sheets[book.SheetNames[0]],
      n = plan.products[0].row
    assert.equal(sheet[`C${n}`].v, 12)
    assert.equal(sheet[`E${n}`].v, 33)
    assert.equal(sheet[`E${n}`].f, cells[4].formula)
  })

test('unselected financial columns and source metadata are absent from the archive', async () => {
  const preview = table(
    [
      source({
        effectiveAmount: '1234567.89',
        orderId: 'hidden-order-proof',
        sellerName: 'hidden-store-proof',
      }),
    ],
    {
      columns: ['quantity'],
      showOrderDetails: false,
    }
  )
  const bytes = await createExcelOutputWorkbook(preview)
  const strings = CFB.read(bytes, { type: 'array' })
    .FileIndex.map((entry) => Buffer.from(entry.content || []).toString())
    .join('\n')
  for (const privateText of [
    '1234567.89',
    'hidden-order-proof',
    'hidden-store-proof',
  ])
    assert.ok(!strings.includes(privateText))
  assert.equal(products(planExcelOutputWorkbook(preview)).length, 1)
})

test('linked measurement values stay numeric when uniform and multiline when different without multiplying quantities', () => {
  const batch = (id, entryId, weight) => ({
    id,
    accountId: 'local',
    orderId: '1001',
    count: 1,
    packingBasis: 'uniform',
    len: '60',
    wid: '40',
    ht: '30',
    weight,
    weightBasis: 'carton',
    contents: [{ orderId: '1001', entryId, quantity: '6' }],
  })
  const rows = [source()]
  const evidence = {
    orders: [
      {
        accountId: 'local',
        orderId: '1001',
        batches: [batch('b1', '1', '10'), batch('b2', '1', '10')],
      },
    ],
  }
  const uniform = enrichExcelRows(rows, evidence)
  assert.equal(uniform[0].cartonMeasurementGroups.length, 1)
  let plan = planExcelOutputWorkbook(
    table(uniform, {
      columns: ['quantity', 'cartonWeight', 'cartonDimensions'],
    })
  )
  assert.equal(products(plan)[0].cells[1].type, 'number')
  assert.equal(products(plan)[0].cells[1].value, '10')
  evidence.orders[0].batches[1].weight = '11'
  const mixed = enrichExcelRows(rows, evidence)
  assert.equal(mixed[0].cartonMeasurementGroups.length, 2)
  plan = planExcelOutputWorkbook(
    table(mixed, { columns: ['quantity', 'cartonWeight', 'cartonDimensions'] })
  )
  assert.equal(products(plan).length, 1)
  assert.equal(products(plan)[0].cells[0].value, '12')
  assert.ok(products(plan)[0].cells[1].value.includes('\n'))
  assert.equal(products(plan)[0].cells[1].type, 'text')
})

test('the full logical table retains every row independently of image pixel limits', () => {
  const rows = Array.from({ length: 240 }, (_, index) =>
    source({ entryId: String(index + 1) })
  )
  const plan = planExcelOutputWorkbook(
    table(rows, { columns: ['quantity', 'price'] })
  )
  assert.equal(plan.products.length, 240)
  assert.equal(
    products(plan).reduce((sum, row) => sum + Number(row.cells[0].value), 0),
    2880
  )
  const previous = globalThis.document
  globalThis.document = {
    createElement: () => ({
      getContext: () => ({
        measureText: (text) => ({ width: String(text).length * 8 }),
      }),
    }),
  }
  try {
    const batches = planExcelImage(rows, { columns: ['quantity', 'price'] })
    const sharedBatches = excelTableImageBatches(
      table(rows, { columns: ['quantity', 'price'] })
    )
    assert.deepEqual(
      sharedBatches.map(({ start, end }) => [start, end]),
      batches.map(({ start, end }) => [start, end])
    )
    assert.deepEqual(
      sharedBatches.flatMap((batch) =>
        batch.rows.map((row) => row.cells.map((cell) => cell.text))
      ),
      batches.flatMap((batch) =>
        batch.rows.map((row) => row.cells.map((cell) => cell.text))
      )
    )
    assert.ok(batches.length > 1)
    assert.equal(
      batches.reduce((sum, batch) => sum + batch.rows.length, 0),
      240
    )
  } finally {
    globalThis.document = previous
  }
})

test('shared image batches repeat order headings and marks without merging matching IDs across accounts', () => {
  const rows = Array.from({ length: 80 }, (_, index) =>
    source({
      entryId: String(index + 1),
      accountId: index < 40 ? 'local' : 'other',
    })
  )
  const logical = table(rows, {
    columns: ['barcode', 'baseCode', 'description'],
    details: {
      seller: true,
      orderNumber: true,
      date: true,
      status: false,
      orderTags: false,
    },
  })
  const batches = excelTableImageBatches(logical)
  assert.ok(batches.length > 1)
  for (const batch of batches) {
    assert.ok(batch.rows[0].band.lines.join(' ').includes('Synthetic store'))
    assert.equal(batch.markSpans[0].start, 0)
    assert.ok(
      batch.width <= 8192 &&
        batch.height <= 8192 &&
        batch.width * batch.height <= 16000000
    )
    for (const span of batch.markSpans)
      assert.equal(
        new Set(
          batch.rows
            .slice(span.start, span.end)
            .map((entry) => entry.source.accountId)
        ).size,
        1
      )
  }
})

test('workbook photos and merged carton marks reuse bounded deduplicated media', async () => {
  const rows = [source(), source({ entryId: '2', barcode: 'CE26100101B' })]
  const preview = table(rows, {
    columns: ['thumbnail', 'baseCode', 'quantity'],
  })
  const png = new Uint8Array(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOzwAAAAASUVORK5CYII=',
      'base64'
    )
  )
  let marks = 0
  const bytes = await createExcelOutputWorkbook(preview, {
    prepareImages: async (_row, limits) => {
      if (limits.mark) marks++
      return {
        photo: { bytes: png, mimeType: 'image/png' },
        ...(limits.mark ? { mark: { bytes: png, mimeType: 'image/png' } } : {}),
      }
    },
  })
  assert.equal(marks, 1)
  const archive = CFB.read(bytes, { type: 'array' })
  assert.equal(
    archive.FullPaths.filter((path) => /xl\/media\/[^/]+$/.test(path)).length,
    1
  )
  const xml = Buffer.from(
    archive.FileIndex[
      archive.FullPaths.findIndex((path) =>
        path.endsWith('xl/worksheets/sheet1.xml')
      )
    ].content
  ).toString()
  assert.ok(xml.includes('mergeCell'))
})

const archivePart = (archive, path) =>
  Buffer.from(
    archive.FileIndex[
      archive.FullPaths.findIndex((name) => name.endsWith(path))
    ].content
  ).toString()

test('workbook typography, rich text, numeric emphasis, stripes and compact title use the shared preview metrics', async () => {
  const preview = table(
    [
      source({
        sourceType: 'spreadsheet',
        description: 'Original cup\n货号: ART-11\n尺寸: 6寸',
      }),
      source({ sourceType: 'spreadsheet', entryId: '2' }),
    ],
    {
      columns: ['description', 'chineseCategory', 'quantity', 'price'],
      language: 'zh',
    }
  )
  const plan = planExcelOutputWorkbook(preview)
  assert.equal(plan.headerRow, 2)
  assert.equal(plan.rows[0].cells[0].value, 'CE唛头 · 清单')
  assert.equal(plan.rows[0].height, 33)
  assert.deepEqual(
    plan.rows[1].cells.map(({ value }) => value),
    preview.columns.map(({ label }) => label)
  )
  const first = products(plan)[0],
    second = products(plan)[1]
  assert.equal(first.height, preview.rows[0].height * 0.75)
  assert.equal(first.cells[0].styleSpec.align, 'center')
  assert.ok(
    first.cells[0].richText.some(
      (run) =>
        run.font.bold &&
        run.font.size === 16.5 &&
        run.text.includes('Original cup')
    )
  )
  assert.ok(
    first.cells[0].richText.some(
      (run) =>
        run.font.bold && run.font.size === 14.25 && run.text.includes('ART-11')
    )
  )
  assert.ok(
    first.cells[0].richText.some(
      (run) =>
        !run.font.bold && run.font.size === 14.25 && run.text.includes('6寸')
    )
  )
  assert.ok(
    first.cells[1].richText.some(
      (run) => run.font.bold && run.text.includes('玻璃')
    )
  )
  assert.equal(first.cells[2].type, 'number')
  assert.equal(first.cells[2].value, '12')
  assert.equal(first.cells[2].styleSpec.font.bold, true)
  assert.equal(first.cells[2].styleSpec.font.size, 14.25)
  assert.equal(first.cells[2].styleSpec.font.name, 'Segoe UI')
  assert.equal(first.cells[2].styleSpec.fill, preview.palette.body)
  assert.equal(second.cells[2].styleSpec.fill, preview.palette.stripe)
  const bytes = await createExcelOutputWorkbook(preview)
  const archive = CFB.read(bytes, { type: 'array' })
  const sheet = archivePart(archive, 'xl/worksheets/sheet1.xml')
  const styles = archivePart(archive, 'xl/styles.xml')
  assert.match(sheet, /ySplit="2" topLeftCell="A3"/)
  assert.match(sheet, /<rPr><b\/><sz val="16.5"\/><rFont val="Segoe UI"/)
  assert.match(styles, /<sz val="14.25"\/><name val="Segoe UI"/)
  assert.match(
    archivePart(archive, 'xl/workbook.xml'),
    /!\$1:\$2<\/definedName>/
  )
  assert.ok(!sheet.includes('ht="8"'))
  const native = table([source()], { columns: ['description'] })
  assert.equal(
    products(planExcelOutputWorkbook(native))[0].cells[0].styleSpec.align,
    'left'
  )
})

test('preview code artwork keeps its CSS size while the native code value remains editable under a hidden display format', async () => {
  const preview = table([source()], {
    columns: ['barcode', 'quantity'],
    showOrderDetails: false,
  })
  const plan = planExcelOutputWorkbook(preview)
  assert.equal(plan.imageColumns.code, 0)
  const png = new Uint8Array(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOzwAAAAASUVORK5CYII=',
      'base64'
    )
  )
  let captured
  const bytes = await createExcelOutputWorkbook(preview, {
    prepareImages: async (_row, limits) => {
      captured = limits.code.layout
      return {
        code: {
          bytes: png,
          mimeType: 'image/png',
          displayWidth: 90,
          displayHeight: 28,
        },
      }
    },
  })
  assert.deepEqual(captured, preview.rows[0].cells[0])
  const archive = CFB.read(bytes, { type: 'array' })
  const book = read(bytes, { type: 'array' })
  assert.equal(
    book.Sheets.Products[`A${plan.products[0].row}`].v,
    'CE26100101A'
  )
  const parse = (value) => new DOMParser().parseFromString(value, 'text/xml')
  const sheet = parse(archivePart(archive, 'xl/worksheets/sheet1.xml'))
  const styles = parse(archivePart(archive, 'xl/styles.xml'))
  const code = [...sheet.querySelectorAll('c')].find(
    (cell) => cell.getAttribute('r') === `A${plan.products[0].row}`
  )
  const style = [...styles.querySelectorAll('cellXfs > xf')][
    Number(code.getAttribute('s'))
  ]
  assert.equal(style.getAttribute('numFmtId'), '164')
  assert.match(
    archivePart(archive, 'xl/drawings/drawing1.xml'),
    /cx="857250" cy="266700"/
  )
})
