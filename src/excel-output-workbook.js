import { columnName } from './xlsx-writer.js'
import { createPreparedPackingWorkbook } from './packing-workbook.js'
import { lineGrossCents, moneyToCents } from './money.js'
import { excelOutputTitle } from './excel-output-file-name.js'

const numeric = (value) =>
  /^-?\d+(?:\.\d+)?$/.test(String(value)) &&
  String(value).replace(/[^\d]/g, '').replace(/^0+/, '').length <= 15

/** CSS canvas fonts use pixels; OOXML sizes use points. */
function fontSpec(value = '16px "Segoe UI"', color = '#222222') {
  const match = String(value).match(/(?:(\d{3}|bold)\s+)?([\d.]+)px\s+(.+)/)
  return {
    name:
      match?.[3].split(',')[0].replaceAll('"', '').replaceAll("'", '').trim() ||
      'Segoe UI',
    size: Number(match?.[2] || 16) * 0.75,
    bold: match?.[1] === 'bold' || Number(match?.[1]) >= 600,
    color,
  }
}

function numberFormat(value, displayed) {
  const fraction = String(value).split('.')[1]?.length || 0
  return `0${fraction ? `.${'0'.repeat(fraction)}` : ''}${String(displayed).endsWith(' 元') ? '" 元"' : ''}`
}

function richCell(cell, palette) {
  const runs = []
  const append = (text, font, color = palette.text) => {
    if (text) runs.push({ text, font: fontSpec(font, color) })
  }
  if (cell.blocks) {
    for (const [index, block] of cell.blocks.entries()) {
      if (index) append('\n', block.font)
      for (const label of block.labelLines)
        append(`${label}\n`, block.labelFont, palette.muted)
      for (const [line, value] of block.lines.entries()) {
        if (line) append('\n', block.font)
        if (!line && block.label && !block.labelLines.length)
          append(block.label, block.labelFont, palette.muted)
        append(value, block.font, palette[block.colorRole] || palette.text)
      }
    }
  } else if (cell.richLines) {
    for (const [index, line] of cell.richLines.entries()) {
      if (index) append('\n', cell.font)
      for (const run of line)
        append(run.text, run.font || cell.font, run.color || palette.text)
    }
  }
  for (const line of cell.tags?.rows || []) {
    if (runs.length) append('\n', cell.font)
    for (const [index, tag] of line.entries()) {
      if (index) append(' · ', tag.font)
      append(tag.name, tag.font, tag.foreground)
    }
  }
  return runs
}

