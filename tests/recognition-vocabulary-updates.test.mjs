import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_VOCABULARY,
  createNameSuggester,
} from '../src/product-vocabulary.js'
import {
  MATERIAL_VOCABULARY,
  suggestMaterial,
  createMaterialSuggester,
} from '../src/material-vocabulary.js'
import {
  COLOR_VOCABULARY,
  configureColorVocabulary,
  getItemColorHints,
} from '../src/color-vocabulary.js'
import {
  DEFAULT_SIZE_VOCABULARY,
  createSizeClassifier,
} from '../src/size-vocabulary.js'
import { validatePackingPreferences } from '../src/packing-model.js'
import { initializeRecognitionVocabularies } from '../src/recognition-vocabulary-updates.js'

const newNames = new Set([
  'christmas-hat',
  'curtain-tie',
  'handle-cover',
  'drawstring-gift-bag',
  'cloth-bag',
  'decorative-doll',
  'butterfly-ornament',
  'decorative-bow',
  'christmas-ball',
  'christmas-bell',
  'decorative-pick',
  'tablecloth-chair-set',
])
function previousPreferences() {
  const vocabulary = structuredClone(DEFAULT_VOCABULARY).filter(
    (entry) => !newNames.has(entry.seed)
  )
  delete vocabulary.find((entry) => entry.seed === 'curtain').exclude
  vocabulary.find((entry) => entry.seed === 'plush-toy').exclude =
    '地毯|地垫|拖鞋|发箍'
  vocabulary.find((entry) => entry.seed === 'christmas-tree').exclude =
    '蜡烛|圣诞袜|挂件|挂饰|耳环'
  const materialVocabulary = structuredClone(MATERIAL_VOCABULARY).filter(
    (entry) => entry.id !== 'pc'
  )
  materialVocabulary.find((entry) => entry.id === 'bamboo-wood').aliases = [
    '竹木',
  ]
  const colorVocabulary = structuredClone(COLOR_VOCABULARY).filter(
    (entry) => !['antique', 'glitter', 'sequined', 'flocked'].includes(entry.id)
  )
  const sizeVocabulary = structuredClone(DEFAULT_SIZE_VOCABULARY)
  sizeVocabulary.find((entry) => entry.suffix === 'S').match =
    'S|小号|小码|小尺寸|小'
  sizeVocabulary.find((entry) => entry.suffix === 'L').match =
    'L|大号|大码|大尺寸|大'
  return validatePackingPreferences({
    vocabulary,
    materialVocabulary,
    colorVocabulary,
    sizeVocabulary,
    settings: { vocabularyInitialized: true, vocabularyVersion: 1 },
  })
}

test('specific product rules distinguish decorations and accessories from marketing context', () => {
  const suggest = createNameSuggester()
  for (const [source, name, category] of [
    ['合成 长毛绒带灯圣诞帽 装饰品', 'GORRO NAVIDENO', '圣诞帽'],
    ['合成 公仔窗帘扣 窗帘绑带', 'SUJETACORTINAS', '窗帘扣'],
    ['合成 冰箱把手套 圣诞装饰', 'FUNDA PARA TIRADOR', '把手套'],
    ['合成 圣诞棉麻束口袋 抽绳袋', 'BOLSA DE REGALO', '礼品袋'],
    ['合成 棉麻布袋', 'BOLSA DE TELA', '布袋'],
    ['合成 姜饼人公仔摆件 圣诞树装饰', 'MUNECO DECORATIVO', '公仔摆件'],
    ['合成 侏儒娃娃 摆件', 'MUNECO DECORATIVO', '公仔摆件'],
    ['合成 圣诞金粉蝴蝶挂件', 'MARIPOSA DECORATIVA', '蝴蝶挂件'],
    ['合成 PC圣诞蝴蝶结挂饰', 'LAZO DECORATIVO', '蝴蝶结'],
    ['合成 圣诞球套装 圣诞树装饰', 'BOLA NAVIDENA', '圣诞球'],
    ['合成 圣诞植绒铃铛 装饰', 'CAMPANA NAVIDENA', '圣诞铃铛'],
    ['合成 圣诞树精灵腿插枝', 'ADORNO NAVIDENO', '圣诞装饰'],
    ['合成 圣诞桌布+雪花椅子套', 'JUEGO DE MANTEL Y FUNDAS', '桌布椅套套装'],
    ['合成 圣诞帽款椅子套', 'FUNDA PARA SILLA', '椅套'],
    ['合成 毛绒玩具', 'PELUCHE', '毛绒玩具'],
    ['合成 圣诞树', 'ARBOL NAVIDENO', '圣诞树'],
    ['合成 窗帘', 'CORTINA', '窗帘'],
  ]) {
    const result = suggest(source)
    assert.equal(result.spanishName, name, source)
    assert.equal(result.category, category, source)
  }
  assert.equal(
    suggest('合成 麻绳球 宠物玩具').spanishName,
    'JUGUETE PARA MASCOTA'
  )
})

