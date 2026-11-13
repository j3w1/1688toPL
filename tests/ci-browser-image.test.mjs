import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { validateCiBrowserImages } from '../scripts/check-ci-browser.mjs'

const workflow = readFileSync(
  new URL('../.github/workflows/ci.yml', import.meta.url),
  'utf8'
)
const lock = JSON.parse(
  readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')
)

test('both real CI browser jobs use the locked image, init and Chromium IPC options', () => {
  validateCiBrowserImages(workflow, lock)
})

test('a Playwright bump or either mismatched container fails before CI tests', () => {
  const bumped = structuredClone(lock)
  bumped.packages['node_modules/@playwright/test'].version = '99.0.0'
  assert.throws(
    () => validateCiBrowserImages(workflow, bumped),
    /must match locked/
  )
  const image = `mcr.microsoft.com/playwright:v${lock.packages['node_modules/@playwright/test'].version}-noble`
  const first = workflow.indexOf(image)
  const second = workflow.indexOf(image, first + image.length)
  assert.ok(first >= 0 && second > first)
  for (const offset of [first, second]) {
    const changed =
      workflow.slice(0, offset) +
      'mcr.microsoft.com/playwright:v99.0.0-noble' +
      workflow.slice(offset + image.length)
    assert.throws(
      () => validateCiBrowserImages(changed, lock),
      /must match locked/
    )
  }
  assert.throws(
    () =>
      validateCiBrowserImages(
        workflow.replaceAll('--ipc=host', '--init'),
        lock
      ),
    /requires --ipc=host/
  )
  assert.throws(
    () => validateCiBrowserImages(workflow.replace(/--init\b\s*/g, ''), lock),
    /requires --init/
  )
})
