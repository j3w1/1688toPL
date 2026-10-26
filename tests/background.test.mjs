import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createImportController } from '../src/import-controller.js'
import { detailUrl, isListUrl } from '../src/order-list.js'
import { createImportReport, importJobView } from '../src/import-report.js'
import { financialDiagnostics } from '../src/import-diagnostics.js'
import { importProgress } from '../src/import-progress.js'
import { appearanceTokens } from '../src/appearance.js'
import {
  planOrderReconciliation,
  confirmOrderReconciliation,
} from '../src/order-reconciliation.js'

const sourceCode = (
  await readFile(new URL('../src/background.js', import.meta.url), 'utf8')
).replace(/^import .*\r?\n/gm, '')
const origin = 'chrome-extension://synthetic/'
const listUrl =
  'https://air.1688.com/app/ctf-page/trade-order-list/buyer-order-list.html'
const url = (id) =>
  `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${id}`
const own = { id: 'synthetic', url: origin + 'inspector.html' }
const sender = { id: 'synthetic', url: listUrl, tab: { id: 7 }, frameId: 2 }
function event() {
  const listeners = []
  return {
    listeners,
    addListener: (listener) => listeners.push(listener),
    emit(...args) {
      for (const listener of listeners) listener(...args)
    },
  }
}
function setup({
  orderIds = ['10001'],
  rejectInactive = false,
  registrationWait,
} = {}) {
  const jobs = new Map(),
    tabs = new Map([[7, { id: 7, url: listUrl, status: 'complete' }]]),
    saved = new Map(),
    calls = []
  const display = { colorScheme: 'dark', appearance: {} }
  let adapter,
    tabSequence = 10
  const repository = {
    close() {},
    async getJob(id) {
      return structuredClone(jobs.get(id))
    },
    async putJob(job) {
      jobs.set(job.id, structuredClone(job))
    },
    async listJobs() {
      return structuredClone([...jobs.values()])
    },
    async listOrders() {
      return [...saved.values()]
    },
    async getOrder(id) {
      return saved.get(id)
    },
    async saveSnapshot(snapshot) {
      const value = { snapshot }
      saved.set(snapshot.orderId, value)
      return value
    },
    async setNotes(id, value) {
      calls.push(['notes', id, value])
      return value
    },
    async restoreBackup(value) {
      calls.push(['restore', value])
      return { imported: 0 }
    },
    async exportBackup() {
      return {}
    },
    async getWorkspaceDisplay() {
      return structuredClone(display)
    },
    async setWorkspaceColorScheme(colorScheme) {
      if (!['light', 'dark', 'system'].includes(colorScheme))
        throw new Error('The workspace color scheme is invalid.')
      display.colorScheme = colorScheme
    },
  }
  const chrome = {
    runtime: {
      id: 'synthetic',
      getURL: (path) => origin + path,
      getManifest: () => ({ version: '2.2.5' }),
      onMessage: event(),
      onStartup: event(),
      onInstalled: event(),
      async sendMessage(message) {
        calls.push(['broadcast', message.type])
      },
    },
    action: { onClicked: event() },
    alarms: {
      onAlarm: event(),
      async create(name) {
        calls.push(['schedule', name])
      },
      async clear(name) {
        calls.push(['clear', name])
      },
    },
    tabs: {
      onUpdated: event(),
      onRemoved: event(),
      async query() {
        return [...tabs.values()]
      },
      async get(id) {
        if (!tabs.has(id)) throw new Error('No tab')
        return { ...tabs.get(id) }
      },
      async create(options) {
        // The embedded browser that 2.0.1 supported rejected background tabs.
        if (rejectInactive && options.active !== true)
          throw new Error('Owl extension-created tabs must be active.')
        const tab = { id: ++tabSequence, ...options, status: 'loading' }
        tabs.set(tab.id, tab)
        calls.push(['create', tab.id])
        return { ...tab }
      },
      async update(id, options) {
        calls.push(['update', id, { ...options }])
        Object.assign(tabs.get(id), options)
        if (options.url) tabs.get(id).status = 'loading'
        return { ...tabs.get(id) }
      },
      async remove(id) {
        assert.equal(typeof id, 'number')
        calls.push(['remove', id])
        tabs.delete(id)
      },
      async sendMessage(tabId, message, options) {
        calls.push([
          'content',
          tabId,
          message.type,
          options?.frameId,
          message.data,
        ])
        if (message.type === 'LIST_READ')
          return {
            ok: true,
            data: {
              orders: orderIds.map((orderId) => ({
                orderId,
                sourceUrl: url(orderId),
                expectedRows: 1,
              })),
              page: 1,
              pageSize: 10,
              total: orderIds.length,
              filterKey: 'stable',
            },
          }
        return {
          ok: true,
          data: {
            accountId: 'local',
            orderId: message.orderId,
            sourceUrl: url(message.orderId),
            items: [{}],
          },
        }
      },
    },
  }
  vm.runInNewContext(sourceCode, {
    chrome,
    openDatabase: async () => repository,
    createImportController: (options) => {
      adapter = options.browser
      return createImportController(options)
    },
    detailUrl,
    isListUrl,
    importJobView,
    createImportReport,
    financialDiagnostics,
    importProgress,
    appearanceTokens,
    loadThumbnail: async () => '',
    URL,
    console,
    setTimeout(callback, milliseconds) {
      return setImmediate(async () => {
        await registrationWait?.(milliseconds)
        callback()
      })
    },
  })
  const send = (message, who = own) =>
    new Promise((resolve) =>
      chrome.runtime.onMessage.listeners[0](message, who, resolve)
    )
  return {
    chrome,
    jobs,
    tabs,
    saved,
    calls,
    send,
    display,
    adapter: () => adapter,
  }
}
const settle = async () => {
  for (let i = 0; i < 20; i++)
    await new Promise((resolve) => setImmediate(resolve))
}

function reviewed(orderId = '10001') {
  const plan = planOrderReconciliation(
    {
      accountId: 'local',
      orderId,
      sourceUrl: url(orderId),
      items: [
        {
          entryId: `${orderId}1`,
          price: '100.00',
          quantity: '1',
          sourceDiscount: '25.00',
        },
      ],
    },
    {
      fields: [
        { label: '原价总计', amount: '100.00' },
        { label: '运费', amount: '0.00' },
        { label: '商品优惠', amount: '20.00' },
        { label: '店铺优惠', amount: '5.00' },
        { label: '商品改价', amount: '4.50' },
      ],
      payable: '70.50',
      discountSummary: '25.00',
    }
  )
  return confirmOrderReconciliation(plan.review, {
    choice: plan.review.suggestedChoice,
    evidenceKey: plan.review.evidenceKey,
    reviewedAt: '2026-10-26T05:00:00.000Z',
  })
}
const reviewJob = (overrides = {}) => ({
  id: 'job-review',
  accountId: 'local',
  state: 'completed-with-errors',
  phase: 'details',
  total: 1,
  orders: [
    {
      orderId: '10001',
      sourceUrl: url('10001'),
      state: 'failed',
      expectedRows: 1,
      reviewRequired: true,
    },
  ],
  ...overrides,
})