test('composition recognition distinguishes PC and bamboo from article IDs and finishes', () => {
  for (const [title, expected] of [
    ['合成 PC圣诞蝴蝶结挂件', 'PC'],
    ['合成 聚碳酸酯饰品', 'PC'],
    ['合成 polycarbonate ornament', 'PC'],
    ['合成 竹木制台式镜子', '竹木'],
    ['合成 08PCGJ900 装饰品', ''],
    ['合成 PPC300 装饰品', ''],
    ['合成 PC电脑配件', ''],
    ['合成 PC computer accessory', ''],
    ['合成 wood grain ornament', ''],
    ['合成 木纹色摆件', ''],
    ['合成 树脂木纹摆件', '树脂'],
    ['合成 植绒铃铛', ''],
    ['合成 麻绳装饰', ''],
  ])
    assert.equal(suggestMaterial({ title }), expected, title)
})

test('new finish helpers retain three-language labels without inventing solid swatches', () => {
  for (const [value, ids] of [
    ['木纹小号', ['wood-grain']],
    ['红色亮片款', ['red', 'sequined']],
    ['香槟金闪粉', ['champagne-gold', 'glitter']],
    ['金粉', ['glitter']],
    ['仿古黑色', ['antique', 'black']],
    ['酒红植绒', ['burgundy', 'flocked']],
  ]) {
    const item = { skuProperties: [{ label: '颜色', value }] }
    for (const locale of ['en', 'es', 'zh']) {
      const hints = getItemColorHints(item, locale)
      assert.deepEqual(
        hints.map((hint) => hint.id),
        ids,
        value
      )
      for (const hint of hints) {
        assert.ok(hint.label)
        if (hint.kind === 'finish' || hint.kind === 'pattern')
          assert.equal(hint.swatch, null)
      }
    }
  }
})

test('new dictionaries recognize short/long only as bounded source size tokens', () => {
  const classifier = createSizeClassifier()
  assert.deepEqual(
    classifier.suggest(['短', '长']).map((entry) => entry.sizeSuffix),
    ['S', 'L']
  )
  assert.deepEqual(
    classifier.suggest(['short', 'long']).map((entry) => entry.sizeSuffix),
    ['S', 'L']
  )
  assert.deepEqual(
    classifier.suggest(['短款', '长版']).map((entry) => entry.sizeSuffix),
    ['S', 'L']
  )
  for (const value of ['长毛绒', '短毛绒', 'longboard', 'shortcake']) {
    const result = classifier.extract({
      skuProperties: [{ label: '颜色', value }],
    })
    assert.equal(result.size, '', value)
  }
})

test('versioned dictionary upgrade updates untouched rules in existing libraries and is idempotent', () => {
  const previous = previousPreferences(),
    before = structuredClone(previous)
  const updated = initializeRecognitionVocabularies(previous)
  assert.deepEqual(previous, before)
  assert.equal(
    createNameSuggester(updated.vocabulary)('合成 长毛绒圣诞帽').spanishName,
    'GORRO NAVIDENO'
  )
  assert.equal(
    createMaterialSuggester(updated.materialVocabulary)({
      title: '合成 PC装饰品',
    }),
    'PC'
  )
  assert.equal(
    createMaterialSuggester(updated.materialVocabulary)({
      title: '合成 竹木制装饰品',
    }),
    '竹木'
  )
  assert.equal(
    createSizeClassifier(updated.sizeVocabulary).suggest(['short', 'long'])[0]
      .sizeSuffix,
    'S'
  )
  assert.ok(updated.colorVocabulary.some((entry) => entry.id === 'glitter'))
  for (const key of [
    'vocabularyVersion',
    'materialVocabularyVersion',
    'colorVocabularyVersion',
    'sizeVocabularyVersion',
  ])
    assert.equal(updated.settings[key], 2)
  assert.equal(initializeRecognitionVocabularies(updated), updated)
  assert.deepEqual(
    initializeRecognitionVocabularies(
      validatePackingPreferences(JSON.parse(JSON.stringify(updated)))
    ),
    updated
  )
})

