import {
  initializeVocabulary,
  VOCABULARY_VERSION,
} from './product-vocabulary.js'
import {
  MATERIAL_VOCABULARY,
  MATERIAL_VOCABULARY_VERSION,
  MATERIAL_VOCABULARY_UPDATE,
  validateMaterialVocabulary,
} from './material-vocabulary.js'
import {
  COLOR_VOCABULARY,
  COLOR_VOCABULARY_VERSION,
  COLOR_VOCABULARY_UPDATE,
  validateColorVocabulary,
} from './color-vocabulary.js'
import {
  DEFAULT_SIZE_VOCABULARY,
  SIZE_VOCABULARY_VERSION,
  SIZE_VOCABULARY_UPDATE,
  validateSizeVocabulary,
} from './size-vocabulary.js'

export const RECOGNITION_VOCABULARY_VERSIONS = Object.freeze({
  vocabulary: VOCABULARY_VERSION,
  materialVocabulary: MATERIAL_VOCABULARY_VERSION,
  colorVocabulary: COLOR_VOCABULARY_VERSION,
  sizeVocabulary: SIZE_VOCABULARY_VERSION,
})

const stable = (value) =>
  JSON.stringify(value, (_, entry) =>
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.entries(entry).sort(([left], [right]) =>
            left.localeCompare(right)
          )
        )
      : entry
  )

function upgradeEntries(current, bundled, update, validate, identity) {
  // Undefined uses current bundled defaults. Empty is an intentional opt-out.
  if (!current?.length) return current
  const next = validate(current)
  const defaults = new Map(bundled.map((entry) => [identity(entry), entry]))
  const previous = new Map(
    update.previous.map((entry) => [identity(entry), entry])
  )
  for (let index = 0; index < next.length; index++) {
    const entry = next[index],
      key = identity(entry),
      old = previous.get(key)
    if (!old || stable(entry) !== stable(validate([old])[0])) continue
    const candidate = structuredClone(defaults.get(key))
    const revised = next.with(index, candidate)
    // A custom alias can claim a newly bundled alias. Keep the owner's rule.
    try {
      validate(revised)
      next[index] = candidate
    } catch {
      // The existing validated entries remain unchanged when aliases conflict.
    }
  }
  for (const key of update.additions) {
    if (next.some((entry) => identity(entry) === key)) continue
    const candidate = structuredClone(defaults.get(key))
    try {
      validate([...next, candidate])
      next.push(candidate)
    } catch {
      // Preserve a custom name/alias rather than making preferences invalid.
    }
  }
  return next
}

/** Seed/upgrade dictionaries without editing source, authored details or codes. */
export function initializeRecognitionVocabularies(input) {
  const preferences = initializeVocabulary(input)
  const upgrades = [
    [
      'materialVocabulary',
      MATERIAL_VOCABULARY_VERSION,
      MATERIAL_VOCABULARY,
      MATERIAL_VOCABULARY_UPDATE,
      validateMaterialVocabulary,
      (entry) => entry.id,
    ],
    [
      'colorVocabulary',
      COLOR_VOCABULARY_VERSION,
      COLOR_VOCABULARY,
      COLOR_VOCABULARY_UPDATE,
      validateColorVocabulary,
      (entry) => entry.id,
    ],
    [
      'sizeVocabulary',
      SIZE_VOCABULARY_VERSION,
      DEFAULT_SIZE_VOCABULARY,
      SIZE_VOCABULARY_UPDATE,
      validateSizeVocabulary,
      (entry) => entry.suffix,
    ],
  ]
  let result = preferences
  for (const [
    field,
    version,
    bundled,
    update,
    validate,
    identity,
  ] of upgrades) {
    const versionField = `${field}Version`
    if (result.settings[versionField] === version) continue
    const vocabulary = upgradeEntries(
      result[field],
      bundled,
      update,
      validate,
      identity
    )
    result = {
      ...result,
      ...(vocabulary !== undefined ? { [field]: vocabulary } : {}),
      settings: { ...result.settings, [versionField]: version },
    }
  }
  return result
}
