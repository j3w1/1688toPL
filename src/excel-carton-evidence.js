import {
  physicalUnits,
  batchNeedsLegacyReview,
  orderKey,
  productKey,
  effectiveShipments,
  decimalTotal,
} from './inventory-model.js'
import { cartonDecimal, cartonBatchMetrics } from './carton-batches.js'
import { cartonMeasurementTotals } from './container-model.js'

const words = {
  en: {
    internal: 'Internal',
    cartons: 'cartons',
    batch: 'batch total',
    each: 'per carton',
    shared: 'shared',
    review: 'review',
    unknown: 'Unknown',
  },
  es: {
    internal: 'Interna',
    cartons: 'cajas',
    batch: 'total del lote',
    each: 'por caja',
    shared: 'compartida',
    review: 'revisar',
    unknown: 'Desconocido',
  },
  zh: {
    internal: '内部',
    cartons: '箱',
    batch: '整批合计',
    each: '每箱',
    shared: '共箱',
    review: '待核对',
    unknown: '未知',
  },
}
const decimal = (value) => cartonDecimal(value ?? '')
const sum = (values) =>
  values.every((value) => value !== null && value !== '')
    ? decimalTotal(values)
    : ''
const owns = (row, content, accountId) =>
  productKey(accountId, content.orderId, content.entryId) ===
  productKey(row.accountId, row.orderId, row.entryId)
const validCount = (value) => Number.isSafeInteger(value) && value >= 0
function repeated(value, count) {
  if (value === '') return ''
  const [whole, fraction = ''] = value.split('.')
  const digits = String(BigInt(whole + fraction) * BigInt(count)).padStart(
    fraction.length + 1,
    '0'
  )
  return decimal(
    fraction.length
      ? `${digits.slice(0, -fraction.length)}.${digits.slice(-fraction.length)}`
      : digits
  )
}

function loadingEvidence(containers = [], cartons = []) {
  const result = new Map()
  // Effective shipment facts take precedence over an unfinished amendment.
  for (const { manifest } of effectiveShipments(containers))
    for (const carton of manifest.cartons || [])
      result.set(carton.id || carton.cartonId, 'loaded')
  for (const container of containers) {
    if (!['draft', 'amending'].includes(container.status)) continue
    for (const member of container.draft?.orders || [])
      for (const carton of member.cartons || []) {
        const id = carton.id || carton.cartonId
        if (!result.has(id))
          result.set(id, container.draft.decisions?.[id] || 'unconfirmed')
      }
  }
  // A frozen container context already contains the chosen revision's units.
  for (const carton of cartons)
    if (carton.state) result.set(carton.id || carton.cartonId, carton.state)
  return result
}

function unitObservation(unit, batch, index, labels, loading) {
  const reference =
    unit.labelOrigin === 'internal'
      ? `${labels.internal} ${index + 1}.${unit.index + 1}`
      : unit.reference ||
        unit.cartonNumber ||
        `${labels.internal} ${index + 1}.${unit.index + 1}`
  return {
    id: unit.id || unit.cartonId,
    batchId: batch.id,
    references: [reference],
    count: 1,
    len: decimal(unit.len),
    wid: decimal(unit.wid),
    ht: decimal(unit.ht),
    weight: unit.weight === null ? '' : decimal(unit.weight),
    volume: unit.volume === null ? '' : decimal(unit.volume),
    weightBasis: 'carton',
    volumeBasis: 'carton',
    shared: (unit.contents || []).length > 1,
    review: !!unit.needsReview,
    ambiguousContents: unit.contents === null,
    state: loading.get(unit.id || unit.cartonId),
  }
}