test('dictionary upgrades preserve manual entries, removed defaults and intentional empty lists', () => {
  const previous = previousPreferences()
  previous.vocabulary = previous.vocabulary.filter(
    (entry) => entry.seed !== 'curtain'
  )
  previous.materialVocabulary = previous.materialVocabulary.filter(
    (entry) => entry.id !== 'glass'
  )
  previous.materialVocabulary.find((entry) => entry.id === 'bamboo-wood').es =
    'Mi bambu'
  previous.sizeVocabulary.find((entry) => entry.suffix === 'S').match +=
    '|mi pequeno'
  previous.vocabulary.push({
    match: '圣诞帽',
    spanishName: 'MI SOMBRERO',
    category: '',
  })
  const updated = initializeRecognitionVocabularies(previous)
  assert.equal(
    updated.vocabulary.some((entry) => entry.seed === 'curtain'),
    false
  )
  assert.equal(
    updated.materialVocabulary.some((entry) => entry.id === 'glass'),
    false
  )
  assert.deepEqual(
    updated.materialVocabulary.find((entry) => entry.id === 'bamboo-wood'),
    previous.materialVocabulary.find((entry) => entry.id === 'bamboo-wood')
  )
  assert.deepEqual(
    updated.sizeVocabulary.find((entry) => entry.suffix === 'S'),
    previous.sizeVocabulary.find((entry) => entry.suffix === 'S')
  )
  assert.equal(
    createNameSuggester(updated.vocabulary)('圣诞帽').spanishName,
    'MI SOMBRERO'
  )
  const empty = initializeRecognitionVocabularies(
    validatePackingPreferences({
      settings: { vocabularyInitialized: true, vocabularyVersion: 1 },
      vocabulary: [],
      materialVocabulary: [],
      colorVocabulary: [],
      sizeVocabulary: [],
    })
  )
  for (const key of [
    'vocabulary',
    'materialVocabulary',
    'colorVocabulary',
    'sizeVocabulary',
  ])
    assert.deepEqual(empty[key], [])
})

test('new default aliases yield to existing custom aliases instead of invalidating preferences', () => {
  const previous = previousPreferences()
  previous.materialVocabulary.push({
    id: 'custom-pc',
    aliases: ['PC'],
    zh: '自定义材料',
    en: 'Custom material',
    es: 'Material propio',
    parent: '',
  })
  previous.colorVocabulary.push({
    id: 'custom-glitter',
    aliases: ['金粉'],
    labels: { zh: '自定义效果', en: 'Custom effect', es: 'Efecto propio' },
    kind: 'finish',
    swatch: null,
  })
  previous.sizeVocabulary.push({ match: 'short', suffix: 'Q' })
  const updated = initializeRecognitionVocabularies(previous)
  assert.doesNotThrow(() => validatePackingPreferences(updated))
  assert.equal(
    updated.materialVocabulary.some((entry) => entry.id === 'pc'),
    false
  )
  assert.equal(
    updated.colorVocabulary.some((entry) => entry.id === 'glitter'),
    false
  )
  assert.equal(
    createMaterialSuggester(updated.materialVocabulary)({ title: 'PC装饰' }),
    '自定义材料'
  )
  assert.equal(
    createSizeClassifier(updated.sizeVocabulary).suggest(['short', 'long'])[0]
      .sizeSuffix,
    'Q'
  )
  configureColorVocabulary(updated.colorVocabulary)
  try {
    assert.equal(
      getItemColorHints({
        skuProperties: [{ label: '颜色', value: '金粉' }],
      })[0].id,
      'custom-glitter'
    )
  } finally {
    configureColorVocabulary()
  }
})
