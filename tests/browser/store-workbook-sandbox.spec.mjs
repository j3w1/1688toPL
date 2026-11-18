import { readFile } from 'node:fs/promises'
import { utils, write } from 'xlsx'
import { readStoreWorkbook } from '../../src/store-workbook-reader.js'
import { png, workbookFile } from '../fixtures/store-workbook-fixture.mjs'
import { test, expect } from './extension-fixture.mjs'

const sandboxUrl = 'store-workbook-sandbox.html'
const sandboxFrame = 'iframe[src="store-workbook-sandbox.html"]'

async function openImport(page) {
  await expect(page.locator('#view-orders')).toBeEnabled()
  await page
    .getByRole('button', { name: 'Import spreadsheet', exact: true })
    .click()
  const dialog = page.locator('.store-import-dialog')
  await expect(dialog).toBeVisible()
  return { dialog, file: dialog.getByLabel('Workbook', { exact: true }) }
}

async function newWorkspace(extension) {
  const page = await extension.context.newPage()
  await page.goto(`${extension.extensionBaseUrl}/library.html`)
  return page
}

// Only hold replies at the receiving end. The production sandbox, channel
// hand-off and workbook parsing still run for every released file read.
async function interceptDecoding(page, heldReplies = []) {
  await page.evaluate((held) => {
    const postMessage = MessagePort.prototype.postMessage
    window.storeDecodes = {}
    MessagePort.prototype.postMessage = function (data, ...options) {
      if (data?.buffer instanceof ArrayBuffer && data?.filename) {
        const decode = (window.storeDecodes[data.filename] = {})
        const receive = this.onmessage
        this.onmessage = (event) => {
          decode.result = event.data
          if (held.includes(data.filename))
            decode.release = () => receive.call(this, event)
          else receive.call(this, event)
        }
      }
      return postMessage.call(this, data, ...options)
    }
  }, heldReplies)
}

async function completedDecode(page, name) {
  await expect
    .poll(() =>
      page.evaluate((name) => !!window.storeDecodes[name]?.result, name)
    )
    .toBe(true)
  return page.evaluate((name) => window.storeDecodes[name].result, name)
}

async function storeCounts(extension) {
  return extension.inspector.evaluate(async () => {
    await window.testRepository
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('1688-order-library')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const stores = [...db.objectStoreNames]
      const transaction = db.transaction(stores, 'readonly')
      return Object.fromEntries(
        await Promise.all(
          stores.map(
            (name) =>
              new Promise((resolve, reject) => {
                const request = transaction.objectStore(name).count()
                request.onsuccess = () => resolve([name, request.result])
                request.onerror = () => reject(request.error)
              })
          )
        )
      )
    } finally {
      db.close()
    }
  })
}

