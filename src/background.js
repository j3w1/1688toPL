import { openDatabase } from './database.js'
import { createImportController } from './import-controller.js'
import { detailUrl, isListUrl } from './order-list.js'
import { loadThumbnail } from './images.js'
import { financialDiagnostics } from './import-diagnostics.js'
import { createImportReport, importJobView } from './import-report.js'
import { importProgress } from './import-progress.js'
import { appearanceTokens } from './appearance.js'

const alarmName = 'order-import'
// This lock only orders concurrent events in one worker lifetime. Every job
// checkpoint lives in IndexedDB and is re-read by the controller on every tick.
let tail = Promise.resolve()
function serial(task) {
  const previous = tail
  let release
  tail = new Promise((resolve) => {
    release = resolve
  })
  return (async () => {
    await previous
    try {
      return await task()
    } finally {
      release()
    }
  })()
}

async function broadcast(type) {
  try {
    await chrome.runtime.sendMessage({ type })
  } catch {
    /* The library may be closed. */
  }
}
const changed = () => broadcast('LIBRARY_CHANGED')
const progress = () => broadcast('IMPORT_PROGRESS')
const marker = (id) => `#1688topl-import=${encodeURIComponent(id)}`
const blankUrl = (url) => !url || url === 'about:blank'
const missingTab = (error) =>
  /no tab(?: with (?:id|given id))?\b|invalid tab id|unknown tab id/i.test(
    error?.message || ''
  )
const detailTabUrl = (tab) =>
  detailUrl(tab.pendingUrl) ? tab.pendingUrl : tab.url