test('saved discount review reads are order scoped and do not wait behind a held import mutation', async () => {
  const s = setup()
  const value = reviewed()
  s.saved.set('10001', { snapshot: value })
  const reader = {
    id: 'synthetic',
    tab: { id: 11 },
    frameId: 0,
    url: url('10001'),
  }
  let release
  const held = new Promise((resolve) => {
    release = resolve
  })
  const original = s.chrome.tabs.create
  s.chrome.tabs.create = async (options) => {
    await held
    return original(options)
  }
  const mutation = s.send({ type: 'OPEN_LIBRARY' })
  await settle()
  const response = await s.send(
    { type: 'ORDER_RECONCILIATION_GET', orderId: '10001' },
    reader
  )
  assert.equal(response.ok, true, response.error)
  assert.equal(
    JSON.stringify(response.data),
    JSON.stringify(value.reconciliationReview)
  )
  assert.equal(
    (
      await s.send(
        { type: 'ORDER_RECONCILIATION_GET', orderId: '10002' },
        reader
      )
    ).ok,
    false
  )
  assert.equal(
    (
      await s.send(
        { type: 'ORDER_RECONCILIATION_GET', orderId: '10001' },
        sender
      )
    ).ok,
    false
  )
  s.saved.get('10001').snapshot.accountId = 'another-account'
  assert.equal(
    (
      await s.send(
        { type: 'ORDER_RECONCILIATION_GET', orderId: '10001' },
        reader
      )
    ).data,
    null
  )
  release()
  await mutation
})

test('queued ambiguity flags propagate without retries and public job views omit financial evidence', async () => {
  const s = setup({ orderIds: ['10001', '10002'] })
  let ambiguousReads = 0
  const original = s.chrome.tabs.sendMessage
  s.chrome.tabs.sendMessage = async (tabId, message, options) => {
    if (message.type === 'DETAIL_READ' && message.orderId === '10001') {
      ambiguousReads++
      return {
        ok: false,
        code: 'ORDER_DISCOUNT_REVIEW_REQUIRED',
        reviewRequired: true,
        retryable: true,
        error:
          'The order total balances, but the discount allocation needs your review.',
        review: { private: 'must not persist' },
        diagnostics: {
          version: 1,
          fields: [{ label: 'Synthetic discount', value: '减 ¥1.00' }],
        },
      }
    }
    return original(tabId, message, options)
  }
  const started = await s.send(
    { type: 'IMPORT_START', scope: 'selected', orderIds: ['10001', '10002'] },
    sender
  )
  await settle()
  for (let index = 0; index < 12; index++) {
    for (const tab of s.tabs.values()) if (tab.id !== 7) tab.status = 'complete'
    s.chrome.alarms.onAlarm.emit({ name: 'order-import' })
    await settle()
  }
  const job = s.jobs.get(started.data.id)
  assert.equal(job.state, 'completed-with-errors')
  assert.equal(job.orders[0].reviewRequired, true)
  assert.equal(job.orders[1].state, 'done')
  assert.equal(ambiguousReads, 1)
  assert.doesNotMatch(JSON.stringify(job), /must not persist|"private"/)
  const response = await s.send({ type: 'JOBS_QUERY' })
  assert.equal(response.data.jobs[0].orders[0].reviewRequired, true)
  assert.equal(response.data.jobs[0].orders[0].lastFailure, undefined)
})

test('Activity opens only failed reviewed orders and confirmation is bound to its marked detail page', async () => {
  const s = setup()
  const job = reviewJob()
  s.jobs.set(job.id, structuredClone(job))
  const opened = await s.send({
    type: 'IMPORT_REVIEW_OPEN',
    jobId: job.id,
    orderId: '10001',
  })
  assert.equal(opened.ok, true, opened.error)
  const tab = s.tabs.get(opened.data.tabId)
  assert.equal(tab.url, `${url('10001')}#1688topl-review=job-review`)
  assert.equal(tab.active, true)
  assert.equal(s.saved.size, 0)
  assert.deepEqual(s.jobs.get(job.id), job)
  assert.equal(
    (
      await s.send(
        { type: 'IMPORT_REVIEW_OPEN', jobId: job.id, orderId: '10001' },
        sender
      )
    ).ok,
    false
  )
  assert.equal(
    (
      await s.send({
        type: 'IMPORT_REVIEW_OPEN',
        jobId: job.id,
        orderId: '10002',
      })
    ).ok,
    false
  )
  const reader = {
    id: 'synthetic',
    tab: { id: tab.id },
    frameId: 0,
    url: tab.url,
  }
  const message = {
    type: 'SNAPSHOT_READY',
    snapshot: reviewed(),
    save: true,
    reviewJobId: job.id,
  }
  for (const wrong of [
    { ...reader, url: url('10001') },
    { ...reader, url: `${url('10001')}#1688topl-review=another-job` },
    { ...reader, url: `${url('10002')}#1688topl-review=job-review` },
  ])
    assert.equal((await s.send(message, wrong)).ok, false)
  assert.equal((await s.send({ ...message, save: false }, reader)).ok, false)
  assert.equal(s.saved.size, 0)
  const response = await s.send(message, reader)
  assert.equal(response.ok, true, response.error)
  assert.equal(response.data.saved, true)
  assert.equal(s.saved.size, 1)
  assert.equal(s.jobs.get(job.id).state, 'completed')
  const again = await s.send(message, reader)
  assert.equal(again.ok, true, again.error)
  assert.equal(again.data.alreadySaved, true)
  assert.equal(
    (
      await s.send({
        type: 'IMPORT_REVIEW_OPEN',
        jobId: job.id,
        orderId: '10001',
      })
    ).ok,
    false
  )
})

test('review confirmation preserves the queued expected-row guard and rejects foreign accounts', async () => {
  const s = setup()
  const job = reviewJob()
  job.orders[0].expectedRows = 2
  s.jobs.set(job.id, structuredClone(job))
  const reader = {
    id: 'synthetic',
    tab: { id: 11 },
    frameId: 0,
    url: `${url('10001')}#1688topl-review=job-review`,
  }
  const response = await s.send(
    {
      type: 'SNAPSHOT_READY',
      snapshot: reviewed(),
      save: true,
      reviewJobId: job.id,
    },
    reader
  )
  assert.equal(response.ok, false)
  assert.match(response.error, /Expected 2 product rows/)
  assert.equal(s.saved.size, 0)
  assert.deepEqual(s.jobs.get(job.id), job)
  s.jobs.get(job.id).accountId = 'another-account'
  assert.equal(
    (
      await s.send({
        type: 'IMPORT_REVIEW_OPEN',
        jobId: job.id,
        orderId: '10001',
      })
    ).ok,
    false
  )
})

