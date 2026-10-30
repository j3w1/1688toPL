import { png, workbookFile } from './store-workbook-fixture.mjs'

export const EVEN_SPLIT_EXPECTED = [
  [225, 225, 225, 225],
  [200, 200, 200],
  [150, 150, 150, 150],
  [129, 129, 129, 129, 128, 128, 128],
  [200, 200, 200],
  [200, 200, 200],
  [200, 200, 200],
  [200, 200, 200],
]

export function evenVariantSplitInput() {
  return {
    filename: '8765.xlsx',
    sheetName: 'Products',
    purchaseDate: '2026-10-20',
    store: { key: 'market:8765', kind: 'market', number: '8765', name: '8765' },
    total: '10740.00',
    rows: ['abcd', 'abc', 'abcd', 'abcdefg', 'abc', 'abc', 'abc', 'abc'].map(
      (declaration, index) => {
        const boxes = [3, 2, 2, 3, 2, 2, 2, 2][index],
          quantity = boxes * 300,
          price = index < 4 ? '1.90' : '2.10'
        return {
          row: 19 + index,
          group: String(index + 1),
          description: `Synthetic table mat ${index + 1}`,
          boxes,
          perbox: 300,
          quantity,
          price,
          amount: (quantity * Number(price)).toFixed(2),
          cbm: '0.05',
          photos: [`data:image/png;base64,${png.toString('base64')}`],
          variants: [...declaration].map((variant) => ({
            variant: variant.toUpperCase(),
            size: '',
          })),
        }
      }
    ),
  }
}

export function evenVariantWorkbook({ additionalSheets = [] } = {}) {
  const input = evenVariantSplitInput()
  return workbookFile({
    name: input.filename,
    additionalSheets,
    rows: [
      [
        'pic',
        'desc',
        'boxes',
        'perbox',
        'price',
        'amount',
        'group',
        'var',
        'cbm',
      ],
      ...Array.from({ length: 17 }, () => []),
      ...input.rows.map((row) => [
        '',
        row.description,
        row.boxes,
        row.perbox,
        row.price,
        row.amount,
        row.group,
        row.variants
          .map((entry) => entry.variant)
          .join('')
          .toLowerCase(),
        row.cbm,
      ]),
      ['total', Number(input.total), 'total'],
    ],
    photoSpans: [{ from: 18, to: 26 }],
  })
}