function owns(tab, id) {
  try {
    // A blank pending URL can be a browser loading placeholder. A concrete
    // unrelated destination means the user or sign-in flow owns the tab now.
    if (!blankUrl(tab.pendingUrl) && !detailUrl(tab.pendingUrl)) return false
    const url = detailTabUrl(tab)
    return (
      Boolean(detailUrl(url)) &&
      [marker(id), `#1688tocsv-import=${encodeURIComponent(id)}`].includes(
        new URL(url).hash
      )
    )
  } catch {
    return false
  }
}
async function content(tabId, message, frameId = 0) {
  let response
  try {
    response = await chrome.tabs.sendMessage(tabId, message, { frameId })
  } catch (error) {
    if (message.type === 'DETAIL_READ' && missingTab(error))
      throw Object.assign(
        new Error('The import tab was closed or changed. Resume to reopen it.'),
        { readerMissing: true }
      )
    throw Object.assign(
      new Error(
        'The order page is not ready. Refresh it or finish signing in, then resume.'
      ),
      { retryable: true }
    )
  }
  if (!response?.ok)
    throw Object.assign(
      new Error(response?.error || 'The order page did not respond.'),
      {
        retryable: response?.retryable === true,
        ...(response?.reviewRequired === true ||
        response?.code === 'ORDER_DISCOUNT_REVIEW_REQUIRED'
          ? { reviewRequired: true, code: 'ORDER_DISCOUNT_REVIEW_REQUIRED' }
          : {}),
        diagnostics: financialDiagnostics(response?.diagnostics),
      }
    )
  return response.data
}
const browser = {
  async readList(source) {
    await chrome.tabs.get(source.tabId)
    return content(source.tabId, { type: 'LIST_READ' }, source.frameId)
  },
  async changePage(source, page) {
    return content(source.tabId, { type: 'LIST_PAGE', page }, source.frameId)
  },
  async openDetailTab(url, id, options = {}) {
    // The marker is written atomically with tab creation. Reuse it if the
    // worker stopped between creating the tab and saving its numeric ID.
    const existing = (await chrome.tabs.query({})).find((tab) => owns(tab, id))
    const verified = existing && (await this.getDetailTab(existing.id, id))
    if (verified) {
      let stage = 'retargeting'
      try {
        if (detailUrl(detailTabUrl(verified)) !== detailUrl(url))
          await chrome.tabs.update(verified.id, { url: `${url}${marker(id)}` })
        stage = 'cleanup'
        await closeDuplicateReaders(verified.id, url, id)
        await options.checkpoint?.(null, {
          method: 'recovered',
          outcome: 'owned',
          stage,
        })
        return verified.id
      } catch (error) {
        await options.checkpoint?.(null, {
          method: 'recovered',
          outcome: 'api-error',
          stage,
          code: missingTab(error) ? 'MISSING_TAB' : 'BROWSER_API_FAILED',
        })
        if (!missingTab(error)) throw error
        // The owned tab vanished after verification. Use the same bounded
        // creation fallback instead of pausing on its now-stale numeric ID.
      }
    }
    return createReaderTab(url, id, options)
  },
  async navigateDetailTab(tabId, url, id) {
    const tab = await this.getDetailTab(tabId, id)
    if (!tab)
      throw Object.assign(
        new Error('The import tab was closed or changed. Resume to reopen it.'),
        { readerMissing: true }
      )
    if (detailUrl(detailTabUrl(tab)) !== detailUrl(url)) {
      try {
        await chrome.tabs.update(tabId, { url: `${url}${marker(id)}` })
      } catch (error) {
        if (missingTab(error)) error.readerMissing = true
        throw error
      }
    }
  },
  async getDetailTab(tabId, id) {
    let tab
    try {
      tab = await chrome.tabs.get(tabId)
    } catch (error) {
      if (missingTab(error)) return null
      // Browser API failures do not prove that the tab was closed.
      let tabs
      try {
        tabs = await chrome.tabs.query({})
      } catch {
        throw error
      }
      if (!tabs.some((candidate) => candidate.id === tabId)) return null
      throw error
    }
    if (!id) return tab
    if (owns(tab, id)) {
      await closeDuplicateReaders(tab.id, detailUrl(detailTabUrl(tab)), id)
      return {
        ...tab,
        pendingUrl: detailUrl(tab.pendingUrl) ? tab.pendingUrl : undefined,
      }
    }
    if (blankUrl(tab.url) && blankUrl(tab.pendingUrl)) {
      if (tab.status === 'loading') return tab
      throw new Error(
        'The browser did not provide the import tab URL. Refresh the order page, then resume.'
      )
    }
    throw Object.assign(
      new Error(
        'The import tab left its marked order page. Complete sign-in or verification, then resume.'
      ),
      { attention: 'sign-in' }
    )
  },
  async closeDetailTab(tabId, id) {
    const tab = Number.isInteger(tabId)
      ? await this.getDetailTab(tabId)
      : (await chrome.tabs.query({})).find((candidate) => owns(candidate, id))
    // A user-navigated or login tab is left open for the user to finish.
    if (tab && owns(tab, id)) {
      try {
        await chrome.tabs.remove(tab.id)
      } catch (error) {
        if (!missingTab(error)) throw error
      }
    }
  },
  async readDetail(tabId, orderId) {
    return content(tabId, { type: 'DETAIL_READ', orderId })
  },
  async schedule() {
    await chrome.alarms.create(alarmName, { periodInMinutes: 0.5 })
  },
  async unschedule() {
    await chrome.alarms.clear(alarmName)
  },
  changed,
  progress,
}

async function usingRepository(task) {
  const repository = await openDatabase()
  try {
    return await task(
      repository,
      createImportController({ repository, browser })
    )
  } finally {
    repository.close()
  }
}
let pumping = false
let wakeAgain = false
async function pump() {
  if (pumping) {
    wakeAgain = true
    return
  }
  pumping = true
  try {
    do {
      wakeAgain = false
      const result = await serial(() =>
        usingRepository((repository, controller) => controller.tick())
      )
      if (result === 'continue') wakeAgain = true
    } while (wakeAgain)
  } catch (error) {
    // Keep the durable checkpoint and alarm; the next event retries storage or
    // browser failures without reporting the job as successfully completed.
    console.error('Import could not advance:', error.message)
  } finally {
    pumping = false
  }
}

