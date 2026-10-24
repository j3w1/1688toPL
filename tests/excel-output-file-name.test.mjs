import test from 'node:test'
import assert from 'node:assert/strict'
import { excelOutputFileName } from '../src/excel-output-file-name.js'

for (const language of ['en', 'es', 'zh'])
  test(`${language} filename uses only the store and requested suffix`, () => {
    const rows = [
      { sellerName: '小家园', orderId: '1234567890' },
      { sellerName: '小家园', orderId: '99999999' },
    ]
    const expected = '小家园_货清单.xlsx'
    assert.equal(excelOutputFileName(rows, language), expected)
    assert.equal(excelOutputFileName(rows, language), expected)
  })
test('file-safe store spelling preserves Chinese names and cannot add path components', () => {
  assert.equal(
    excelOutputFileName([{ sellerName: '商店/分店:新款' }], 'zh'),
    '商店-分店-新款_货清单.xlsx'
  )
  assert.equal(
    excelOutputFileName([{ sellerMemberLogin: 'seller-login' }]),
    'seller-login_货清单.xlsx'
  )
})
for (const [language, suffix] of [
  ['en', 'list'],
  ['es', 'lista'],
  ['zh', '货清单'],
])
  test(`${language} multiple stores use only the local date and localized list suffix`, () => {
    const rows = [{ sellerName: 'Store A' }, { sellerName: 'Store B' }]
    assert.equal(
      excelOutputFileName(rows, language, new Date(2026, 9, 24, 12)),
      `2026-10-24-${suffix}.xlsx`
    )
    assert.equal(
      excelOutputFileName(
        [
          { sellerName: 'Same', sellerMemberLogin: 'a' },
          { sellerName: 'Same', sellerMemberLogin: 'b' },
        ],
        language,
        new Date(2026, 9, 24)
      ),
      `2026-10-24-${suffix}.xlsx`
    )
  })