test('packaged Store sandbox keeps XLSX and BIFF8 decoder parity under its effective browser policy', async ({
  extension,
}) => {
  const dist = new URL('../../dist/', import.meta.url)
  const manifest = JSON.parse(await readFile(new URL('manifest.json', dist)))
  expect(manifest.sandbox.pages).toEqual([sandboxUrl])
  expect(manifest.web_accessible_resources ?? []).toEqual([])
  expect(await readFile(new URL(sandboxUrl, dist), 'utf8')).toContain(
    'src="store-workbook-sandbox.js"'
  )
  await expect(
    readFile(new URL('store-workbook-worker.js', dist))
  ).rejects.toMatchObject({
    code: 'ENOENT',
  })

  const page = await newWorkspace(extension)
  const { dialog, file } = await openImport(page)
  await interceptDecoding(page, ['4321.xlsx'])
  const xlsx = workbookFile({
    additionalSheets: [{ name: 'Notes & values', rows: [[0, false, '中文']] }],
  })
  await file.setInputFiles(xlsx)
  const received = await completedDecode(page, xlsx.name)
  expect(received.workbook).toEqual(
    await readStoreWorkbook(xlsx.buffer, { filename: xlsx.name })
  )
  expect(received.workbook.sheets[0].images[0].dataUrl).toBe(
    `data:image/png;base64,${png.toString('base64')}`
  )
  const frame = page.frames().find((entry) => entry.url().endsWith(sandboxUrl))
  expect(frame).toBeTruthy()
  const policy = await frame.evaluate(async (url) => {
    const blocked = (operation) => {
      try {
        operation()
        return false
      } catch {
        return true
      }
    }
    const violations = []
    document.addEventListener('securitypolicyviolation', (event) =>
      violations.push(event.effectiveDirective)
    )
    const connectViolation = new Promise((resolve) => {
      const listener = (event) => {
        if (event.effectiveDirective !== 'connect-src') return
        document.removeEventListener('securitypolicyviolation', listener)
        resolve(true)
      }
      document.addEventListener('securitypolicyviolation', listener)
      setTimeout(() => resolve(false), 1000)
    })
    const workerUrl = URL.createObjectURL(
      new Blob(['postMessage(true)'], { type: 'text/javascript' })
    )
    let workerBlocked
    try {
      const worker = new Worker(workerUrl)
      workerBlocked = await new Promise((resolve) => {
        worker.onerror = () => resolve(true)
        worker.onmessage = () => resolve(false)
      })
      worker.terminate()
    } catch {
      workerBlocked = true
    }
    URL.revokeObjectURL(workerUrl)
    const fetchBlocked = await fetch(url).then(
      () => false,
      () => true
    )
    const connectBlockedByPolicy = await connectViolation
    return {
      origin: self.origin,
      extensionAPI: Boolean(globalThis.chrome?.runtime),
      parentBlocked: blocked(() => parent.document.body),
      databaseBlocked: blocked(() => indexedDB.open('sandbox-probe')),
      evalBlocked: blocked(() => Function('return 1')()),
      workerBlocked,
      fetchBlocked,
      connectBlockedByPolicy,
      violations,
    }
  }, `${extension.origin}/fixture.html`)
  expect(policy).toMatchObject({
    origin: 'null',
    extensionAPI: false,
    parentBlocked: true,
    databaseBlocked: true,
    evalBlocked: true,
    workerBlocked: true,
    fetchBlocked: true,
    connectBlockedByPolicy: true,
    violations: expect.arrayContaining(['worker-src', 'connect-src']),
  })
  await page.evaluate(() => window.storeDecodes['4321.xlsx'].release())
  await expect(dialog.locator('.store-import-product')).toHaveCount(1)
  await expect(page.locator(sandboxFrame)).toHaveCount(0)

  const binary = utils.book_new()
  const sheet = utils.aoa_to_sheet([
    ['literal', 'merge'],
    [3, false],
  ])
  sheet['!merges'] = [{ s: { r: 0, c: 1 }, e: { r: 1, c: 1 } }]
  utils.book_append_sheet(binary, sheet, 'Legacy')
  const xls = {
    name: '4321.xls',
    mimeType: 'application/vnd.ms-excel',
    buffer: Buffer.from(write(binary, { type: 'array', bookType: 'biff8' })),
  }
  await file.setInputFiles(xls)
  expect((await completedDecode(page, xls.name)).workbook).toEqual(
    await readStoreWorkbook(xls.buffer, { filename: xls.name })
  )
  await expect(page.locator(sandboxFrame)).toHaveCount(0)

  const invalid = { ...xlsx, name: 'invalid.xlsx', buffer: Buffer.from('bad') }
  await file.setInputFiles(invalid)
  expect((await completedDecode(page, invalid.name)).error).toBe(
    'Choose an Excel .xlsx or .xls workbook.'
  )
  await expect(dialog.locator('.store-import-status')).toHaveText(
    'Choose an Excel .xlsx or .xls workbook.'
  )
  await expect(page.locator(sandboxFrame)).toHaveCount(0)

  // The workspace CSP also constrains navigation of the sandbox itself.
  const destination = `${extension.origin}/sandbox-navigation-probe`
  const navigated = []
  await page.route(destination, (route) => {
    navigated.push(route.request().url())
    return route.abort()
  })
  const attached = page.waitForEvent('framenavigated', {
    predicate: (candidate) => candidate.url().endsWith(sandboxUrl),
  })
  await page.evaluate((url) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.src = url
    document.body.append(frame)
  }, sandboxUrl)
  const navigationProbe = await attached
  const blockedNavigation = page.waitForEvent('framenavigated', {
    predicate: (candidate) => candidate === navigationProbe,
  })
  await navigationProbe.evaluate((url) => {
    location.assign(url)
  }, destination)
  expect((await blockedNavigation).url()).toBe('chrome-error://chromewebdata/')
  expect(navigated).toEqual([])
})

test('Store replacement and close fence delayed file reads and late real decoder replies', async ({
  extension,
}) => {
  const page = await newWorkspace(extension)
  const before = await storeCounts(extension)
  await interceptDecoding(page, ['4322.xlsx', '4324.xlsx'])
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer
    window.storeFileReads = {}
    File.prototype.arrayBuffer = function () {
      if (!['4321.xlsx', '4325.xlsx'].includes(this.name))
        return read.call(this)
      return new Promise((resolve) => {
        window.storeFileReads[this.name] = async () =>
          resolve(await read.call(this))
      })
    }
  })
  const { dialog, file } = await openImport(page)
  const choose = (name) => file.setInputFiles(workbookFile({ name }))
  await choose('4321.xlsx')
  await expect
    .poll(() => page.evaluate(() => !!window.storeFileReads['4321.xlsx']))
    .toBe(true)
  await expect(file).toBeEnabled()
  await expect(page.locator(sandboxFrame)).toHaveCount(0)

  await choose('4322.xlsx')
  await completedDecode(page, '4322.xlsx')
  await expect(page.locator(sandboxFrame)).toHaveCount(1)
  await page.evaluate(() => window.storeFileReads['4321.xlsx']())
  expect(
    await page.evaluate(() => window.storeDecodes['4321.xlsx'] ?? null)
  ).toBeNull()
  await expect(page.locator(sandboxFrame)).toHaveCount(1)
  await expect(dialog.locator('.store-import-product')).toHaveCount(0)

  await choose('4323.xlsx')
  await expect(dialog.locator('.store-import-product')).toHaveCount(1)
  await expect(dialog.locator('input[name="storeName"]')).toHaveValue('4323')
  await expect(page.locator(sandboxFrame)).toHaveCount(0)
  await page.evaluate(() => window.storeDecodes['4322.xlsx'].release())
  await expect(dialog.locator('input[name="storeName"]')).toHaveValue('4323')
  expect(await storeCounts(extension)).toEqual(before)

  await choose('4324.xlsx')
  await completedDecode(page, '4324.xlsx')
  await expect(page.locator(sandboxFrame)).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.locator(sandboxFrame)).toHaveCount(0)
  await page.evaluate(() => window.storeDecodes['4324.xlsx'].release())

  await openImport(page)
  await choose('4325.xlsx')
  await expect
    .poll(() => page.evaluate(() => !!window.storeFileReads['4325.xlsx']))
    .toBe(true)
  await dialog.getByRole('button', { name: 'Close import' }).click()
  await expect(dialog).toHaveCount(0)
  await page.evaluate(() => window.storeFileReads['4325.xlsx']())
  expect(
    await page.evaluate(() => window.storeDecodes['4325.xlsx'] ?? null)
  ).toBeNull()
  await expect(page.locator(sandboxFrame)).toHaveCount(0)
  await expect(page.locator('#sheet-body tr[data-selection-key]')).toHaveCount(
    0
  )
  expect(await storeCounts(extension)).toEqual(before)
})

