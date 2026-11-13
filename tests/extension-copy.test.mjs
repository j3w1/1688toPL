import test from 'node:test'
import assert from 'node:assert/strict'
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { copyExtension } from './helpers/extension-copy.mjs'

const originals = new Map([
  ['manifest.json', Buffer.from('{"key":"production","permissions":[]}\n')],
  ['background.js', Buffer.from('fetch("https://air.1688.com/order")\n')],
  [
    'assets/library.js',
    Buffer.from('const origin = "https://work.1688.com"\n'),
  ],
])

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'extension-copy-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'production')
  await mkdir(path.join(source, 'assets'), { recursive: true })
  for (const [name, bytes] of originals)
    await writeFile(path.join(source, name), bytes)
  return { root, source, destination: path.join(root, 'disposable') }
}

async function assertIsolatedEdits(source, destination) {
  assert.equal((await lstat(destination)).isSymbolicLink(), false)
  assert.equal(
    (await lstat(path.join(destination, 'assets'))).isSymbolicLink(),
    false
  )
  for (const [name, bytes] of originals) {
    const file = path.join(destination, name)
    assert.equal((await lstat(file)).isSymbolicLink(), false, name)
    assert.deepEqual(await readFile(file), bytes, `copied ${name}`)
    // Match the fixture's test-only manifest and synthetic-origin edits.
    const edited =
      name === 'manifest.json'
        ? Buffer.from('{"key":"test-only","permissions":["scripting"]}\n')
        : Buffer.from(bytes.toString().replaceAll('1688.com', '1688.test'))
    await writeFile(file, edited)
    assert.deepEqual(await readFile(file), edited, `edited ${name}`)
    assert.deepEqual(
      await readFile(path.join(source, name)),
      bytes,
      `source ${name} must remain byte-for-byte unchanged`
    )
  }
  await writeFile(path.join(destination, 'test-repository.js'), 'test only')
  await assert.rejects(lstat(path.join(source, 'test-repository.js')), {
    code: 'ENOENT',
  })
}

for (const linked of [false, true]) {
  test(`test-only edits preserve source bytes with ${linked ? 'a symlinked' : 'an ordinary'} dist`, async (t) => {
    const { root, source, destination } = await fixture(t)
    let build = source
    if (linked) {
      build = path.join(root, 'dist')
      await symlink(source, build, 'junction')
    }
    await copyExtension(build, destination)
    await assertIsolatedEdits(source, destination)
  })
}

test('nested file and directory links become isolated copies before test-only edits', async (t) => {
  const { root, source, destination } = await fixture(t)
  const build = path.join(root, 'dist')
  await mkdir(build)
  for (const name of ['manifest.json', 'background.js'])
    await symlink(path.join(source, name), path.join(build, name), 'file')
  await symlink(
    path.join(source, 'assets'),
    path.join(build, 'assets'),
    'junction'
  )
  await copyExtension(build, destination)
  await assertIsolatedEdits(source, destination)
})

test('an existing destination link is refused without changing source bytes', async (t) => {
  const { source, destination } = await fixture(t)
  await symlink(source, destination, 'junction')
  await assert.rejects(copyExtension(source, destination), { code: 'EEXIST' })
  for (const [name, bytes] of originals)
    assert.deepEqual(await readFile(path.join(source, name)), bytes)
})

test('a destination inside the resolved build is refused before creating files', async (t) => {
  const { root, source } = await fixture(t)
  const build = path.join(root, 'dist')
  await symlink(source, build, 'junction')
  const destination = path.join(build, 'disposable')
  await assert.rejects(
    copyExtension(build, destination),
    /Disposable extension must be outside the source build/
  )
  await assert.rejects(lstat(destination), { code: 'ENOENT' })
})