test('import appearance reads the authoritative palette, persists only mode, and broadcasts to supported pages', async () => {
  const env = setup()
  env.display.appearance = { lightTheme: '1688', darkTheme: 'terracotta' }
  env.tabs.set(8, { id: 8, url: url('10001') })
  env.tabs.set(9, { id: 9, url: 'https://example.test/' })
  const initial = await env.send({ type: 'WORKSPACE_APPEARANCE_GET' }, sender)
  assert.equal(initial.ok, true)
  assert.equal(initial.data.colorScheme, 'dark')
  assert.equal(initial.data.dark.surface, '#2d221e')
  assert.equal(initial.data.light.surface, '#fffcf8')
  assert.equal(env.calls.length, 0)
  assert.equal(
    (
      await env.send({
        type: 'WORKSPACE_APPEARANCE_CHANGED',
        colorScheme: 'light',
      })
    ).ok,
    true
  )
  assert.equal(env.display.colorScheme, 'light')
  const broadcasts = env.calls.filter(
    (call) => call[2] === 'WORKSPACE_APPEARANCE'
  )
  assert.deepEqual(
    broadcasts.map((call) => call[1]),
    [7, 8]
  )
  assert.ok(broadcasts.every((call) => call[4].colorScheme === 'light'))
  assert.ok(
    broadcasts.every((call) => call[3] === undefined),
    'Update all supported frames in each tab'
  )
  env.display.appearance.darkTheme = 'apricot'
  const next = await env.send(
    { type: 'WORKSPACE_APPEARANCE_GET' },
    {
      ...sender,
      url: url('10001'),
    }
  )
  assert.equal(next.data.dark.surface, '#2b251f')
  assert.equal(next.data.colorScheme, 'light')
  assert.equal(
    (
      await env.send(
        { type: 'WORKSPACE_APPEARANCE_CHANGED', colorScheme: 'dark' },
        sender
      )
    ).ok,
    false
  )
  assert.equal(
    (
      await env.send({
        type: 'WORKSPACE_APPEARANCE_CHANGED',
        colorScheme: 'invalid',
      })
    ).ok,
    false
  )
  assert.equal(
    (
      await env.send(
        { type: 'WORKSPACE_APPEARANCE_GET' },
        { ...sender, url: 'https://example.test/' }
      )
    ).ok,
    false
  )
  assert.equal(env.display.colorScheme, 'light')
})

test('reader progress is compact, tab/frame/order scoped, read-only and available during a blocked read', async () => {
  const s = setup()
  const reader = {
    id: 'synthetic',
    tab: { id: 11 },
    frameId: 0,
    url: `${url('10001')}#1688topl-import=job`,
  }
  const job = {
    id: 'job',
    workerTabId: 11,
    currentOrderId: '10001',
    state: 'running',
    phase: 'details',
    total: 2,
    detailStage: 'reading',
    detailStartedAt: 1000,
    detailAttempts: 1,
    orders: [
      { orderId: '10001', state: 'pending' },
      { orderId: '10002', state: 'done', savedRows: 7 },
    ],
  }
  s.jobs.set('job', structuredClone(job))
  let release
  const held = new Promise((resolve) => {
    release = resolve
  })
  const original = s.chrome.tabs.create
  s.chrome.tabs.create = async (options) => {
    await held
    return original(options)
  }
  const mutation = s.send({ type: 'OPEN_LIBRARY' }) // Holds the serial lock.
  await settle()
  const reply = await s.send({ type: 'READER_STATUS' }, reader)
  assert.equal(reply.ok, true)
  assert.equal(reply.data.collectedRows, 7)
  assert.equal(reply.data.detailStage, 'reading')
  assert.equal(reply.data.orders, undefined)
  for (const wrong of [
    { ...reader, tab: { id: 12 } },
    { ...reader, frameId: 1 },
    { ...reader, url: url('10001') },
    { ...reader, url: `${url('10003')}#1688topl-import=job` },
    { ...reader, url: `${url('10001')}#1688topl-import=other` },
  ])
    assert.equal((await s.send({ type: 'READER_STATUS' }, wrong)).data, null)
  assert.equal((await s.send({ type: 'READER_STATUS' }, sender)).ok, false)
  assert.deepEqual(s.jobs.get('job'), job)
  assert.equal(
    s.calls.some(([type]) => ['content', 'schedule'].includes(type)),
    false
  )
  release()
  await mutation
})

test('progress responses omit failure evidence without erasing saved diagnostics', async () => {
  const s = setup()
  const lastFailure = {
    message: 'Unsupported total',
    diagnostics: { version: 1 },
  }
  s.jobs.set('bulk', {
    id: 'bulk',
    state: 'paused',
    orders: Array.from({ length: 667 }, (_, i) => ({
      orderId: String(10000 + i),
      state: 'failed',
      error: 'Unsupported total',
      lastFailure,
    })),
  })
  for (const type of ['JOBS_QUERY', 'LIBRARY_QUERY']) {
    const reply = await s.send({ type })
    assert.equal(reply.ok, true)
    assert.equal(reply.data.jobs[0].orders.length, 667)
    assert.equal(reply.data.jobs[0].orders[0].error, 'Unsupported total')
    assert.equal(reply.data.jobs[0].orders[0].lastFailure, undefined)
  }
  assert.deepEqual(s.jobs.get('bulk').orders[0].lastFailure, lastFailure)
})

test('the source list can export a durable import report without changing or advancing any job', async () => {
  for (const state of [
    'running',
    'paused',
    'completed-with-errors',
    'completed',
  ]) {
    const s = setup()
    const states =
      state === 'completed'
        ? ['done', 'done', 'done']
        : state === 'completed-with-errors'
          ? ['done', 'failed', 'done']
          : ['done', 'failed', 'pending']
    const diagnostics = {
      version: 1,
      fields: [{ label: '原价总计', value: '¥30.00' }],
      products: { count: 2, gross: '25.00', discount: '1.00' },
    }
    const job = {
      id: 'report-job',
      kind: 'import',
      scope: 'all',
      phase: 'details',
      state,
      source: { tabId: sender.tab.id, frameId: sender.frameId },
      total: 3,
      page: 1,
      pageSize: 10,
      createdAt: '2026-10-14T12:00:00.000Z',
      updatedAt: '2026-10-14T12:01:00.000Z',
      filterKey: 'excluded private filter',
      orders: states.map((orderState, i) => ({
        orderId: String(10001 + i),
        sourceUrl: url(String(10001 + i)),
        state: orderState,
        error:
          orderState === 'failed' ? 'Synthetic reconciliation failure' : '',
        ...(orderState === 'failed'
          ? {
              lastFailure: {
                at: '2026-10-14T12:01:00.000Z',
                message: 'Synthetic reconciliation failure',
                diagnostics,
              },
            }
          : {}),
      })),
    }
    s.jobs.set(job.id, structuredClone(job))
    const response = await s.send(
      { type: 'IMPORT_REPORT', jobId: job.id },
      sender
    )
    assert.equal(response.ok, true)
    assert.equal(response.data.format, '1688-import-report')
    assert.equal(response.data.extensionVersion, '2.2.5')
    assert.equal(response.data.job.state, state)
    assert.deepEqual(
      response.data.orders.map((order) => order.state),
      states
    )
    if (state !== 'completed')
      assert.deepEqual(
        response.data.orders[1].lastFailure.diagnostics,
        financialDiagnostics(diagnostics)
      )
    assert.equal(
      JSON.stringify(response.data).includes('excluded private filter'),
      false
    )
    await settle()
    assert.deepEqual(s.jobs.get(job.id), job)
    assert.deepEqual(s.calls, [])
    assert.equal(s.tabs.size, 1)
    assert.equal(s.saved.size, 0)
  }
})

test('import reports reject another source tab or frame, unsupported callers and deleted jobs', async () => {
  const s = setup()
  const job = {
    id: 'owned',
    source: { tabId: sender.tab.id, frameId: sender.frameId },
    orders: [],
  }
  s.jobs.set(job.id, job)
  for (const other of [
    { ...sender, tab: { id: 8 } },
    { ...sender, frameId: 0 },
    { ...sender, url: 'https://example.com/' },
    { ...sender, id: 'another-extension' },
    own,
  ]) {
    const response = await s.send(
      { type: 'IMPORT_REPORT', jobId: job.id },
      other
    )
    assert.equal(response.ok, false)
  }
  s.jobs.delete(job.id)
  for (const jobId of ['owned', undefined]) {
    const response = await s.send({ type: 'IMPORT_REPORT', jobId }, sender)
    assert.equal(response.ok, false)
    assert.match(response.error, /no longer available/)
  }
  await settle()
  assert.deepEqual(s.calls, [])
  assert.equal(s.tabs.size, 1)
})

