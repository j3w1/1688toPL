import { cp, mkdir, realpath } from 'node:fs/promises'
import path from 'node:path'

export async function copyExtension(buildDirectory, directory) {
  const source = await realpath(buildDirectory)
  const parent = await realpath(path.dirname(directory))
  const destination = path.join(parent, path.basename(directory))
  const relative = path.relative(source, destination)
  if (
    relative === '' ||
    (!path.isAbsolute(relative) &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`))
  )
    throw new Error('Disposable extension must be outside the source build')
  // An existing destination (including a symlink) must never receive edits.
  await mkdir(destination)
  // Dereference the root and every nested link into independent files before
  // the fixture adds permissions, keys or synthetic origin substitutions.
  await cp(source, destination, {
    recursive: true,
    dereference: true,
    force: false,
  })
}
