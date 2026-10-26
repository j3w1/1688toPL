import { detailUrl } from './order-list.js'
import { financialDiagnostics } from './import-diagnostics.js'

/** Reader diagnostics contain lifecycle categories only, never page/API text. */
export function readerDiagnostics(input) {
  if (!Array.isArray(input)) return []
  return input.slice(-24).flatMap((entry) =>
    ['background', 'window', 'visible', 'recovered'].includes(entry?.method) &&
    [
      'creating',
      'missing',
      'blank',
      'owned',
      'navigated',
      'api-error',
      'duplicate-closed',
    ].includes(entry?.outcome)
      ? [
          {
            method: entry.method,
            outcome: entry.outcome,
            ...(['creating', 'registering', 'retargeting', 'cleanup'].includes(
              entry.stage
            )
              ? { stage: entry.stage }
              : {}),
            ...([
              'MISSING_TAB',
              'CREATION_FAILED',
              'BROWSER_API_FAILED',
              'NAVIGATED',
              'REGISTRATION_TIMEOUT',
            ].includes(entry.code)
              ? { code: entry.code }
              : {}),
            ...(Number.isInteger(entry.check) &&
            entry.check >= 0 &&
            entry.check <= 5
              ? { check: entry.check }
              : {}),
            ...(Number.isFinite(entry.elapsedMs)
              ? {
                  elapsedMs: Math.max(
                    0,
                    Math.min(60000, Math.round(entry.elapsedMs))
                  ),
                }
              : {}),
          },
        ]
      : []
  )
}

/** Progress views omit saved evidence; report export reads the full job locally. */
export function importJobView(job) {
  const { readerAttempt, readerDiagnostics: diagnostics, ...view } = job
  return {
    ...view,
    orders: (job.orders || []).map(({ lastFailure, ...order }) => order),
  }
}

/** A local diagnostic snapshot; deliberately excludes page content and filters. */
export function createImportReport(
  job,
  extensionVersion,
  exportedAt = new Date().toISOString()
) {
  const orders = (job.orders || []).map((order) => ({
    orderId: order.orderId,
    sourceUrl: detailUrl(order.sourceUrl, order.orderId),
    state: order.state,
    expectedRows: order.expectedRows ?? null,
    error: order.error || '',
    ...(order.lastFailure
      ? {
          lastFailure: {
            at: String(order.lastFailure.at || '').slice(0, 32),
            message: String(order.lastFailure.message || '').slice(0, 500),
            diagnostics: financialDiagnostics(order.lastFailure.diagnostics),
          },
        }
      : {}),
  }))
  const saved = orders.filter((order) => order.state === 'done').length
  const failed = orders.filter((order) => order.state === 'failed').length
  const expected = Math.max(job.total || 0, orders.length)
  const errors = new Map()
  for (const order of orders.filter((order) => order.state === 'failed')) {
    const message = order.error || 'Could not read order'
    errors.set(message, (errors.get(message) || 0) + 1)
  }
  return {
    format: '1688-import-report',
    version: 1,
    extensionVersion,
    exportedAt,
    job: {
      id: job.id,
      kind: job.kind,
      scope: job.scope,
      state: job.state,
      phase: job.phase,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      scannedPages: job.page || 0,
      totalPages:
        job.scope === 'all' && job.pageSize
          ? Math.ceil(expected / job.pageSize)
          : null,
      error: job.error || '',
      ...(readerDiagnostics(job.readerDiagnostics).length
        ? { readerDiagnostics: readerDiagnostics(job.readerDiagnostics) }
        : {}),
    },
    counts: {
      expected,
      discovered: orders.length,
      saved,
      failed,
      pending: orders.filter((order) => order.state === 'pending').length,
      undiscovered: expected - orders.length,
      remaining: expected - saved,
    },
    errors: [...errors].map(([message, count]) => ({ message, count })),
    orders,
  }
}
