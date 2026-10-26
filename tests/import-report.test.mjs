import test from 'node:test'
import assert from 'node:assert/strict'
import { createImportReport, importJobView } from '../src/import-report.js'

test('reader reports bound and sanitize lifecycle evidence without exposing provisional IDs or API text', () => {
  const job = {
    orders: [],
    readerAttempt: {
      tabId: 8001,
      sourceUrl: 'https://private.invalid/',
      check: 4,
    },
    readerDiagnostics: Array.from({ length: 40 }, () => ({
      method: 'background',
      outcome: 'missing',
      stage: 'registering',
      code: 'MISSING_TAB',
      check: 2,
      elapsedMs: 250,
      tabId: 8001,
      error: 'private API text',
    })),
  }
  job.readerDiagnostics.push({ method: 'private', outcome: 'missing' })
  const report = createImportReport(job, 'test')
  assert.equal(report.job.readerDiagnostics.length, 23)
  assert.deepEqual(report.job.readerDiagnostics[0], {
    method: 'background',
    outcome: 'missing',
    stage: 'registering',
    code: 'MISSING_TAB',
    check: 2,
    elapsedMs: 250,
  })
  assert.doesNotMatch(JSON.stringify(report), /tabId|private|8001|sourceUrl/)
  assert.equal(importJobView(job).readerAttempt, undefined)
  assert.equal(importJobView(job).readerDiagnostics, undefined)
  const invalid = createImportReport(
    {
      orders: [],
      readerDiagnostics: [
        {
          method: 'background',
          outcome: 'api-error',
          stage: 'private URL',
          code: 'private error text',
        },
      ],
    },
    'test'
  )
  assert.deepEqual(invalid.job.readerDiagnostics, [
    { method: 'background', outcome: 'api-error' },
  ])
})

test('import reports retain every failure and separate discovery from successful saves', () => {
  const job = {
    id: 'synthetic-job',
    kind: 'import',
    scope: 'all',
    state: 'paused',
    phase: 'scan',
    page: 2,
    pageSize: 10,
    total: 667,
    filterKey: 'private search contents',
    source: { tabId: 42 },
    orders: Array.from({ length: 20 }, (_, i) => ({
      orderId: String(10000 + i),
      sourceUrl: `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${10000 + i}&spm=tracking`,
      state: i < 4 ? 'failed' : i < 10 ? 'done' : 'pending',
      error: i < 4 ? 'Unsupported order total: example.' : '',
      expectedRows: 2,
      privateField: 'not part of diagnostics',
    })),
  }
  const before = structuredClone(job)
  const report = createImportReport(
    job,
    'test-version',
    '2026-10-14T00:00:00.000Z'
  )
  assert.deepEqual(report.counts, {
    expected: 667,
    discovered: 20,
    saved: 6,
    failed: 4,
    pending: 10,
    undiscovered: 647,
    remaining: 661,
  })
  assert.equal(report.job.totalPages, 67)
  assert.equal(report.job.scannedPages, 2)
  assert.equal(report.orders.length, 20)
  assert.deepEqual(report.errors, [
    { message: 'Unsupported order total: example.', count: 4 },
  ])
  assert.equal(report.extensionVersion, 'test-version')
  const serialized = JSON.stringify(report)
  assert.doesNotMatch(serialized, /private|tabId|tracking/)
  assert.deepEqual(job, before)
})

test('an undiscovered legacy queue is not reported as complete and invalid links are excluded', () => {
  const report = createImportReport(
    { total: 667, page: 67, orders: [] },
    'test'
  )
  assert.equal(report.counts.remaining, 667)
  assert.equal(report.counts.saved, 0)
  const invalid = createImportReport(
    {
      orders: [
        {
          orderId: '10001',
          sourceUrl: 'https://example.test/',
          state: 'failed',
        },
      ],
    },
    'test'
  )
  assert.equal(invalid.orders[0].sourceUrl, null)
})
