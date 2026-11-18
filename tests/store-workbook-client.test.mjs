import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { readStoreWorkbookAsync } from '../src/store-workbook-client.js'

test('Store sandbox preserves its request contract and disposes after success, error or cancellation', async (t) => {
  const previousWindow = globalThis.window,
    previousDocument = globalThis.document,
    frames = []
  globalThis.window = new EventTarget()
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'iframe')
      return {
        contentWindow: {},
        setAttribute() {},
        remove() {
          this.removed = true
        },
      }
    },
    body: { append: (frame) => frames.push(frame) },
  }
  t.after(() => {
    globalThis.window = previousWindow
    globalThis.document = previousDocument
  })

  const connect = async (untouchedBuffer) => {
    const frame = frames.at(-1),
      { port1: sender, port2: receiver } = new MessageChannel(),
      closed = once(sender, 'close'),
      message = once(sender, 'message')
    t.after(() => {
      sender.close()
      receiver.close()
    })
    const ready = (overrides) =>
      window.dispatchEvent(
        Object.assign(new Event('message'), {
          source: frame.contentWindow,
          origin: 'null',
          data: 'store-workbook-ready',
          ports: [receiver],
          ...overrides,
        })
      )
    if (untouchedBuffer) {
      ready({ source: {} })
      ready({ origin: 'https://example.invalid' })
      assert.equal(untouchedBuffer.byteLength, 1)
    }
    ready()
    const [request] = await message
    return { frame, sender, request, closed }
  }

  const buffer = Uint8Array.from([1, 2, 3]).buffer
  const read = readStoreWorkbookAsync(buffer, {
    filename: 'x.xlsx',
    reportEvidence: true,
    limits: { sheets: 4 },
  })
  const report = await connect()
  assert.equal(buffer.byteLength, 3)
  assert.equal(report.request.reportEvidence, true)
  assert.deepEqual(report.request.limits, { sheets: 4 })
  report.sender.postMessage({ workbook: { filename: 'x.xlsx', sheets: [] } })
  assert.equal((await read).filename, 'x.xlsx')
  assert.equal(report.frame.removed, true)
  await report.closed

  const legacyBuffer = Uint8Array.from([1]).buffer
  const legacy = readStoreWorkbookAsync(legacyBuffer, {
    filename: 'legacy.xls',
  })
  const legacySandbox = await connect(legacyBuffer)
  assert.deepEqual(Object.keys(legacySandbox.request).sort(), [
    'buffer',
    'filename',
  ])
  legacySandbox.sender.postMessage({ workbook: { sheets: [] } })
  await legacy
  assert.equal(legacySandbox.frame.removed, true)
  await legacySandbox.closed

  const controller = new AbortController()
  const cancelled = readStoreWorkbookAsync(Uint8Array.from([1]).buffer, {
    signal: controller.signal,
  })
  const cancelledSandbox = await connect()
  controller.abort()
  await assert.rejects(cancelled, { name: 'AbortError' })
  assert.equal(cancelledSandbox.frame.removed, true)
  await cancelledSandbox.closed
  const frameCount = frames.length
  await assert.rejects(
    readStoreWorkbookAsync(Uint8Array.from([1]).buffer, {
      signal: controller.signal,
    }),
    { name: 'AbortError' }
  )
  assert.equal(frames.length, frameCount)

  const invalid = readStoreWorkbookAsync(Uint8Array.from([1]).buffer)
  const invalidSandbox = await connect()
  invalidSandbox.sender.postMessage({ error: 'Invalid workbook' })
  await assert.rejects(invalid, { message: 'Invalid workbook' })
  assert.equal(invalidSandbox.frame.removed, true)
  await invalidSandbox.closed
})
