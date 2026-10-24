import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeCartonMeasurement,
  formatCartonMeasurement,
} from '../src/carton-details.js'

test('measurement decimals preserve precision, accept decimal commas and distinguish unknown from zero', () => {
  for (const field of ['kg', 'cbm']) {
    for (const [input, expected] of [
      [undefined, ''],
      [null, ''],
      ['', ''],
      ['  ', ''],
      [0, '0'],
      ['0.000', '0'],
      [' 020,5000 ', '20.5'],
      ['.25', '0.25'],
      [',001000', '0.001'],
      ['0.000000000000000123456789', '0.000000000000000123456789'],
      ['12345678901234567890.987654321', '12345678901234567890.987654321'],
    ])
      assert.equal(normalizeCartonMeasurement(input, field), expected)
    for (const input of [
      -1,
      true,
      [],
      {},
      Infinity,
      NaN,
      '-1',
      '+2',
      '1e2',
      '20kg',
      '1 200',
      '1,200.5',
      '1.200,5',
      '1,000,000',
      '1.000.000',
      '.',
      ',',
      '20.',
      '20,',
    ])
      assert.throws(
        () => normalizeCartonMeasurement(input, field),
        /nonnegative decimal/
      )
  }
  assert.throws(() => normalizeCartonMeasurement('2', 'boxes'), /Unknown/)
  assert.equal(formatCartonMeasurement('20.500', 'kg'), '20.5 kg')
  assert.equal(formatCartonMeasurement('0,1050', 'cbm'), '0.105 m³')
  assert.equal(formatCartonMeasurement(null, 'kg'), '—')
})