test('a decoder that accepts the file and never replies is disposed, and the next workbook still opens', async ({
  extension,
}) => {
  const page = await newWorkspace(extension)
  await page.clock.install()
  const before = await storeCounts(extension)
  const { dialog, file } = await openImport(page)
  await interceptDecoding(page, ['4321.xlsx'])
  await file.setInputFiles(workbookFile())
  await completedDecode(page, '4321.xlsx')

  const status = dialog.locator('.store-import-status')
  await page.clock.fastForward(240_000)
  await expect(status).toHaveText('Reading workbook and product photos…')
  await expect(page.locator(sandboxFrame)).toHaveCount(1)
  await page.clock.fastForward(60_000)
  await expect(status).toHaveText(
    'Could not read this workbook. Check the file and try again.'
  )
  await expect(page.locator(sandboxFrame)).toHaveCount(0)
  await expect(dialog.locator('form')).toHaveAttribute('aria-busy', 'false')

  await page.evaluate(() => window.storeDecodes['4321.xlsx'].release())
  await expect(dialog.locator('.store-import-product')).toHaveCount(0)
  await file.setInputFiles(workbookFile({ name: '4322.xlsx' }))
  await expect(dialog.locator('.store-import-product')).toHaveCount(1)
  await expect(dialog.locator('input[name="storeName"]')).toHaveValue('4322')
  expect(await storeCounts(extension)).toEqual(before)
})

test('Orders renders a frame while the actual sandbox decoder is computing a large workbook', async ({
  extension,
}) => {
  await extension.context.addInitScript((sandboxUrl) => {
    if (!location.pathname.endsWith(sandboxUrl)) return
    const listen = MessagePort.prototype.addEventListener
    const now = () => performance.timeOrigin + performance.now()
    MessagePort.prototype.addEventListener = function (
      type,
      listener,
      options
    ) {
      if (type !== 'message') return listen.call(this, type, listener, options)
      return listen.call(
        this,
        type,
        async (event) => {
          const start = now()
          await listener.call(this, event)
          parent.postMessage(
            { storeDecodeTimes: [start, now()] },
            location.origin
          )
        },
        options
      )
    }
  }, sandboxUrl)
  const page = await newWorkspace(extension)
  const { dialog, file } = await openImport(page)
  await interceptDecoding(page, ['4321.xlsx'])
  await page.evaluate(() => {
    window.ticksDuringDecode = []
    const tick = () => {
      window.ticksDuringDecode.push(performance.timeOrigin + performance.now())
      if (!window.storeDecodeTimes) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    window.addEventListener('message', ({ data }) => {
      if (data?.storeDecodeTimes)
        window.storeDecodeTimes = data.storeDecodeTimes
    })
  })
  await file.setInputFiles(
    workbookFile({
      additionalSheets: [
        {
          name: 'Synthetic decoder load',
          rows: Array.from({ length: 18000 }, (_, row) => [
            row,
            row * 2,
            `Synthetic row ${row}`,
            true,
            'Notes',
            '中文',
            'units',
            'last',
          ]),
        },
      ],
    })
  )
  await expect
    .poll(() => page.evaluate(() => window.storeDecodeTimes ?? null))
    .not.toBeNull()
  const observation = await page.evaluate(() => {
    const [start, end] = window.storeDecodeTimes
    return window.ticksDuringDecode.filter((tick) => start < tick && tick < end)
      .length
  })
  expect(observation).toBeGreaterThan(0)
  await completedDecode(page, '4321.xlsx')
  await page.evaluate(() => window.storeDecodes['4321.xlsx'].release())
  await expect(dialog.locator('.store-import-product')).toHaveCount(1)
  await expect(page.locator(sandboxFrame)).toHaveCount(0)
})
