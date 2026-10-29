import { SYNTHETIC_PHOTO } from './container-fixture.mjs'
import { centsToMoney, lineGrossCents } from '../../src/money.js'

/** Synthetic equivalent of a full supplier revision; no owner workbook data. */
export function storeCartonCountUpdate(updated = false) {
  const rows = Array.from({ length: 52 }, (_, index) => {
    let boxes = 4,
      perbox = 25,
      price = index === 2 ? '3.93' : '4.00'
    if (index === 0) {
      boxes = 1
      perbox = updated ? 10 : 19
      price = '3.00'
    } else if (index === 1) {
      boxes = 5
      perbox = updated ? 5 : 10
      price = '6.00'
    } else if (index === 41 || index === 45) {
      boxes = updated ? 4 : index === 41 ? 6 : 5
      perbox = 18
      price = '4.50'
    } else if (index === 50) perbox = 32
    else if (index === 51) {
      boxes = 17
      perbox = 32
      price = '3.95'
    }
    const quantity = boxes * perbox
    return {
      row: index + (updated ? 12 : 4),
      group: String(index + 1),
      title: `Synthetic ceramic vessel ${index + 1}`,
      description: `Synthetic ceramic vessel ${index + 1}`,
      productNumber: `SYN-${index + 1}`,
      variants: [],
      boxes,
      perbox,
      quantity,
      price,
      amount: centsToMoney(lineGrossCents(price, String(quantity))),
      photos: [SYNTHETIC_PHOTO],
      ...(updated
        ? {
            kg: '13.87',
            cbm: '0.0271728',
            sourceCbm: '0.027',
            len: '37',
            wid: '27',
            ht: '27.2',
          }
        : {}),
    }
  })
  return {
    filename: '4321.xlsx',
    sheetName: 'Products',
    purchaseDate: '2026-10-19',
    store: {
      key: 'market:4321',
      name: 'Synthetic market',
      number: '4321',
      kind: 'market',
    },
    rows,
    total: centsToMoney(
      rows.reduce(
        (sum, row) => sum + lineGrossCents(row.price, String(row.quantity)),
        0n
      )
    ),
  }
}