/**
 * Prefer a background reader, then an unfocused window. Restricted browsers
 * can require a visible tab; use it automatically to complete the same import.
 */
async function closeDuplicateReaders(keepId, url, jobId) {
  for (const tab of await chrome.tabs.query({})) {
    if (
      tab.id === keepId ||
      !owns(tab, jobId) ||
      detailUrl(detailTabUrl(tab)) !== detailUrl(url)
    )
      continue
    // Recheck ownership immediately before cleanup; leave user/login tabs alone.
    let current
    try {
      current = await chrome.tabs.get(tab.id)
    } catch (error) {
      if (missingTab(error)) continue
      throw error
    }
    if (
      !owns(current, jobId) ||
      detailUrl(detailTabUrl(current)) !== detailUrl(url)
    )
      continue
    try {
      await chrome.tabs.remove(current.id)
    } catch (error) {
      if (!missingTab(error)) throw error
    }
  }
}

async function createReaderTab(
  url,
  jobId,
  { attempt, checkpoint = async () => {} } = {}
) {
  const target = `${url}${marker(jobId)}`
  const methods = [
    ['background', () => chrome.tabs.create({ url: target, active: false })],
    [
      'window',
      async () =>
        (await chrome.windows.create({ url: target, focused: false }))
          ?.tabs?.[0],
    ],
    ['visible', () => chrome.tabs.create({ url: target, active: true })],
  ]
  const checks = [0, 100, 250, 500, 1000, 2000]
  let lastError
  const start = Math.max(
    0,
    methods.findIndex(([method]) => method === attempt?.method)
  )
  for (let index = start; index < methods.length; index++) {
    const [method, create] = methods[index]
    let currentAttempt = attempt?.method === method ? attempt : null
    let stage = 'creating'
    try {
      if (!currentAttempt) {
        currentAttempt = {
          method,
          stage: 'creating',
          check: -1,
          startedAt: new Date().toISOString(),
        }
        await checkpoint(currentAttempt, { method, outcome: 'creating', stage })
        const tab = await create()
        if (!Number.isInteger(tab?.id))
          throw new Error('The browser did not create an import tab.')
        currentAttempt = {
          ...currentAttempt,
          stage: 'registering',
          tabId: tab.id,
        }
        // Persist the provisional ID before its first registration lookup.
        await checkpoint(currentAttempt)
      }
      stage = 'registering'
      for (
        let check = Math.max(0, currentAttempt.check + 1);
        check < checks.length;
        check++
      ) {
        const elapsed = Date.now() - Date.parse(currentAttempt.startedAt)
        const delay = Math.max(0, checks[check] - elapsed)
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
        let tab
        try {
          if (Number.isInteger(currentAttempt.tabId))
            tab = await chrome.tabs.get(currentAttempt.tabId)
        } catch (error) {
          if (!missingTab(error)) throw error
          lastError = error
        }
        const exact = (await chrome.tabs.query({})).find(
          (candidate) =>
            owns(candidate, jobId) &&
            detailUrl(detailTabUrl(candidate)) === detailUrl(url)
        )
        // A concrete unowned destination on the returned ID belongs to the user.
        if (
          tab &&
          !(
            owns(tab, jobId) && detailUrl(detailTabUrl(tab)) === detailUrl(url)
          ) &&
          !(blankUrl(tab.url) && blankUrl(tab.pendingUrl))
        ) {
          await checkpoint(
            { ...currentAttempt, check },
            {
              method,
              check,
              outcome: 'navigated',
              elapsedMs: checks[check],
              stage,
              code: 'NAVIGATED',
            }
          )
          throw Object.assign(
            new Error(
              'The import tab left its marked order page. Complete sign-in or verification, then resume.'
            ),
            { attention: 'sign-in' }
          )
        }
        if (exact) tab = exact
        const owned =
          tab &&
          owns(tab, jobId) &&
          detailUrl(detailTabUrl(tab)) === detailUrl(url)
        currentAttempt = {
          ...currentAttempt,
          check,
          ...(owned ? { tabId: tab.id } : {}),
        }
        await checkpoint(currentAttempt, {
          method,
          check,
          outcome: owned ? 'owned' : tab ? 'blank' : 'missing',
          elapsedMs: checks[check],
          stage,
          ...(!tab ? { code: 'MISSING_TAB' } : {}),
        })
        if (owned) {
          stage = 'cleanup'
          await closeDuplicateReaders(tab.id, url, jobId)
          try {
            await chrome.tabs.update(tab.id, { autoDiscardable: false })
          } catch {}
          return { id: tab.id, visible: method === 'visible' }
        }
      }
      stage = 'cleanup'
      if (Number.isInteger(currentAttempt.tabId)) {
        let unfinished
        try {
          unfinished = await chrome.tabs.get(currentAttempt.tabId)
        } catch (error) {
          if (!missingTab(error)) throw error
        }
        if (
          unfinished &&
          blankUrl(unfinished.url) &&
          blankUrl(unfinished.pendingUrl)
        ) {
          try {
            await chrome.tabs.remove(unfinished.id)
          } catch (error) {
            if (!missingTab(error)) throw error
          }
        }
      }
      await checkpoint(currentAttempt, {
        method,
        outcome: 'missing',
        stage: 'registering',
        code: 'REGISTRATION_TIMEOUT',
        elapsedMs: 2000,
      })
      lastError = new Error('No tab retained its import marker.')
    } catch (error) {
      lastError = error
      if (error.attention) throw error
      await checkpoint(currentAttempt, {
        method,
        outcome: 'api-error',
        stage,
        code: missingTab(error)
          ? 'MISSING_TAB'
          : stage === 'creating'
            ? 'CREATION_FAILED'
            : 'BROWSER_API_FAILED',
      })
      // Unsupported creation methods allow fallback; unrelated inspection errors do not.
      if (currentAttempt?.stage === 'registering' && !missingTab(error))
        throw error
    }
    attempt = null
  }
  if (!missingTab(lastError)) throw lastError
  throw Object.assign(
    new Error(
      'The browser could not keep an import tab open. Pending orders are preserved. Open a regular browser window, then resume.'
    ),
    { code: 'IMPORT_READER_UNAVAILABLE', cause: lastError }
  )
}