test('dismissal is library-only, refuses running jobs and preserves saved data', async () => {
  const s = setup()
  const job = {
    id: 'old-job',
    state: 'paused',
    source: { tabId: sender.tab.id, frameId: sender.frameId },
    orders: [],
    error: 'Old warning',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  s.jobs.set(job.id, job)
  s.saved.set('10001', { snapshot: { orderId: '10001' } })
  assert.equal(
    (await s.send({ type: 'IMPORT_DISMISS', jobId: job.id }, sender)).ok,
    false
  )
  assert.equal(
    (await s.send({ type: 'IMPORT_DISMISS', jobId: job.id })).ok,
    true
  )
  assert.ok(s.jobs.get(job.id).dismissedAt)
  assert.equal(s.jobs.get(job.id).state, 'paused')
  assert.equal(s.jobs.get(job.id).error, 'Old warning')
  const status = await s.send({ type: 'IMPORT_STATUS' }, sender)
  assert.equal(status.ok, true)
  assert.equal(status.data.jobs.length, 0)
  assert.equal(s.saved.size, 1)
  assert.equal(
    s.calls.some(([type]) => ['create', 'schedule', 'remove'].includes(type)),
    false
  )
  s.jobs.set('running', { id: 'running', state: 'running', orders: [] })
  assert.equal(
    (await s.send({ type: 'IMPORT_DISMISS', jobId: 'running' })).ok,
    false
  )
  assert.equal(s.jobs.get('running').dismissedAt, undefined)
})
test('worker accepts own pages and validates content senders before mutations', async () => {
  const s = setup()
  assert.equal((await s.send({ type: 'BACKUP_RESTORE', backup: {} })).ok, true)
  assert.equal(
    (await s.send({ type: 'BACKUP_RESTORE', backup: {} }, sender)).ok,
    false
  )
  assert.equal(
    (
      await s.send(
        { type: 'IMPORT_START', scope: 'all' },
        { ...sender, url: 'https://evil.example/' }
      )
    ).ok,
    false
  )
  assert.equal(
    (
      await s.send(
        { type: 'SNAPSHOT_READY', snapshot: { orderId: '10002' } },
        { ...sender, url: url('10001') }
      )
    ).ok,
    false
  )
  assert.equal(s.calls.filter((x) => x[0] === 'restore').length, 1)
})
test('overlapping import messages serialize into one job and target the source frame', async () => {
  const s = setup()
  const replies = await Promise.all([
    s.send(
      { type: 'IMPORT_START', scope: 'selected', orderIds: ['10001'] },
      sender
    ),
    s.send(
      { type: 'IMPORT_START', scope: 'selected', orderIds: ['10001'] },
      sender
    ),
  ])
  assert.equal(replies.filter((x) => x.ok).length, 1)
  await settle()
  assert.equal(s.jobs.size, 1)
  assert.equal(s.calls.filter((x) => x[0] === 'create').length, 1)
  assert.equal(s.calls.find((x) => x[0] === 'content')[3], 2)
  assert.equal(
    s.calls.filter((x) => x[0] === 'broadcast' && x[1] === 'LIBRARY_CHANGED')
      .length,
    0
  )
  assert.ok(
    s.calls.some((x) => x[0] === 'broadcast' && x[1] === 'IMPORT_PROGRESS')
  )
  const job = [...s.jobs.values()][0]
  s.tabs.get(job.workerTabId).status = 'complete'
  s.chrome.tabs.onUpdated.emit(job.workerTabId, { status: 'complete' })
  await settle()
  assert.equal(s.saved.size, 1)
  assert.equal(s.jobs.get(job.id).state, 'completed')
  assert.equal(
    s.calls.filter((x) => x[0] === 'broadcast' && x[1] === 'LIBRARY_CHANGED')
      .length,
    1
  )
})
test('marker recovers a tab created before checkpoint and never closes navigated user tabs', async () => {
  const s = setup()
  await s.send({ type: 'JOBS_QUERY' })
  const adapter = s.adapter(),
    marker = '#1688topl-import=job-known'
  s.tabs.set(55, { id: 55, url: url('10001') + marker, status: 'complete' })
  assert.equal(await adapter.openDetailTab(url('10002'), 'job-known'), 55)
  assert.equal(s.tabs.get(55).url, url('10002') + marker)
  assert.equal(s.calls.filter((x) => x[0] === 'create').length, 0)
  s.tabs.set(55, {
    id: 55,
    url: url('10002') + '#1688tocsv-import=job-known',
    status: 'complete',
  })
  assert.equal(await adapter.openDetailTab(url('10002'), 'job-known'), 55)
  await adapter.closeDetailTab(null, 'job-known')
  assert.equal(s.tabs.has(55), false)
  s.tabs.set(56, { id: 56, url: url('10001'), status: 'complete' })
  await assert.rejects(
    adapter.getDetailTab(56, 'job-known'),
    /left its marked order page/
  )
  await adapter.closeDetailTab(56, 'job-known')
  assert.equal(s.tabs.has(56), true)
})

test('tab lookup distinguishes missing IDs from browser API failures', async () => {
  const s = setup()
  await s.send({ type: 'JOBS_QUERY' })
  const adapter = s.adapter()
  assert.equal(await adapter.getDetailTab(55, 'job-known'), null)
  s.tabs.set(55, {
    id: 55,
    url: url('10001') + '#1688topl-import=job-known',
    status: 'complete',
  })
  const failure = new Error('The browser could not inspect this tab')
  s.chrome.tabs.get = async () => {
    throw failure
  }
  await assert.rejects(adapter.getDetailTab(55, 'job-known'), (error) => {
    assert.equal(error, failure)
    return true
  })
  s.chrome.tabs.query = async () => {
    throw new Error('The browser could not list tabs either')
  }
  await assert.rejects(adapter.getDetailTab(55, 'job-known'), (error) => {
    assert.equal(error, failure)
    return true
  })
  assert.equal(s.tabs.has(55), true)
  assert.equal(s.calls.filter(([type]) => type === 'remove').length, 0)
})

test('blank pending URL does not hide a loaded marked order URL', async () => {
  const s = setup()
  const result = await s.send(
    { type: 'IMPORT_START', scope: 'selected', orderIds: ['10001'] },
    sender
  )
  await settle()
  const tabId = s.jobs.get(result.data.id).workerTabId
  Object.assign(s.tabs.get(tabId), {
    pendingUrl: 'about:blank',
    status: 'complete',
  })
  s.chrome.tabs.onUpdated.emit(tabId, { status: 'complete' })
  await settle()
  assert.equal(s.saved.size, 1)
  assert.equal(s.jobs.get(result.data.id).state, 'completed')
  assert.equal(s.tabs.has(tabId), false)
  assert.equal(s.calls.filter(([type]) => type === 'create').length, 1)
})

test('an initially blank loading tab waits until its marked order arrives', async () => {
  const s = setup()
  const result = await s.send(
    { type: 'IMPORT_START', scope: 'selected', orderIds: ['10001'] },
    sender
  )
  await settle()
  const tabId = s.jobs.get(result.data.id).workerTabId
  const orderUrl = s.tabs.get(tabId).url
  Object.assign(s.tabs.get(tabId), {
    url: 'about:blank',
    pendingUrl: '',
    status: 'loading',
  })
  s.chrome.alarms.onAlarm.emit({ name: 'order-import' })
  await settle()
  assert.equal(s.jobs.get(result.data.id).state, 'running')
  assert.equal(s.jobs.get(result.data.id).workerTabId, tabId)
  assert.equal(s.saved.size, 0)
  assert.equal(s.calls.filter((call) => call[2] === 'DETAIL_READ').length, 0)
  assert.equal(s.tabs.has(tabId), true)
  Object.assign(s.tabs.get(tabId), { url: orderUrl, status: 'complete' })
  s.chrome.tabs.onUpdated.emit(tabId, { status: 'complete' })
  await settle()
  assert.equal(s.jobs.get(result.data.id).state, 'completed')
  assert.equal(s.saved.size, 1)
})

test('a completed tab without its URL reports unreadable metadata and stays open', async () => {
  const s = setup()
  const result = await s.send(
    { type: 'IMPORT_START', scope: 'selected', orderIds: ['10001'] },
    sender
  )
  await settle()
  const tabId = s.jobs.get(result.data.id).workerTabId
  Object.assign(s.tabs.get(tabId), { url: undefined, status: 'complete' })
  s.chrome.tabs.onUpdated.emit(tabId, { status: 'complete' })
  await settle()
  const job = s.jobs.get(result.data.id)
  assert.equal(job.state, 'paused')
  assert.match(job.error, /did not provide the import tab URL/)
  assert.equal(s.saved.size, 0)
  assert.equal(s.calls.filter((call) => call[2] === 'DETAIL_READ').length, 0)
  assert.equal(s.tabs.has(tabId), true)
})

test('a concrete unrelated pending navigation cannot be read or closed', async () => {
  for (const pendingUrl of ['https://example.com/', url('10002')]) {
    const s = setup()
    const result = await s.send(
      { type: 'IMPORT_START', scope: 'selected', orderIds: ['10001'] },
      sender
    )
    await settle()
    const tabId = s.jobs.get(result.data.id).workerTabId
    Object.assign(s.tabs.get(tabId), { pendingUrl, status: 'loading' })
    s.chrome.alarms.onAlarm.emit({ name: 'order-import' })
    await settle()
    const job = s.jobs.get(result.data.id)
    assert.equal(job.state, 'paused')
    assert.match(job.error, /left its marked order page/)
    assert.equal(s.saved.size, 0)
    assert.equal(s.calls.filter((call) => call[2] === 'DETAIL_READ').length, 0)
    assert.equal(s.calls.filter(([type]) => type === 'remove').length, 0)
    assert.equal(s.tabs.has(tabId), true)
  }
})
test('startup leaves interrupted import paused and library updates broadcast', async () => {
  const s = setup()
  const result = await s.send(
    { type: 'IMPORT_START', scope: 'selected', orderIds: ['10001'] },
    sender
  )
  await settle()
  s.chrome.runtime.onStartup.emit()
  await settle()
  assert.equal(s.jobs.get(result.data.id).state, 'paused')
  assert.equal(s.jobs.get(result.data.id).workerTabId, null)
  assert.equal((await s.send({ type: 'LIBRARY_UPDATED' })).ok, true)
  assert.ok(
    s.calls.some((x) => x[0] === 'broadcast' && x[1] === 'LIBRARY_CHANGED')
  )
})

test('a browser that rejects background tabs automatically imports all orders in one visible reader', async () => {
  const s = setup({
    orderIds: ['10001', '10002', '10003'],
    rejectInactive: true,
  })
  await assert.rejects(
    s.chrome.tabs.create({ url: url('10001'), active: false }),
    /must be active/
  )
  const library = await s.send({ type: 'OPEN_LIBRARY' })
  assert.equal(library.ok, true)
  assert.equal(library.data.active, true)
  const result = await s.send(
    {
      type: 'IMPORT_START',
      scope: 'selected',
      orderIds: ['10001', '10002', '10003'],
    },
    sender
  )
  await settle()
  // No background tab or window API: continue without a consent round trip.
  const job = () => s.jobs.get(result.data.id)
  assert.equal(job().state, 'running')
  assert.equal(s.calls.filter(([type]) => type === 'create').length, 2)
  const workerTabId = job().workerTabId
  assert.equal(s.tabs.get(workerTabId).active, true)
  assert.equal(job().visibleReader, true)
  assert.ok(!job().attention)
  for (const orderId of ['10001', '10002', '10003']) {
    assert.equal(job().workerTabId, workerTabId)
    assert.equal(detailUrl(s.tabs.get(workerTabId).url), url(orderId))
    s.tabs.get(workerTabId).status = 'complete'
    s.chrome.tabs.onUpdated.emit(workerTabId, { status: 'complete' })
    await settle()
  }
  assert.equal(s.saved.size, 3)
  assert.equal(job().state, 'completed')
  const navigations = s.calls.filter(
    ([type, id, options]) =>
      type === 'update' && id === workerTabId && options.url
  )
  assert.equal(navigations.length, 2)
  assert.ok(navigations.every(([, , options]) => !('active' in options)))
})

test('refresh falls back automatically when background creation and unfocused windows are unsupported', async () => {
  const s = setup()
  s.saved.set('10001', {
    snapshot: { orderId: '10001', sourceUrl: url('10001'), items: [{}] },
  })
  const create = s.chrome.tabs.create
  const attempts = []
  s.chrome.tabs.create = async (options) => {
    attempts.push(options.active ? 'visible' : 'background')
    if (!options.active) throw new Error('This operation is unavailable.')
    return create(options)
  }
  s.chrome.windows = {
    async create() {
      attempts.push('window')
      throw new Error('Windows are not supported.')
    },
  }
  const result = await s.send({ type: 'REFRESH_ORDERS', orderIds: ['10001'] })
  assert.equal(result.ok, true, result.error)
  await settle()
  assert.deepEqual(attempts, ['background', 'window', 'visible'])
  const reader = s.jobs.get(result.data.id).workerTabId
  assert.equal(s.jobs.get(result.data.id).state, 'running')
  assert.equal(s.jobs.get(result.data.id).visibleReader, true)
  s.tabs.get(reader).status = 'complete'
  s.chrome.tabs.onUpdated.emit(reader, { status: 'complete' })
  await settle()
  assert.equal(s.jobs.get(result.data.id).state, 'completed')
  assert.equal(s.tabs.has(reader), false)
})

test('a provisional reader registers after a bounded wait without creating fallback tabs', async () => {
  let s,
    provisional,
    waits = 0
  s = setup({
    registrationWait() {
      waits++
      if (waits === 2) s.tabs.set(provisional.id, { ...provisional })
    },
  })
  await s.send({ type: 'LIBRARY_QUERY' })
  s.chrome.tabs.create = async (options) => {
    provisional = { id: 8001, ...options, status: 'loading' }
    s.calls.push(['create', provisional.id])
    return { ...provisional }
  }
  const checkpoints = []
  const reader = await s.adapter().openDetailTab(url('10001'), 'lagging', {
    checkpoint: async (attempt, diagnostic) =>
      checkpoints.push(structuredClone({ attempt, diagnostic })),
  })
  assert.equal(reader.id, 8001)
  assert.equal(waits, 2)
  assert.equal(s.calls.filter(([type]) => type === 'create').length, 1)
  assert.equal(provisional.url, url('10001') + '#1688topl-import=lagging')
  assert.equal(
    checkpoints.find(({ diagnostic }) => diagnostic?.outcome === 'missing')
      .diagnostic.stage,
    'registering'
  )
  assert.equal(
    checkpoints.find(({ diagnostic }) => diagnostic?.outcome === 'missing')
      .diagnostic.code,
    'MISSING_TAB'
  )
  assert.ok(
    checkpoints.some(
      ({ attempt }) => attempt?.tabId === 8001 && attempt.check === -1
    )
  )
  assert.deepEqual(
    checkpoints
      .filter(({ diagnostic }) => diagnostic?.check !== undefined)
      .map(({ diagnostic }) => diagnostic.outcome),
    ['missing', 'missing', 'owned']
  )
})

test('worker recovery waits for its durable provisional ID and closes only duplicate exact marked readers', async () => {
  let s,
    waits = 0
  const target = url('10001') + '#1688topl-import=resume'
  s = setup({
    registrationWait() {
      waits++
      s.tabs.set(8001, { id: 8001, url: target, status: 'loading' })
      s.tabs.set(8002, { id: 8002, url: target, status: 'loading' })
      s.tabs.set(8003, {
        id: 8003,
        url: 'https://login.1688.com/',
        status: 'complete',
      })
    },
  })
  await s.send({ type: 'LIBRARY_QUERY' })
  const reader = await s.adapter().openDetailTab(url('10001'), 'resume', {
    attempt: {
      method: 'background',
      stage: 'registering',
      tabId: 8001,
      check: 0,
      startedAt: new Date().toISOString(),
    },
  })
  assert.equal(reader.id, 8001)
  assert.equal(waits, 1)
  assert.equal(s.tabs.has(8002), false)
  assert.equal(s.tabs.has(8003), true)
  assert.equal(s.calls.filter(([type]) => type === 'create').length, 0)
  // A slower previous creation can appear after adoption. Only the exact
  // duplicate is cleaned on the next read; another order and user page survive.
  s.tabs.set(8004, { id: 8004, url: target, status: 'complete' })
  s.tabs.set(8005, {
    id: 8005,
    url: url('10002') + '#1688topl-import=resume',
    status: 'complete',
  })
  s.tabs.set(8006, { id: 8006, url: url('10001'), status: 'complete' })
  await s.adapter().getDetailTab(8001, 'resume')
  assert.equal(s.tabs.has(8004), false)
  assert.equal(s.tabs.has(8005), true)
  assert.equal(s.tabs.has(8006), true)
})

test('an interrupted creation without a checkpointed ID is recovered by its exact marker before another method', async () => {
  let s
  const target = url('10001') + '#1688topl-import=uncertain'
  s = setup({
    registrationWait() {
      s.tabs.set(8001, { id: 8001, url: target, status: 'loading' })
    },
  })
  await s.send({ type: 'LIBRARY_QUERY' })
  const reader = await s.adapter().openDetailTab(url('10001'), 'uncertain', {
    attempt: {
      method: 'background',
      stage: 'creating',
      check: -1,
      startedAt: new Date().toISOString(),
    },
  })
  assert.equal(reader.id, 8001)
  assert.equal(s.calls.filter(([type]) => type === 'create').length, 0)
})

test('a provisional reader redirected to sign-in is retained and no fallback is created', async () => {
  const s = setup()
  await s.send({ type: 'LIBRARY_QUERY' })
  s.chrome.tabs.create = async () => {
    const tab = { id: 8001, url: 'https://login.1688.com/', status: 'complete' }
    s.tabs.set(tab.id, tab)
    s.calls.push(['create', tab.id])
    return tab
  }
  await assert.rejects(
    s.adapter().openDetailTab(url('10001'), 'redirect'),
    (error) => error.attention === 'sign-in'
  )
  assert.equal(s.tabs.has(8001), true)
  assert.equal(s.calls.filter(([type]) => type === 'create').length, 1)
})

test('reader inspection failures do not create more tabs and total API failure remains actionable', async () => {
  const s = setup()
  await s.send({ type: 'LIBRARY_QUERY' })
  s.chrome.tabs.get = async () => {
    throw new Error('Inspection is unavailable.')
  }
  await assert.rejects(
    s.adapter().openDetailTab(url('10001'), 'j1'),
    /Inspection is unavailable/
  )
  assert.equal(s.calls.filter(([type]) => type === 'create').length, 1)
  assert.equal(s.tabs.size, 2)
  const blocked = setup()
  blocked.chrome.tabs.create = async () => {
    throw new Error('Tab creation is unavailable.')
  }
  const result = await blocked.send(
    { type: 'IMPORT_START', scope: 'selected', orderIds: ['10001'] },
    sender
  )
  await settle()
  const job = blocked.jobs.get(result.data.id)
  assert.equal(job.state, 'paused')
  assert.match(job.error, /Tab creation is unavailable/)
  assert.equal(job.readerDiagnostics.at(-1).stage, 'creating')
  assert.equal(job.readerDiagnostics.at(-1).code, 'CREATION_FAILED')
  assert.equal(job.attention, null)
  assert.equal(blocked.saved.size, 0)
})

test('refresh bypasses phantom background and window tab IDs without pausing', async () => {
  const s = setup()
  s.saved.set('10001', {
    snapshot: { orderId: '10001', sourceUrl: url('10001'), items: [{}] },
  })
  const create = s.chrome.tabs.create,
    update = s.chrome.tabs.update,
    methods = []
  s.chrome.tabs.create = async (options) => {
    methods.push(options.active ? 'visible' : 'background')
    if (!options.active)
      return { id: 801538846, url: 'about:blank', status: 'loading' }
    return create(options)
  }
  s.chrome.tabs.update = async (id, options) => {
    if (!s.tabs.has(id)) throw new Error(`No tab with id: ${id}.`)
    return update(id, options)
  }
  s.chrome.windows = {
    async create(options) {
      methods.push('window')
      return { tabs: [{ id: 801538847, url: options.url }] }
    },
  }
  const response = await s.send({ type: 'REFRESH_ORDERS', orderIds: ['10001'] })
  await settle()
  const job = () => s.jobs.get(response.data.id)
  assert.deepEqual(methods, ['background', 'window', 'visible'])
  assert.equal(job().state, 'running')
  assert.equal(job().visibleReader, true)
  const reader = job().workerTabId
  s.tabs.get(reader).status = 'complete'
  s.chrome.tabs.onUpdated.emit(reader, { status: 'complete' })
  await settle()
  assert.equal(job().state, 'completed')
  assert.equal(job().completed, 1)
})

test('a recovered reader lost during retargeting is replaced but unrelated update errors do not open more tabs', async () => {
  const s = setup()
  await s.send({ type: 'LIBRARY_QUERY' })
  s.tabs.set(55, {
    id: 55,
    url: url('10001') + '#1688topl-import=j1',
    status: 'complete',
  })
  const update = s.chrome.tabs.update
  s.chrome.tabs.update = async (id, options) => {
    if (id === 55) {
      s.tabs.delete(id)
      throw new Error(`No tab with id: ${id}.`)
    }
    return update(id, options)
  }
  const reader = await s.adapter().openDetailTab(url('10002'), 'j1'),
    id = typeof reader === 'object' ? reader.id : reader
  assert.notEqual(id, 55)
  assert.equal(s.tabs.get(id).url, url('10002') + '#1688topl-import=j1')
  assert.equal(s.calls.filter(([type]) => type === 'create').length, 1)

  const blocked = setup()
  await blocked.send({ type: 'LIBRARY_QUERY' })
  blocked.tabs.set(55, {
    id: 55,
    url: url('10001') + '#1688topl-import=j1',
    status: 'complete',
  })
  blocked.chrome.tabs.update = async () => {
    throw new Error('Navigation is unavailable.')
  }
  await assert.rejects(
    blocked.adapter().openDetailTab(url('10002'), 'j1'),
    /Navigation is unavailable/
  )
  assert.equal(blocked.calls.filter(([type]) => type === 'create').length, 0)
  assert.equal(blocked.tabs.has(55), true)
})

test('exhausted phantom reader methods pause refresh with actionable recovery and preserve its source and pending queue', async () => {
  const s = setup(),
    original = {
      snapshot: { orderId: '10001', sourceUrl: url('10001'), items: [{}] },
    },
    methods = []
  s.saved.set('10001', structuredClone(original))
  s.chrome.tabs.create = async (options) => {
    methods.push(options.active ? 'visible' : 'background')
    return { id: 801540208, url: options.url, status: 'loading' }
  }
  s.chrome.tabs.update = async (id) => {
    throw new Error(`No tab with id: ${id}.`)
  }
  s.chrome.windows = {
    async create(options) {
      methods.push('window')
      return { tabs: [{ id: 801540209, url: options.url }] }
    },
  }
  const response = await s.send({ type: 'REFRESH_ORDERS', orderIds: ['10001'] })
  await settle()
  const job = s.jobs.get(response.data.id)
  assert.deepEqual(methods, ['background', 'window', 'visible'])
  assert.equal(job.state, 'paused')
  assert.equal(job.completed, 0)
  assert.equal(job.failed, 0)
  assert.equal(job.orders[0].state, 'pending')
  assert.equal(job.workerTabId, null)
  assert.match(job.error, /could not keep an import tab open/)
  assert.doesNotMatch(job.error, /No tab with id|801540/)
  assert.equal(job.readerDiagnostics.at(-1).stage, 'registering')
  assert.equal(job.readerDiagnostics.at(-1).code, 'REGISTRATION_TIMEOUT')
  assert.deepEqual(s.saved.get('10001'), original)
  assert.equal(s.tabs.size, 1)
})

test('reader loss on the final detail attempt reopens the pending order instead of marking it failed', async () => {
  const s = setup(),
    original = {
      snapshot: { orderId: '10001', sourceUrl: url('10001'), items: [{}] },
    }
  s.saved.set('10001', structuredClone(original))
  const response = await s.send({ type: 'REFRESH_ORDERS', orderIds: ['10001'] })
  await settle()
  const job = () => s.jobs.get(response.data.id),
    missing = job().workerTabId,
    sendMessage = s.chrome.tabs.sendMessage
  job().detailAttempts = 2
  let lost = false
  s.chrome.tabs.sendMessage = async (id, message, options) => {
    if (!lost && message.type === 'DETAIL_READ') {
      lost = true
      s.tabs.delete(id)
      throw new Error(`No tab with id: ${id}.`)
    }
    return sendMessage(id, message, options)
  }
  s.tabs.get(missing).status = 'complete'
  s.chrome.tabs.onUpdated.emit(missing, { status: 'complete' })
  await settle()
  assert.equal(lost, true)
  assert.equal(job().state, 'running')
  assert.equal(job().orders[0].state, 'pending')
  assert.equal(job().failed, 0)
  assert.equal(job().readerReopens, 1)
  assert.notEqual(job().workerTabId, missing)
  assert.deepEqual(s.saved.get('10001'), original)
  const replacement = job().workerTabId
  s.tabs.get(replacement).status = 'complete'
  s.chrome.tabs.onUpdated.emit(replacement, { status: 'complete' })
  await settle()
  assert.equal(job().state, 'completed')
  assert.equal(job().completed, 1)
  assert.equal(job().failed, 0)
})

test('owned reader disappearance during cleanup is harmless while other removal errors remain visible', async () => {
  const s = setup()
  await s.send({ type: 'LIBRARY_QUERY' })
  s.tabs.set(55, { id: 55, url: url('10001') + '#1688topl-import=j1' })
  s.chrome.tabs.remove = async (id) => {
    s.tabs.delete(id)
    throw new Error(`No tab with id: ${id}.`)
  }
  await s.adapter().closeDetailTab(55, 'j1')
  assert.equal(s.tabs.has(55), false)
  s.tabs.set(56, { id: 56, url: url('10001') + '#1688topl-import=j1' })
  s.chrome.tabs.remove = async () => {
    throw new Error('Tab removal is unavailable.')
  }
  await assert.rejects(
    s.adapter().closeDetailTab(56, 'j1'),
    /Tab removal is unavailable/
  )
  assert.equal(s.tabs.has(56), true)
})

test('a vanished reader ID is replaced without losing pending orders and repeated loss stays bounded', async () => {
  const s = setup({ orderIds: ['10001', '10002'] })
  const response = await s.send(
    { type: 'IMPORT_START', scope: 'selected', orderIds: ['10001', '10002'] },
    sender
  )
  await settle()
  const job = () => s.jobs.get(response.data.id)
  const previous = job().workerTabId
  s.tabs.delete(previous)
  s.chrome.alarms.onAlarm.emit({ name: 'order-import' })
  await settle()
  assert.notEqual(job().workerTabId, previous)
  assert.equal(job().state, 'running')
  assert.equal(job().completed, 0)
  for (const orderId of ['10001', '10002']) {
    const reader = job().workerTabId
    assert.equal(detailUrl(s.tabs.get(reader).url), url(orderId))
    s.tabs.get(reader).status = 'complete'
    s.chrome.tabs.onUpdated.emit(reader, { status: 'complete' })
    await settle()
  }
  assert.equal(job().state, 'completed')
  assert.equal(s.saved.size, 2)
  const unstable = setup()
  const started = await unstable.send(
    { type: 'IMPORT_START', scope: 'selected', orderIds: ['10001'] },
    sender
  )
  await settle()
  for (let attempt = 0; attempt < 3; attempt++) {
    unstable.tabs.delete(unstable.jobs.get(started.data.id).workerTabId)
    unstable.chrome.alarms.onAlarm.emit({ name: 'order-import' })
    await settle()
  }
  const stopped = unstable.jobs.get(started.data.id)
  assert.equal(stopped.state, 'paused')
  assert.match(stopped.error, /repeatedly closed/)
  assert.equal(unstable.calls.filter(([type]) => type === 'create').length, 3)
  assert.equal(unstable.saved.size, 0)
})

test('a browser that rejects background tabs can still read in an unfocused window', async () => {
  const s = setup({ orderIds: ['10001'], rejectInactive: true })
  const windows = []
  s.chrome.windows = {
    async create(options) {
      windows.push({ ...options })
      const tab = {
        id: 80,
        url: options.url,
        status: 'loading',
        active: true,
        windowId: 9,
      }
      s.tabs.set(tab.id, tab)
      return { id: 9, focused: false, tabs: [{ ...tab }] }
    },
  }
  const result = await s.send(
    { type: 'IMPORT_START', scope: 'selected', orderIds: ['10001'] },
    sender
  )
  await settle()
  assert.equal(JSON.stringify(windows.map((entry) => entry.focused)), '[false]')
  assert.equal(s.jobs.get(result.data.id).workerTabId, 80)
  assert.equal(s.jobs.get(result.data.id).visibleReader, false)
  s.tabs.get(80).status = 'complete'
  s.chrome.tabs.onUpdated.emit(80, { status: 'complete' })
  await settle()
  assert.equal(s.saved.size, 1)
})

test('imports read orders in a background tab and never switch the visible tab', async () => {
  const s = setup({ orderIds: ['10001', '10002'] })
  const created = []
  s.chrome.tabs.create = async (options) => {
    created.push({ ...options })
    const tab = { id: 50 + created.length, ...options, status: 'loading' }
    s.tabs.set(tab.id, tab)
    s.calls.push(['create', tab.id])
    return { ...tab }
  }
  const result = await s.send(
    { type: 'IMPORT_START', scope: 'selected', orderIds: ['10001', '10002'] },
    sender
  )
  await settle()
  const job = () => s.jobs.get(result.data.id)
  const workerTabId = job().workerTabId
  assert.deepEqual(
    created.map((options) => options.active),
    [false]
  )
  assert.equal(job().visibleReader, false)
  assert.ok(
    s.calls.some(
      ([type, id, options]) =>
        type === 'update' &&
        id === workerTabId &&
        options.autoDiscardable === false
    )
  )
  for (const orderId of ['10001', '10002']) {
    assert.equal(detailUrl(s.tabs.get(workerTabId).url), url(orderId))
    s.tabs.get(workerTabId).status = 'complete'
    s.chrome.tabs.onUpdated.emit(workerTabId, { status: 'complete' })
    await settle()
  }
  assert.equal(s.saved.size, 2)
  assert.equal(job().state, 'completed')
  // No update ever activated a tab during the import.
  assert.ok(
    !s.calls.some(
      ([type, , options]) => type === 'update' && options?.active === true
    )
  )
})

test('spreadsheet fallback navigates only the requesting idle order tab without creating a tab', async () => {
  const s = setup()
  s.chrome.tabs.create = async () => {
    throw new Error(
      'Owl extension-created tab was blocked before presentation.'
    )
  }
  const blocked = await s.send({ type: 'OPEN_LIBRARY' }, sender)
  assert.equal(blocked.ok, false)
  assert.match(blocked.error, /blocked before presentation/)
  const result = await s.send({ type: 'OPEN_LIBRARY_HERE' }, sender)
  assert.equal(result.ok, true)
  assert.equal(s.tabs.get(7).url, origin + 'library.html')
  assert.equal(s.tabs.size, 1)
  assert.equal(s.calls.filter(([type]) => type === 'create').length, 0)
  assert.equal(
    (
      await s.send(
        { type: 'OPEN_LIBRARY_HERE' },
        { ...sender, url: 'https://example.com/' }
      )
    ).ok,
    false
  )
})

test('spreadsheet fallback cannot replace a tab used by a running import', async () => {
  for (const job of [
    { id: 'running', state: 'running', source: { tabId: 7 }, orders: [] },
    { id: 'running', state: 'running', workerTabId: 7, orders: [] },
  ]) {
    const s = setup()
    s.jobs.set(job.id, job)
    const result = await s.send({ type: 'OPEN_LIBRARY_HERE' }, sender)
    assert.equal(result.ok, false)
    assert.match(result.error, /Pause or finish/)
    assert.equal(s.tabs.get(7).url, listUrl)
  }
})

test('list progress and pause/resume are limited to the original source tab and frame', async () => {
  const s = setup()
  const created = await s.send(
    { type: 'IMPORT_START', scope: 'selected', orderIds: ['10001'] },
    sender
  )
  await settle()
  const jobId = created.data.id
  const status = await s.send({ type: 'IMPORT_STATUS' }, sender)
  assert.equal(status.data.jobs[0].id, jobId)
  assert.equal(status.data.jobs[0].discovered, 1)
  assert.equal(status.data.jobs[0].scope, 'selected')
  assert.equal(status.data.jobs[0].remaining, 1)
  assert.equal('orders' in status.data.jobs[0], false)
  for (const other of [
    { ...sender, frameId: 0 },
    { ...sender, tab: { id: 8 } },
  ]) {
    assert.equal(
      (await s.send({ type: 'IMPORT_STATUS' }, other)).data.jobs.length,
      0
    )
    assert.equal(
      (await s.send({ type: 'IMPORT_PAUSE', jobId }, other)).ok,
      false
    )
  }
  assert.equal(
    (
      await s.send(
        { type: 'IMPORT_STATUS' },
        { ...sender, url: 'https://example.com/' }
      )
    ).ok,
    false
  )
  const paused = await s.send({ type: 'IMPORT_PAUSE', jobId }, sender)
  assert.equal(paused.ok, true)
  assert.equal(s.jobs.get(jobId).state, 'paused')
  assert.equal(
    (await s.send({ type: 'IMPORT_RESUME', jobId }, { ...sender, frameId: 0 }))
      .ok,
    false
  )
  assert.equal(
    (await s.send({ type: 'IMPORT_RESUME', jobId }, sender)).ok,
    true
  )
  await settle()
  assert.equal(s.jobs.get(jobId).state, 'running')
  await s.send({ type: 'IMPORT_PAUSE', jobId })
  const job = s.jobs.get(jobId)
  job.error = ''
  job.orders[0].state = 'failed'
  job.orders[0].error = 'Expected 40 product rows but read 3.'
  assert.match(
    (await s.send({ type: 'IMPORT_STATUS' }, sender)).data.jobs[0].error,
    /Expected 40/
  )
  job.state = 'running'
  const continuing = (await s.send({ type: 'IMPORT_STATUS' }, sender)).data
    .jobs[0]
  assert.equal(continuing.error, '')
  assert.equal(continuing.failed, 1)
  assert.equal(job.orders[0].error, 'Expected 40 product rows but read 3.')
  job.error = 'A job-level problem'
  assert.equal(
    (await s.send({ type: 'IMPORT_STATUS' }, sender)).data.jobs[0].error,
    'A job-level problem'
  )
})

test('the workspace opens the tab that needs a sign-in only when asked', async () => {
  const s = setup()
  const focused = []
  s.chrome.windows = {
    update: async (id, options) => focused.push([id, options]),
  }
  s.tabs.set(60, {
    id: 60,
    url: 'https://login.1688.com/',
    status: 'complete',
    windowId: 3,
  })
  s.jobs.set('job-attention', {
    id: 'job-attention',
    state: 'paused',
    orders: [],
    attention: {
      kind: 'sign-in',
      tabId: 60,
      orderId: '10001',
      at: '2026-10-19T10:00:00.000Z',
    },
  })
  const opened = await s.send(
    { type: 'IMPORT_ATTENTION_OPEN', jobId: 'job-attention' },
    own
  )
  assert.equal(opened.ok, true, opened.error)
  assert.equal(s.tabs.get(60).active, true)
  assert.equal(
    JSON.stringify(focused),
    JSON.stringify([[3, { focused: true }]])
  )
  // Content pages cannot trigger it, and a closed tab explains itself.
  const refused = await s.send(
    { type: 'IMPORT_ATTENTION_OPEN', jobId: 'job-attention' },
    sender
  )
  assert.equal(refused.ok, false)
  s.tabs.delete(60)
  const closed = await s.send(
    { type: 'IMPORT_ATTENTION_OPEN', jobId: 'job-attention' },
    own
  )
  assert.equal(closed.ok, false)
  assert.match(closed.error, /tab was closed/)
})
