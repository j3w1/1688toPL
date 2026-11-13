import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export function validateCiBrowserImages(workflow, lock) {
  const version = lock.packages?.['node_modules/@playwright/test']?.version
  assert.match(
    version || '',
    /^\d+\.\d+\.\d+$/,
    'Playwright must be locked exactly'
  )
  const expected = `mcr.microsoft.com/playwright:v${version}-noble`
  const lines = workflow.split(/\r?\n/)
  for (const job of ['code', 'browser']) {
    const start = lines.indexOf(`  ${job}:`)
    assert.ok(start >= 0, `Missing ${job} job`)
    const remaining = lines.slice(start + 1)
    const next = remaining.findIndex((line) => /^  [\w-]+:/.test(line))
    const body = (next < 0 ? remaining : remaining.slice(0, next)).join('\n')
    assert.equal(
      body.match(/^      image: (\S+)$/m)?.[1],
      expected,
      `${job} container must match locked @playwright/test ${version}`
    )
    const options = body.match(/^      options: (.+)$/m)?.[1].split(/\s+/) || []
    for (const flag of ['--init', '--ipc=host'])
      assert.ok(
        options.includes(flag),
        `${job} Chromium container requires ${flag}`
      )
  }
}

export async function checkCiBrowserImages() {
  const [workflow, lock] = await Promise.all([
    readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'),
    readFile(new URL('../package-lock.json', import.meta.url), 'utf8'),
  ])
  validateCiBrowserImages(workflow, JSON.parse(lock))
  console.log('CI browser images match the locked Playwright version')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await checkCiBrowserImages()