/** Bring the tab that needs a sign-in or verification forward, on request only. */
async function openAttentionTab(job) {
  const tabId = job?.attention?.tabId
  if (!Number.isInteger(tabId))
    throw new Error('This import does not need a sign-in or verification.')
  let tab
  try {
    tab = await chrome.tabs.get(tabId)
  } catch {
    throw new Error(
      'The 1688 tab was closed. Resume the import to open the order again.'
    )
  }
  await chrome.tabs.update(tabId, { active: true })
  if (Number.isInteger(tab.windowId))
    await chrome.windows?.update?.(tab.windowId, { focused: true })
  return { tabId }
}

async function openLibrary() {
  const url = chrome.runtime.getURL('library.html')
  const existing = (await chrome.tabs.query({})).find((tab) => tab.url === url)
  if (existing) return chrome.tabs.update(existing.id, { active: true })
  return chrome.tabs.create({ url, active: true })
}
function isExtensionPage(sender) {
  return (
    sender.id === chrome.runtime.id &&
    sender.url?.startsWith(chrome.runtime.getURL(''))
  )
}
function requireContent(sender, kind) {
  if (
    sender.id !== chrome.runtime.id ||
    !Number.isInteger(sender.tab?.id) ||
    !(kind === 'list' ? isListUrl(sender.url) : detailUrl(sender.url))
  ) {
    throw new Error('This action must start on a supported 1688 order page.')
  }
}
function sameSource(job, sender) {
  return (
    job.source?.tabId === sender.tab?.id &&
    (job.source?.frameId ?? 0) === (sender.frameId ?? 0)
  )
}
function jobStatus(job) {
  const reviewOrder = job.orders.find(
    (order) => order.state === 'failed' && order.reviewRequired === true
  )
  return {
    ...importProgress(job),
    ...(reviewOrder ? { reviewOrderId: reviewOrder.orderId } : {}),
    error:
      job.error ||
      (job.state !== 'running' &&
        job.orders.find(
          (order) => order.state === 'failed' && order.reviewRequired !== true
        )?.error) ||
      '',
  }
}
function sameReader(job, sender) {
  return (
    job.workerTabId === sender.tab?.id &&
    typeof job.currentOrderId === 'string' &&
    (sender.frameId ?? 0) === 0 &&
    owns({ url: sender.url }, job.id) &&
    Boolean(detailUrl(sender.url, job.currentOrderId))
  )
}
async function dispatch(message, sender, repository, controller) {
  if (!message || typeof message.type !== 'string')
    throw new Error('Unknown extension action.')
  switch (message.type) {
    case 'WORKSPACE_APPEARANCE_GET':
      if (!isExtensionPage(sender))
        requireContent(sender, isListUrl(sender.url) ? 'list' : 'detail')
      return workspaceAppearance(repository)
    case 'OPEN_LIBRARY':
      if (
        !isExtensionPage(sender) &&
        !isListUrl(sender.url) &&
        !detailUrl(sender.url)
      )
        throw new Error('Unsupported source page.')
      return openLibrary()
    case 'OPEN_LIBRARY_HERE': {
      requireContent(sender, isListUrl(sender.url) ? 'list' : 'detail')
      const tabId = sender.tab.id
      if (
        (await repository.listJobs()).some(
          (job) =>
            job.state === 'running' &&
            (job.source?.tabId === tabId || job.workerTabId === tabId)
        )
      )
        throw new Error(
          'Pause or finish this import before opening the spreadsheet in this tab.'
        )
      return chrome.tabs.update(tabId, {
        url: chrome.runtime.getURL('library.html'),
        active: true,
      })
    }
    case 'CONTENT_READY':
      requireContent(sender, 'detail')
      return true
    case 'ORDER_RECONCILIATION_GET': {
      requireContent(sender, 'detail')
      if (
        typeof message.orderId !== 'string' ||
        !detailUrl(sender.url, message.orderId)
      )
        throw new Error('The review does not match this order page.')
      const record = await repository.getOrder(message.orderId, {
        accountId: 'local',
      })
      return record?.snapshot.accountId === 'local'
        ? record.snapshot.reconciliationReview || null
        : null
    }
    case 'SNAPSHOT_READY': {
      requireContent(sender, 'detail')
      if (
        !detailUrl(sender.url, message.snapshot?.orderId) ||
        message.snapshot?.accountId !== 'local'
      )
        throw new Error('The snapshot does not match this order page.')
      if (message.reviewJobId !== undefined) {
        if (
          message.save !== true ||
          typeof message.reviewJobId !== 'string' ||
          !message.reviewJobId ||
          new URL(sender.url).hash !==
            `#1688topl-review=${encodeURIComponent(message.reviewJobId)}`
        )
          throw new Error('Open this order from its import discount review.')
        return controller.confirmReviewedOrder(
          message.reviewJobId,
          message.snapshot
        )
      }
      // Import snapshots are committed only after the queued completeness check.
      const jobs = await repository.listJobs()
      if (
        jobs.some(
          (job) => job.workerTabId === sender.tab.id && job.state === 'running'
        )
      )
        return { saved: false }
      if (
        message.save !== true &&
        !(await repository.getOrder(message.snapshot.orderId))
      )
        return { saved: false }
      const result = await repository.saveSnapshot(message.snapshot)
      await changed()
      return result
    }
    case 'IMPORT_START':
      requireContent(sender, 'list')
      return controller.start({
        scope: message.scope,
        orderIds: message.orderIds,
        expectedScope: message.expectedScope,
        source: { tabId: sender.tab.id, frameId: sender.frameId ?? 0 },
      })
    case 'IMPORT_STATUS':
      requireContent(sender, 'list')
      return {
        jobs: (await repository.listJobs())
          .filter((job) => !job.dismissedAt && sameSource(job, sender))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map(jobStatus),
      }
    case 'READER_STATUS': {
      requireContent(sender, 'detail')
      const job = (await repository.listJobs()).find(
        (candidate) =>
          candidate.state === 'running' && sameReader(candidate, sender)
      )
      return job ? jobStatus(job) : null
    }
    case 'IMPORT_REPORT': {
      requireContent(sender, 'list')
      const job =
        typeof message.jobId === 'string'
          ? await repository.getJob(message.jobId)
          : undefined
      if (!job)
        throw new Error(
          'This import is no longer available. Refresh the order list.'
        )
      if (!sameSource(job, sender))
        throw new Error('This import belongs to another order-list tab.')
      return createImportReport(job, chrome.runtime.getManifest().version)
    }
    case 'IMPORT_REVIEW_OPEN': {
      const job = await repository.getJob(message.jobId)
      if (!isExtensionPage(sender)) {
        requireContent(sender, 'list')
        if (!job || !sameSource(job, sender))
          throw new Error('This import belongs to another order-list tab.')
      }
      const order = job?.orders.find((item) => item.orderId === message.orderId)
      const sourceUrl = detailUrl(order?.sourceUrl, message.orderId)
      if (
        job?.accountId !== 'local' ||
        order?.state !== 'failed' ||
        order.reviewRequired !== true ||
        !sourceUrl
      )
        throw new Error('This order no longer needs a discount review.')
      const tab = await chrome.tabs.create({
        url: `${sourceUrl}#1688topl-review=${encodeURIComponent(job.id)}`,
        active: true,
      })
      return { tabId: tab.id }
    }
    case 'IMPORT_PAUSE':
    case 'IMPORT_RESUME': {
      if (!isExtensionPage(sender)) {
        const readerPause =
          message.type === 'IMPORT_PAUSE' && detailUrl(sender.url)
        requireContent(sender, readerPause ? 'detail' : 'list')
        const job = await repository.getJob(message.jobId)
        if (
          !job ||
          !(readerPause ? sameReader(job, sender) : sameSource(job, sender))
        )
          throw new Error('This import belongs to another tab.')
      }
      return message.type === 'IMPORT_PAUSE'
        ? controller.pause(message.jobId)
        : controller.resume(message.jobId)
    }
  }
  if (!isExtensionPage(sender))
    throw new Error('Open the extension spreadsheet to use this action.')
  switch (message.type) {
    case 'WORKSPACE_APPEARANCE_CHANGED': {
      await repository.setWorkspaceColorScheme(message.colorScheme)
      const data = await workspaceAppearance(repository)
      await Promise.allSettled(
        (await chrome.tabs.query({}))
          .filter((tab) => isListUrl(tab.url) || detailUrl(tab.url))
          .map((tab) =>
            chrome.tabs.sendMessage(tab.id, {
              type: 'WORKSPACE_APPEARANCE',
              data,
            })
          )
      )
      return true
    }
    case 'LIBRARY_UPDATED':
      await changed()
      return true
    case 'OTHER_ORDER_CREATE': {
      const result = await repository.createOtherOrder(message.order)
      await changed()
      return result
    }
    case 'LIBRARY_QUERY':
      return {
        orders: await repository.listOrders(),
        jobs: (await repository.listJobs()).map(importJobView),
      }
    case 'IMPORT_ATTENTION_OPEN':
      return openAttentionTab(await repository.getJob(message.jobId))
    case 'JOBS_QUERY':
      return { jobs: (await repository.listJobs()).map(importJobView) }
    case 'LIBRARY_HISTORY':
      return repository.getHistory(message.orderId)
    case 'LIBRARY_REVIEW_REMOVAL':
      return repository.reviewOrderRemoval(message.orderIds, {
        accountId: message.accountId || 'local',
      })
    case 'IMAGE_GET':
      return loadThumbnail(message.url, repository)
    case 'BACKUP_EXPORT':
      return repository.exportBackup()
    case 'REFRESH_ORDERS':
      return controller.refresh(message.orderIds)
    case 'IMPORT_DISMISS':
      return controller.dismiss(message.jobId)
    case 'LIBRARY_NOTES': {
      const result = await repository.setNotes(message.orderId, {
        notes: message.notes,
        tags: message.tags,
      })
      await changed()
      return result
    }
    case 'LIBRARY_REMOVE':
    case 'BACKUP_RESTORE': {
      if ((await repository.listJobs()).some((job) => job.state === 'running'))
        throw new Error(
          'Pause the import before removing orders or restoring a backup.'
        )
      const result =
        message.type === 'LIBRARY_REMOVE'
          ? await repository.removeOrders(message.orderIds, {
              accountId: message.accountId || 'local',
            })
          : await repository.restoreBackup(message.backup)
      await changed()
      return result
    }
    default:
      throw new Error('Unknown extension action.')
  }
}