function batchObservations(row, batch, index, labels, loading) {
  if (batch.deletedAt) return []
  const accountId = batch.accountId || 'local'
  if (accountId !== (row.accountId || 'local')) return []
  const relevant = (batch.contents || []).some((content) =>
    owns(row, content, accountId)
  )
  if (!relevant) return []
  let units
  try {
    units = physicalUnits(batch)
  } catch {
    units = []
  }
  const matching = units.filter(
    (unit) =>
      (!row.cartonId || row.cartonId === unit.id) &&
      (unit.contents || []).some((content) => owns(row, content, accountId))
  )
  const ambiguous = units.filter((unit) => unit.contents === null)
  if (
    units.length &&
    (!ambiguous.length || Object.keys(batch.unitMeasurements || {}).length)
  )
    return [
      ...matching,
      ...ambiguous.filter((unit) => !row.cartonId || row.cartonId === unit.id),
    ].map((unit) => ({
      ...unitObservation(unit, batch, index, labels, loading),
      sourceQuantity:
        unit.contents === null
          ? null
          : String(
              (unit.contents || [])
                .filter((content) => owns(row, content, accountId))
                .reduce(
                  (total, content) => total + BigInt(content.quantity),
                  0n
                )
            ),
      shared:
        unit.contents === null
          ? (batch.contents || []).length > 1
          : unit.contents.length > 1,
      review: !!unit.needsReview || batchNeedsLegacyReview(batch),
    }))

  // Aggregate contents establish a relation to the whole set, not to arbitrary
  // individual boxes. Preserve the set and its declared basis without division.
  const metrics = cartonBatchMetrics(batch)
  const dimensions = ['len', 'wid', 'ht'].map((key) => decimal(batch[key]))
  return [
    {
      id: `batch:${batch.id}`,
      batchId: batch.id,
      references: [batch.cartonNumber || `${labels.internal} ${index + 1}`],
      count: validCount(batch.count) ? batch.count : null,
      len: dimensions[0],
      wid: dimensions[1],
      ht: dimensions[2],
      weight: decimal(batch.weight),
      volume: dimensions.every(Boolean)
        ? metrics.volumePerCarton
        : decimal(batch.suppliedCbm),
      weightBasis: batch.weightBasis || 'carton',
      volumeBasis: dimensions.every(Boolean)
        ? 'carton'
        : batch.volumeBasis || 'carton',
      shared: (batch.contents || []).length > 1,
      review: !!batch.needsReview || batchNeedsLegacyReview(batch),
      ambiguousContents: true,
      unitIds: units.map((unit) => unit.id),
      states: units.map((unit) => loading.get(unit.id)),
    },
  ]
}

function grouped(observations, labels) {
  const groups = new Map()
  for (const observation of observations) {
    const key = JSON.stringify([
      observation.len,
      observation.wid,
      observation.ht,
      observation.weight,
      observation.volume,
      observation.weightBasis,
      observation.volumeBasis,
      observation.shared,
      observation.review,
      observation.ambiguousContents,
      // Independent aggregate totals must never be collapsed as per-box facts.
      observation.weightBasis === 'batch' || observation.volumeBasis === 'batch'
        ? observation.batchId
        : '',
    ])
    let group = groups.get(key)
    if (!group) {
      group = { ...observation, references: [], ids: [], count: 0 }
      groups.set(key, group)
    }
    group.references.push(...observation.references)
    group.ids.push(observation.id)
    group.count =
      group.count === null || observation.count === null
        ? null
        : group.count + observation.count
  }
  return [...groups.values()].map((group, index) => ({
    ...group,
    label: String(index + 1),
    summary: [
      group.count === null
        ? labels.unknown
        : `${group.count} ${labels.cartons}`,
      group.shared ? labels.shared : '',
      group.review ? labels.review : '',
      group.ambiguousContents ? labels.batch : '',
    ]
      .filter(Boolean)
      .join(' · '),
    dimensions: [group.len, group.wid, group.ht].every(Boolean)
      ? `${group.len} × ${group.wid} × ${group.ht}`
      : '',
  }))
}

