import { extractOrder } from './extract.js'
import { prepareCsv } from './csv.js'
import { mountPageDownload } from './page-download.js'
import {
  extractOrderSnapshot,
  reviewOrderSnapshot,
  confirmOrderReconciliation,
} from './order-snapshot.js'
import { collectFinancialDiagnostics } from './import-diagnostics.js'
import { openOrderDiscountReview } from './order-discount-review.js'
import { message as m } from './i18n.js'

const controllerKey = Symbol.for('1688topl.detailController')
globalThis[controllerKey]?.()
let disposed = false
let suspended = false
let progressTimer,
  progressQuery = false,
  missingProgress = 0
const importReader = /^#1688to(?:pl|csv)-import=/.test(location.hash)
const reviewContext = /^#1688topl-review=(.+)$/.exec(location.hash)
let reviewJobId
try {
  if (reviewContext) reviewJobId = decodeURIComponent(reviewContext[1])
} catch {
  /* A malformed review context is rejected by the background sender checks. */
}
let openReview
const reviewLifetime = new AbortController()
async function send(type, data = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...data })
  if (!response?.ok)
    throw new Error(
      response?.error || 'Reload the extension and refresh this page.'
    )
  return response.data
}
async function readSnapshot() {
  try {
    const initial = reviewOrderSnapshot(document, location.href)
    if (
      initial.status === 'ready' &&
      initial.snapshot.reconciliationReview?.mode !== 'automatic'
    ) {
      panel.setDiscountReviewRequired(false)
      return initial.snapshot
    }
    const reconciliationReview = await send('ORDER_RECONCILIATION_GET', {
      orderId:
        initial.status === 'ready'
          ? initial.snapshot.orderId
          : initial.review.orderId,
    })
    const snapshot = extractOrderSnapshot(document, location.href, {
      reconciliationReview,
    })
    panel.setDiscountReviewRequired(false)
    return snapshot
  } catch (error) {
    if (error.code === 'ORDER_DISCOUNT_REVIEW_REQUIRED')
      panel.setDiscountReviewRequired(true)
    throw error
  }
}
async function saveSnapshot(snapshot) {
  if (reviewJobId && !snapshot.reconciliationReview)
    throw new Error(
      String(
        m(
          'This order no longer needs discount review. Resume this import from Activity.'
        )
      )
    )
  const result = await send('SNAPSHOT_READY', {
    snapshot,
    save: true,
    ...(reviewJobId ? { reviewJobId } : {}),
  })
  if (result?.saved === false)
    throw new Error('Pause or finish this import before saving this order.')
  return String(
    m('{count} products saved to your spreadsheet.', {
      count: snapshot.items.length,
    })
  )
}
async function reviewDiscounts() {
  if (openReview) return openReview
  const result = reviewOrderSnapshot(document, location.href)
  if (result.status === 'ready') return saveSnapshot(await readSnapshot())
  let savedMessage = ''
  openReview = (async () => {
    const saved = await openOrderDiscountReview({
      document,
      signal: reviewLifetime.signal,
      ...(reviewJobId
        ? {
            unambiguousMessage:
              'This order no longer needs discount review. Cancel and resume this import from Activity.',
          }
        : {}),
      review: result.review,
      readReview: () => reviewOrderSnapshot(document, location.href),
      async onConfirm(fresh, choice) {
        const snapshot = confirmOrderReconciliation(fresh, {
          choice,
          evidenceKey: fresh.evidenceKey,
        })
        savedMessage = await saveSnapshot(snapshot)
        panel.setDiscountReviewRequired(false)
      },
    })
    return saved
      ? savedMessage
      : String(m('Discount review canceled. Nothing was saved.'))
  })()
  try {
    return await openReview
  } finally {
    openReview = null
  }
}
// Hydration is bounded. Read the entire order again for every user action.
async function readReadyOrder() {
  const deadline = Date.now() + 15_000
  let error
  while (!disposed && Date.now() < deadline) {
    try {
      return await readSnapshot()
    } catch (failure) {
      if (failure.retryable === false) throw failure
      error = failure
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  // The page may still be hydrating after this bounded read. Let the importer
  // retry within its existing attempt/time limit without saving partial data.
  throw Object.assign(error || new Error('The order page was closed.'), {
    retryable: !disposed,
  })
}
const panel = mountPageDownload(
  document,
  () => prepareCsv(extractOrder(document, location.href)),
  {
    saveOrder: async () => {
      try {
        return await saveSnapshot(await readSnapshot())
      } catch (error) {
        if (error.code === 'ORDER_DISCOUNT_REVIEW_REQUIRED')
          return reviewDiscounts()
        throw error
      }
    },
    reviewDiscounts,
    openLibrary: async () => {
      await send('OPEN_LIBRARY')
      return 'Workspace opened.'
    },
    pauseImport: (jobId) => send('IMPORT_PAUSE', { jobId }),
    suspend: () => {
      suspended = true
      clearTimeout(progressTimer)
    },
    resume: () => {
      suspended = false
      missingProgress = 0
      void refreshProgress()
    },
    dispose: () => {
      disposed = true
      reviewLifetime.abort()
      clearTimeout(progressTimer)
    },
  }
)
async function refreshProgress() {
  if (disposed || suspended || progressQuery || !importReader) return
  progressQuery = true
  clearTimeout(progressTimer)
  try {
    const job = await send('READER_STATUS')
    if (disposed || suspended) return
    missingProgress = job ? 0 : missingProgress + 1
    panel.updateProgress(job)
  } catch {
    // A disconnected extension must not leave a frozen progress claim on screen.
    panel.updateProgress(null)
    missingProgress += 1
  } finally {
    progressQuery = false
    if (!disposed && !suspended && missingProgress < 3)
      progressTimer = setTimeout(refreshProgress, 1500)
  }
}
void refreshProgress()
function listener(message, sender, respond) {
  if (message.type !== 'DETAIL_READ') return
  ;(async () => {
    try {
      const snapshot = await readReadyOrder()
      if (message.orderId && message.orderId !== snapshot.orderId)
        throw new Error('This page shows a different order.')
      respond({ ok: true, data: snapshot })
    } catch (error) {
      respond({
        ok: false,
        error: error.message,
        retryable: error.retryable === true,
        ...(error.code === 'ORDER_DISCOUNT_REVIEW_REQUIRED'
          ? { code: error.code, reviewRequired: true }
          : {}),
        diagnostics: collectFinancialDiagnostics(
          document,
          location.href,
          chrome.runtime.getManifest().version
        ),
      })
    }
  })()
  return true
}
chrome.runtime.onMessage.addListener(listener)
globalThis[controllerKey] = () => {
  disposed = true
  clearTimeout(progressTimer)
  panel.dispose()
  chrome.runtime.onMessage.removeListener(listener)
}
// Merely opening an unsaved order does not add it. Existing orders refresh.
;(async () => {
  try {
    await send('CONTENT_READY')
    if (importReader) return // The queue owns collection and saving for this tab.
    const snapshot = await readReadyOrder()
    if (!reviewJobId) await send('SNAPSHOT_READY', { snapshot })
  } catch {
    /* Initial hydration is retried by explicit actions. */
  }
})()
