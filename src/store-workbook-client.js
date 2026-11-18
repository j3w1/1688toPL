const cancelled = () => new DOMException('Import cancelled', 'AbortError')
const unreadable = () => new Error('Spreadsheet could not be read.')

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
    let port, settled
    const finish = (action, result) => {
      if (settled) return
      settled = true
      clearTimeout(startup)
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
      clearTimeout(startup)
      port = ports[0]
      port.addEventListener('close', fail)
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
    const startup = setTimeout(fail, 15_000)
    signal?.addEventListener('abort', abort, { once: true })
    window.addEventListener('message', ready)
    try {
      document.body.append(frame)
    } catch {
      fail()
    }
  })
}