function compactReferences(references) {
  const ranges = []
  for (const reference of references) {
    const match = reference.match(/^(.*?)(\d+)$/),
      previous = ranges.at(-1)
    if (
      match &&
      previous?.prefix === match[1] &&
      BigInt(match[2]) === previous.number + 1n
    ) {
      previous.end = reference
      previous.number = BigInt(match[2])
      previous.count++
    } else
      ranges.push({
        start: reference,
        end: reference,
        prefix: match?.[1],
        number: match ? BigInt(match[2]) : null,
        count: 1,
      })
  }
  return ranges
    .map(({ start, end, count }) =>
      count === 1 ? start : count === 2 ? `${start}, ${end}` : `${start}–${end}`
    )
    .join(', ')
}

function measurementText(groups, field, labels) {
  if (!groups.length) return ''
  const isWeight = field === 'weight'
  const basisField = isWeight ? 'weightBasis' : 'volumeBasis'
  const units = isWeight ? 'kg' : field === 'volume' ? 'm³' : 'cm'
  const valueFor = (group) =>
    field === 'dimensions' ? group.dimensions : group[field]
  if (groups.length === 1) {
    const group = groups[0],
      value = valueFor(group)
    if (value === '') return ''
    return ['weight', 'volume'].includes(field) && group[basisField] === 'batch'
      ? `${value} · ${labels.batch}`
      : field === 'dimensions' && group.shared
        ? `${value} · ${labels.shared}`
        : value
  }
  return groups
    .map((group) => {
      const value = valueFor(group)
      const basis = ['weight', 'volume'].includes(field)
        ? group[basisField] === 'batch'
          ? labels.batch
          : labels.each
        : ''
      return `${group.label} · ${value === '' ? labels.unknown : `${value} ${units}${basis ? ` · ${basis}` : ''}`}${group.shared ? ` · ${labels.shared}` : ''}`
    })
    .join('\n')
}

function stageMetrics(observations, batches, loading, stage) {
  if (!observations.length) return { count: '', weight: '', volume: '' }
  if (stage === 'loaded') {
    const units = observations.flatMap((observation) => {
      if (!observation.unitIds) return [observation]
      const batch = batches.find((value) => value.id === observation.batchId)
      return batch
        ? physicalUnits(batch).filter((unit) =>
            observation.unitIds.includes(unit.id)
          )
        : []
    })
    if (
      !units.length ||
      units.some(
        (unit) => !['loaded', 'left-behind'].includes(loading.get(unit.id))
      )
    )
      return { count: '', weight: '', volume: '' }
    const selected = units.filter((unit) => loading.get(unit.id) === 'loaded')
    const totals = cartonMeasurementTotals(selected, batches)
    return {
      count: String(selected.length),
      weight: totals.weightCoverage.complete ? totals.weight : '',
      volume: totals.volumeCoverage.complete ? totals.volume : '',
    }
  }
  let count = 0
  const weights = [],
    volumes = []
  const byBatch = new Map()
  for (const observation of observations) {
    if (!byBatch.has(observation.batchId)) byBatch.set(observation.batchId, [])
    byBatch.get(observation.batchId).push(observation)
  }
  for (const [batchId, own] of byBatch) {
    const batch = batches.find((value) => value.id === batchId)
    if (!batch) return { count: '', weight: '', volume: '' }
    const aggregate = own.some((value) => value.ambiguousContents)
    let selectedCount
    if (stage === 'received') {
      if (!validCount(batch.received))
        return { count: '', weight: '', volume: '' }
      // A partial receipt count identifies no particular measured unit.
      if (
        batch.received !== 0 &&
        batch.received !== batch.count &&
        (aggregate || own.length !== batch.count)
      )
        return { count: '', weight: '', volume: '' }
      selectedCount =
        batch.received === batch.count && !aggregate
          ? own.length
          : batch.received
    }
    count += selectedCount
    for (const [field, target] of [
      ['weight', weights],
      ['volume', volumes],
    ]) {
      if (selectedCount === 0) {
        target.push('0')
        continue
      }
      if (aggregate) {
        const value = own[0],
          basis = value[field === 'weight' ? 'weightBasis' : 'volumeBasis']
        if (own[0].states)
          target.push(
            basis === 'batch'
              ? selectedCount === batch.count
                ? value[field]
                : ''
              : repeated(value[field], selectedCount)
          )
        else
          target.push(
            selectedCount === own.length
              ? sum(own.map((value) => value[field]))
              : ''
          )
      } else if (selectedCount === own.length) {
        target.push(sum(own.map((value) => value[field])))
      } else {
        const values = own.map((value) => value[field])
        target.push(
          values.every((value) => value === values[0]) && values[0] !== ''
            ? repeated(values[0], selectedCount)
            : ''
        )
      }
      // Full-set loading/receipt can use a retained aggregate total; a partial
      // set cannot. Explicit individual measurements remain authoritative.
      if (
        target.at(-1) === '' &&
        selectedCount === batch.count &&
        batch[field === 'weight' ? 'weightBasis' : 'volumeBasis'] === 'batch'
      )
        target[target.length - 1] = decimal(
          field === 'weight' ? batch.weight : batch.suppliedCbm
        )
    }
  }
  return { count: String(count), weight: sum(weights), volume: sum(volumes) }
}

