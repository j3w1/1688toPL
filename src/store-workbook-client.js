const cancelled = () => new DOMException('Import cancelled', 'AbortError')
const unreadable = () => new Error('Spreadsheet could not be read.')
const startupTimeout = 15_000
const decodeTimeout = 5 * 60_000

/** The frame and its private channel belong to this file selection alone. */
export async function readStoreWorkbookAsync(
  buffer,
  { filename, signal, reportEvidence = false, limits } = {}
) {
  if (signal?.aborted) throw cancelled()

  const frame = document.createElement('iframe')
  frame.hidden = true
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.src = 'store-workbook-sandbox.html'

  return new Promise((resolve, reject) => {
    let port, settled, deadline
    const finish = (action, result) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      signal?.removeEventListener('abort', abort)
      window.removeEventListener('message', ready)
      port?.close()
      frame.remove()
      action(result)
    }
    const abort = () => finish(reject, cancelled())
    const fail = () => finish(reject, unreadable())
    const ready = ({ source, origin, data, ports }) => {
      if (
        source !== frame.contentWindow ||
        origin !== 'null' ||
        data !== 'store-workbook-ready' ||
        ports.length !== 1
      )
        return
      window.removeEventListener('message', ready)
      clearTimeout(deadline)
      // A lost renderer can leave its port silent on stable Chromium.
      deadline = setTimeout(fail, decodeTimeout)
      port = ports[0]
      port.onmessageerror = fail
      port.onmessage = ({ data: result }) => {
        if (typeof result?.error === 'string')
          finish(reject, new Error(result.error))
        else if (Array.isArray(result?.workbook?.sheets))
          finish(resolve, result.workbook)
        else fail()
      }
      try {
        const transferred = reportEvidence ? buffer.slice(0) : buffer
        port.postMessage(
          {
            buffer: transferred,
            filename,
            ...(reportEvidence ? { reportEvidence, limits } : {}),
          },
          [transferred]
        )
      } catch {
        fail()
      }
    }
    // Chromium can dispatch iframe load even when its script failed to start.
    deadline = setTimeout(fail, startupTimeout)
    signal?.addEventListener('abort', abort, { once: true })
    window.addEventListener('message', ready)
    try {
      document.body.append(frame)
    } catch {
      fail()
    }
  })
}