async function workspaceAppearance(repository) {
  const { appearance, colorScheme } = await repository.getWorkspaceDisplay()
  return {
    colorScheme,
    light: appearanceTokens(appearance, 'light'),
    dark: appearanceTokens(appearance, 'dark'),
  }
}

// Register listeners synchronously so events can wake a terminated worker.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (['LIBRARY_CHANGED', 'IMPORT_PROGRESS'].includes(message?.type)) return
  ;(async () => {
    try {
      const run = () =>
        usingRepository((repository, controller) =>
          dispatch(message, sender, repository, controller)
        )
      // Display preferences, thumbnails and read-only views do not use import state.
      const data = [
        'IMAGE_GET',
        'WORKSPACE_APPEARANCE_GET',
        'ORDER_RECONCILIATION_GET',
        'WORKSPACE_APPEARANCE_CHANGED',
        'LIBRARY_QUERY',
        'JOBS_QUERY',
        'IMPORT_STATUS',
        'READER_STATUS',
        'IMPORT_REPORT',
        'LIBRARY_HISTORY',
        'LIBRARY_REVIEW_REMOVAL',
        'BACKUP_EXPORT',
      ].includes(message.type)
        ? await run()
        : await serial(run)
      respond({ ok: true, data })
      if (
        [
          'IMPORT_START',
          'IMPORT_RESUME',
          'REFRESH_ORDERS',
          'CONTENT_READY',
          'IMPORT_PAUSE',
        ].includes(message.type)
      )
        void pump()
    } catch (error) {
      respond({ ok: false, error: error.message })
    }
  })()
  return true
})
chrome.action.onClicked.addListener(() => {
  void openLibrary().catch((error) => console.error(error.message))
})
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === alarmName) void pump()
})
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'complete') void pump()
})
chrome.tabs.onRemoved.addListener((tabId) => {
  void serial(() =>
    usingRepository((repository, controller) => controller.removedTab(tabId))
  ).catch((error) => console.error(error.message))
})
function startup() {
  void serial(() =>
    usingRepository((repository, controller) => controller.startup())
  ).catch((error) => console.error(error.message))
}
chrome.runtime.onStartup.addListener(startup)
chrome.runtime.onInstalled.addListener(startup)
