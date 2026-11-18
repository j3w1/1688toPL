import { readStoreWorkbook } from './store-workbook-reader.js'

if (parent !== window && window.origin === 'null') {
  const { port1, port2 } = new MessageChannel()
  port1.addEventListener(
    'message',
    async ({ data }) => {
      try {
        const workbook = await readStoreWorkbook(data.buffer, {
          filename: data.filename,
          reportEvidence: data.reportEvidence === true,
          limits: data.limits,
        })
        port1.postMessage({ workbook })
      } catch (error) {
        port1.postMessage({
          error: error.message || 'Spreadsheet could not be read.',
        })
      }
    },
    { once: true }
  )
  port1.addEventListener('messageerror', () => port1.close(), { once: true })
  port1.start()
  parent.postMessage('store-workbook-ready', location.origin, [port2])
}
