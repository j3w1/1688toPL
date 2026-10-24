import { message as uiMessage, getLanguage } from './i18n.js'
import {
  excelImageColumns,
  excelTableImageBatches,
  planExcelTable,
  renderExcelImage,
} from './excel-image.js'
import { createExcelImageBadges } from './excel-image-badges.js'
import {
  selectedExcelImageColumns,
  createExcelImageOptions,
  readExcelImagePreference,
} from './excel-image-options.js'
import { openImageCopyDialog } from './image-copy-dialog.js'
import { workspaceExportStyle } from './excel-image-style.js'
import { enrichExcelRows } from './excel-carton-evidence.js'
import { createExcelOutputWorkbook } from './excel-output-workbook.js'
import { createPackingWorkbookImages } from './packing-workbook-images.js'
import { preparationCopyFields } from './preparation-clipboard.js'
import { saveFile, announceExport } from './save-file.js'
import {
  excelOutputFileName,
  excelOutputTitle,
} from './excel-output-file-name.js'

/** Capture output values only, never the attached live library records. */
export async function openExcelOutput(
  rows,
  {
    loadImage,
    renderCartonMark,
    signal,
    columns,
    language = getLanguage(),
    badges = createExcelImageBadges(),
    errorOptions,
    evidence = {},
  }
) {
  const keys = [
    ...new Set([
      ...excelImageColumns.map(({ key }) => key),
      'accountId',
      'orderId',
      'sourceType',
      'orderReference',
      'sellerName',
      'sellerMemberLogin',
      'orderDate',
      'orderStatus',
      'entryId',
      'cartonId',
      'groupId',
      'title',
      'variantDescription',
      'manualReordered',
      'orderTags',
      'productTags',
      'skuProperties',
      'material',
    ]),
  ]
  const first = (...values) =>
    values.find(
      (value) => value !== undefined && value !== null && value !== ''
    ) ?? ''
  const frozen = structuredClone(
    rows.map((row) => {
      const fields =
        /^\d+(?:\.\d+)?$/.test(String(row.price)) &&
        /^[1-9]\d*$/.test(String(row.quantity))
          ? preparationCopyFields(row)
          : row
      const values = {
        ...row,
        productNumber: first(row.productNumber, fields.productNumber),
        sourceSize: first(row.sourceSize, fields.sourceSize),
        effectiveUnitPrice: first(row.effectiveUnitPrice, row.price),
        effectiveAmount: first(
          row.effectiveAmount,
          row.lineNetAmount,
          row.sourceAmount,
          fields.lineNetAmount,
          fields.lineAmount
        ),
      }
      return Object.fromEntries(keys.map((key) => [key, values[key]]))
    })
  )
  const frozenEvidence = structuredClone(evidence)
  if (!frozen.length) return false
  let outputLanguage = language,
    table
  const prepareImages = createPackingWorkbookImages(loadImage, renderCartonMark)
  return openImageCopyDialog({
    title: 'Excel...',
    count: frozen.length,
    signal,
    interactivePreview: true,
    languageToggle: true,
    language,
    onLanguageChange: (value) => {
      outputLanguage = value
      table = undefined
    },
    errorOptions,
    createOptions: columns
      ? undefined
      : (onChange) =>
          createExcelImageOptions(
            () => {
              table = undefined
              onChange()
            },
            { rows: frozen }
          ),
    plan: async (signal) => {
      table = undefined
      await document.fonts.ready
      signal.throwIfAborted()
      const preference = readExcelImagePreference()
      const values = enrichExcelRows(frozen, frozenEvidence, {
        language: outputLanguage,
      })
      const options = {
        title: excelOutputTitle(outputLanguage),
        columns: columns || selectedExcelImageColumns(preference),
        showOrderDetails: preference.showOrderDetails,
        style: workspaceExportStyle(),
        details: preference.details,
        badges,
        language: outputLanguage,
      }
      table = planExcelTable(values, options)
      return excelTableImageBatches(table)
    },
    prepare: async (plan, { signal, onProgress }) => {
      const result = await renderExcelImage(plan, {
        loadImage,
        renderCartonMark,
        signal,
        onProgress: ({ completed, total }) =>
          onProgress(
            uiMessage('Creating image {completed}/{total}…', {
              completed,
              total,
            })
          ),
      })
      return { images: [{ blob: result.blob }], payload: result.blob }
    },
    canExport: () => Boolean(table),
    exportWorkbook: async ({ signal }) => {
      const captured = table
      const bytes = await createExcelOutputWorkbook(captured, {
        prepareImages: async (...args) => {
          signal.throwIfAborted()
          const result = await prepareImages(...args)
          signal.throwIfAborted()
          return result
        },
      })
      signal.throwIfAborted()
      const filename = excelOutputFileName(frozen, captured.language)
      saveFile(
        new Blob([bytes], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        filename
      )
      announceExport([filename])
    },
    write: (blob) =>
      navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]),
  })
}