/** Add presentation-only physical evidence; source product quantities/prices stay intact. */
export function enrichExcelRows(rows, evidence = {}, { language = 'en' } = {}) {
  const labels = words[language] || words.en
  const containerScope =
    evidence.kind === 'container-revision' ||
    evidence.format === '1688-container-manifest'
  const frozenCartons =
    Array.isArray(evidence.cartons) && (containerScope || !evidence.orders)
  const sideState = containerScope
    ? evidence.outputSide === 'left-behind'
      ? 'left-behind'
      : 'loaded'
    : null
  const capturedUnits =
    sideState === 'left-behind' && evidence.leftBehind
      ? evidence.leftBehind.cartons
      : evidence.cartons
  const cartonUnits = frozenCartons
    ? (capturedUnits || [])
        .filter((unit) => !sideState || !unit.state || unit.state === sideState)
        .map((unit) => ({ ...unit, state: unit.state || sideState }))
    : []
  const loading = loadingEvidence(evidence.containers, cartonUnits)
  return rows.map((row) => {
    const order = evidence.orders?.find(
      (entry) => orderKey(entry) === orderKey(row)
    )
    let batches = order?.batches || evidence.batches || []
    let observations
    if (frozenCartons) {
      const references = Array.isArray(row.cartonReferences)
        ? new Set(row.cartonReferences)
        : null
      observations = cartonUnits
        .filter(
          (unit) =>
            (unit.accountId || 'local') === (row.accountId || 'local') &&
            (!row.cartonId || row.cartonId === (unit.id || unit.cartonId)) &&
            (!references || references.has(unit.id || unit.cartonId)) &&
            ((unit.contents || []).some((content) =>
              owns(row, content, unit.accountId || 'local')
            ) ||
              (unit.contents === null &&
                references?.has(unit.id || unit.cartonId)))
        )
        .map((unit, index) => ({
          ...unitObservation(
            unit,
            { id: unit.batchId || unit.id },
            index,
            labels,
            loading
          ),
          sourceQuantity:
            unit.contents === null
              ? null
              : String(
                  unit.contents
                    .filter((content) =>
                      owns(row, content, unit.accountId || 'local')
                    )
                    .reduce(
                      (total, content) => total + BigInt(content.quantity),
                      0n
                    )
                ),
        }))
      batches = [...new Set(observations.map((value) => value.batchId))].map(
        (id) =>
          batches.find(
            (value) =>
              value.id === id &&
              (value.accountId || 'local') === (row.accountId || 'local')
          ) || {
            id,
            count: observations.filter((value) => value.batchId === id).length,
            received: null,
          }
      )
    } else {
      observations = batches.flatMap((batch, index) =>
        batchObservations(row, batch, index, labels, loading)
      )
    }
    const groups = grouped(observations, labels)
    const totals = batches.flatMap((batch, index) => {
      const own = observations.filter((value) => value.batchId === batch.id)
      if (!own.length || own.some((value) => value.id === `batch:${batch.id}`))
        return []
      if (containerScope && own.length !== batch.count) return []
      return ['weight', 'volume'].flatMap((field) => {
        const basis = field === 'weight' ? 'weightBasis' : 'volumeBasis'
        const value = decimal(
          field === 'weight' ? batch.weight : batch.suppliedCbm
        )
        if (
          batch[basis] !== 'batch' ||
          value === '' ||
          own.every((item) => item[field] !== '')
        )
          return []
        if (
          groups.length === 1 &&
          own.length === observations.length &&
          groups[0][field] === '' &&
          own.length === batch.count
        ) {
          groups[0][field] = value
          groups[0][basis] = 'batch'
          return []
        }
        return [
          {
            batchId: batch.id,
            field,
            value,
            reference: `${labels.internal} ${index + 1}`,
          },
        ]
      })
    })
    const formatted = (field) =>
      [
        measurementText(groups, field, labels),
        ...totals
          .filter((total) => total.field === field)
          .map(
            (total) =>
              `${total.reference} · ${total.value} ${field === 'weight' ? 'kg' : 'm³'} · ${labels.batch}`
          ),
      ]
        .filter(Boolean)
        .join('\n')
    const received = stageMetrics(observations, batches, loading, 'received')
    const loaded = stageMetrics(observations, batches, loading, 'loaded')
    const count =
      observations.length &&
      observations.every(
        (value) => value.count !== null && !value.ambiguousContents
      )
        ? String(observations.reduce((total, value) => total + value.count, 0))
        : ''
    const uniformCapacity =
      observations.length &&
      observations.every(
        (value) =>
          !value.ambiguousContents &&
          !value.shared &&
          value.sourceQuantity !== null &&
          value.sourceQuantity === observations[0].sourceQuantity
      ) &&
      /^\d+$/.test(String(row.quantity)) &&
      observations.reduce(
        (total, value) => total + BigInt(value.sourceQuantity),
        0n
      ) === BigInt(row.quantity)
        ? observations[0].sourceQuantity
        : ''
    const numeric = {}
    if (groups.length === 1) {
      const group = groups[0]
      for (const [key, field] of [
        ['cartonWeight', 'weight'],
        ['cartonVolume', 'volume'],
        ['cartonLength', 'len'],
        ['cartonWidth', 'wid'],
        ['cartonHeight', 'ht'],
      ])
        if (
          group[field] !== '' &&
          !totals.some((total) => total.field === field) &&
          (!['weight', 'volume'].includes(field) ||
            group[field === 'weight' ? 'weightBasis' : 'volumeBasis'] ===
              'carton')
        )
          numeric[key] = group[field]
    }
    return {
      ...row,
      sourceUnitsPerCarton: row.unitsPerCarton ?? '',
      unitsPerCarton: observations.length
        ? uniformCapacity
        : (row.unitsPerCarton ?? ''),
      cartonDimensions: measurementText(groups, 'dimensions', labels),
      cartonWeight: formatted('weight'),
      cartonVolume: formatted('volume'),
      cartonLength: measurementText(groups, 'len', labels),
      cartonWidth: measurementText(groups, 'wid', labels),
      cartonHeight: measurementText(groups, 'ht', labels),
      cartonReferences: groups
        .map(
          (group) =>
            `${groups.length > 1 ? `${group.label} · ` : ''}${compactReferences(group.references)} · ${group.summary}`
        )
        .join('\n'),
      plannedBoxes: count,
      receivedBoxes: received.count,
      receivedWeight: received.weight,
      receivedVolume: received.volume,
      loadedBoxes: loaded.count,
      loadedWeight: loaded.weight,
      loadedVolume: loaded.volume,
      cartonMeasurementGroups: groups,
      cartonBatchTotals: totals,
      cartonNumericValues: numeric,
      cartonSharedLabel: observations.some((value) => value.shared)
        ? labels.shared
        : '',
      physicalCartonIds: observations.flatMap(
        (value) => value.unitIds || [value.id]
      ),
      physicalCartonReview: observations.some(
        (value) => value.review || value.ambiguousContents
      ),
    }
  })
}