/** Adapt the shared canvas layout into editable, equally styled workbook cells. */
export function planExcelOutputWorkbook(table) {
  const columns = table.columns.map((column) => ({
    ...column,
    pixelWidth: column.width,
    width: Math.max(1, (column.width - 5) / 7),
  }))
  const palette = table.palette
  const styled = (
    value = '',
    {
      font,
      fill = palette.body,
      align = 'center',
      borderColor = palette.grid,
      ...style
    } = {}
  ) => ({
    value,
    style: 4,
    type: 'text',
    styleSpec: {
      font: font || fontSpec(undefined, palette.text),
      fill,
      align,
      borderColor,
      ...style,
    },
  })
  const rows = [
    {
      number: 1,
      height: (table.titleHeight || 44) * 0.75,
      cells: columns.map((_, index) =>
        styled(index ? '' : table.title || excelOutputTitle(table.language), {
          font: fontSpec(
            table.titleFont || '600 26px "Segoe UI"',
            palette.text
          ),
          fill: palette.body,
          borderColor: palette.body,
        })
      ),
    },
    {
      number: 2,
      height: (table.columnHeaderHeight || table.headerHeight) * 0.75,
      cells: columns.map((column) =>
        styled(column.label, {
          font: fontSpec(
            table.headerFont || '700 14px "Segoe UI"',
            palette.headerText
          ),
          fill: palette.header,
        })
      ),
    },
  ]
  const products = [],
    merges = []
  const lastColumn = columnName(columns.length - 1)
  if (columns.length > 1) merges.push(`A1:${lastColumn}1`)
  const productRows = new Map()
  for (const [index, entry] of table.rows.entries()) {
    if (entry.band) {
      const tags =
        entry.band.tags?.rows?.flatMap((line) => line.map((tag) => tag.name)) ||
        []
      const value = [...entry.band.lines, ...tags].filter(Boolean).join('\n')
      const number = rows.length + 1
      rows.push({
        number,
        height: Math.max(1, Math.min(409, entry.band.height * 0.75)),
        cells: columns.map((_, c) =>
          styled(c ? '' : value, {
            font: fontSpec(
              table.headerFont || '700 14px "Segoe UI"',
              palette.text
            ),
            fill: entry.band.kind === 'store' ? palette.store : palette.order,
            borderColor: palette.separator,
          })
        ),
      })
      if (columns.length > 1) merges.push(`A${number}:${lastColumn}${number}`)
    }
    const number = rows.length + 1
    productRows.set(index, number)
    rows.push({
      number,
      height: Math.min(409, entry.height * 0.75),
      cells: columns.map((column, c) => {
        const cell = entry.cells[c]
        const base = styled('', {
          font: fontSpec(cell.font, palette.text),
          fill: index % 2 ? palette.stripe : palette.body,
          align:
            column.key === 'description' &&
            entry.source.sourceType !== 'spreadsheet'
              ? 'left'
              : 'center',
          topColor: ['store', 'order'].includes(entry.separator)
            ? palette.separator
            : palette.grid,
          topStyle: ['store', 'order'].includes(entry.separator)
            ? 'medium'
            : 'thin',
        })
        if (column.blank || column.key === 'thumbnail') return base
        const value = entry.source[column.key]
        if (column.numeric && numeric(value))
          return {
            ...base,
            value,
            type: 'number',
            styleSpec: {
              ...base.styleSpec,
              numberFormat: numberFormat(value, cell.text),
            },
          }
        const richText = ['barcode', 'baseCode'].includes(column.key)
          ? []
          : richCell(cell, palette)
        return {
          ...base,
          value: richText.length
            ? richText.map(({ text }) => text).join('')
            : cell.alignedText || cell.text,
          ...(richText.length ? { richText } : {}),
        }
      }),
    })
    products.push({
      source: entry.source,
      row: number,
      hideMark: true,
      codeCell: columns.some(({ key }) => key === 'barcode')
        ? entry.cells[columns.findIndex(({ key }) => key === 'barcode')]
        : undefined,
    })
  }
  const indexes = new Map(columns.map(({ key }, index) => [key, index]))
  const markColumn = indexes.get('baseCode')
  if (markColumn !== undefined)
    for (const span of table.markSpans) {
      const product = products[span.start]
      product.hideMark = false
      product.markEndRow = productRows.get(span.end - 1)
      if (product.markEndRow > product.row)
        merges.push(
          `${columnName(markColumn)}${product.row}:${columnName(markColumn)}${product.markEndRow}`
        )
    }
  // A displayed amount remains editable; formulas use only selected, exact inputs.
  for (const product of products) {
    const cells = rows[product.row - 1].cells
    const amount = indexes.get('effectiveAmount'),
      quantity = indexes.get('quantity'),
      price = indexes.get('effectiveUnitPrice')
    if (
      amount !== undefined &&
      quantity !== undefined &&
      price !== undefined &&
      numeric(cells[amount].value) &&
      numeric(cells[quantity].value) &&
      numeric(cells[price].value) &&
      /^[1-9]\d*$/.test(String(cells[quantity].value)) &&
      !String(cells[price].value).startsWith('-') &&
      /^\d+(?:\.\d{1,2})?$/.test(String(cells[amount].value)) &&
      lineGrossCents(
        String(cells[price].value),
        String(cells[quantity].value)
      ) === moneyToCents(String(cells[amount].value))
    )
      cells[amount] = {
        ...cells[amount],
        formula: `ROUND(${columnName(quantity)}${product.row}*${columnName(price)}${product.row},2)`,
      }
  }
  return {
    name: { en: 'Products', es: 'Productos', zh: '商品' }[table.language],
    language: table.language,
    columns,
    rows,
    products,
    merges,
    palette,
    photoPixels: 132,
    fitPhotos: true,
    matchPreview: true,
    imageColumns: {
      photo: indexes.get('thumbnail'),
      mark: indexes.get('baseCode'),
      code: indexes.get('barcode'),
    },
    headerRow: 2,
    lastColumn,
    lastRow: rows.length,
    lastProductRow: rows.length,
    freezeHeaders: true,
    filters: false,
  }
}

export function createExcelOutputWorkbook(table, options) {
  return createPreparedPackingWorkbook(planExcelOutputWorkbook(table), options)
}
