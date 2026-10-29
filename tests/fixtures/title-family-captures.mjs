// Synthetic listing titles and identities; no supplier, order or captured HTML.
// Cohort sizes reproduce five observed import shapes, without retaining titles.
const option = (label, value) => ({ label, value, raw: `${label}: ${value}` })
const colour = (value, extra = []) => [option('颜色', value), ...extra]
const spec = (value) => option('规格', value)

function capture(index, families) {
  let entry = 0
  return {
    accountId: 'local',
    orderId: `99900000000000001${String(index).padStart(2, '0')}`,
    sellerName: 'synthetic-title-family-supplier',
    sellerMemberLogin: 'synthetic-title-family-supplier',
    purchasedAt: '2026-10-19T08:00:00.000Z',
    observedAt: '2026-10-29T00:00:00.000Z',
    items: families.flatMap(([name, rows], familyIndex) =>
      rows.map((skuProperties, rowIndex) => {
        const title = `Synthetic ${name} listing`
        return {
          entryId: String(++entry),
          title,
          description: [title, ...skuProperties.map(({ raw }) => raw)].join(
            '\n'
          ),
          productNumber: `DEMO${familyIndex + 1}${String(rowIndex + 1).padStart(2, '0')}`,
          skuProperties,
          quantity: '10',
          price: '2.00',
          sourceDiscount: '0.00',
          allocatedDiscount: '0.00',
          discount: '0.00',
          thumbnail: '',
        }
      })
    ),
  }
}

const cylinders = [
  '口径15 高20cm【防摔直筒】',
  '口径12 高30cm【防摔直筒】',
  '口径15高40cm【防摔直筒】',
  '口径15高15cm【防摔品质】',
  '口径15 高25cm【防摔直筒】',
  '口径15 高30cm【防摔直筒】',
].map((value) => [option('尺寸', value)])
const buckets = [
  '醒花桶【方形】大号1个',
  '醒花桶【方形】中号1个',
  '【手提款加厚 】方形大号',
  '12高12cm【圆形】',
  '【手提款加厚 】方形中号',
].map((value) => colour(value))
const hats = ['长毛帽红色（短)', '长毛帽红色（长)', '长毛帽粉色（短)'].map(
  (value) => colour(value)
)
const cats = [
  '金色小号（包装尺寸19*14*28.5）',
  '金色中号（包装尺寸22*14*34）',
  '黑色大号（包装尺寸17.5*43*26.5）',
  '黑色小号（包装尺寸19*14*28.5）',
  '仿木纹-中号',
  '仿木纹-大号',
  '金色大号（包装尺寸17.5*43*26.5）',
  '仿木纹-小号',
  '黑色中号（包装尺寸22*14*34）',
].map((value) => colour(value))

export const titleFamilyCaptureCases = [
  {
    name: 'vessels',
    counts: [6, 5],
    snapshot: capture(1, [
      ['clear cylinders', cylinders],
      ['flower buckets', buckets],
    ]),
    endings: ['A', 'B', 'C', 'D', 'E', 'F', 'AL', 'AM', 'BL', 'C', 'BM'],
  },
  {
    name: 'picnic patterns',
    counts: [2],
    snapshot: capture(2, [
      ['picnic sets', ['4人蓝白格子', '4人红色条纹'].map((v) => colour(v))],
    ]),
    endings: ['A', 'B'],
  },
  {
    name: 'covers and tablecloth',
    counts: [2, 1, 1],
    snapshot: capture(3, [
      [
        'chair covers',
        ['红色', '绿色'].map((v) => colour(v, [spec('60*50cm')])),
      ],
      ['alternate cover', [colour('红色', [spec('50*60')])]],
      ['tablecloth', [[spec('130*180cm')]]],
    ]),
    endings: ['A', 'B', '', ''],
  },
  {
    name: 'seasonal assortment',
    counts: [3, 1, 3, 6, 1, 2, 1, 3, 1, 1, 2, 2, 1, 2, 2],
    snapshot: capture(4, [
      ['plush hats', hats],
      ['plush cover', [colour('短毛绒椅套')]],
      ['curtain ties', ['麋鹿', '雪人', '老人'].map((v) => colour(v))],
      [
        'decorative picks',
        [
          '仿真花-款式1',
          '仿真花-款式9',
          '仿真花-款式3',
          '浆果插花-款式一',
          '浆果插花-款式四',
          '浆果插花-款式三',
        ].map((v) => colour(v)),
      ],
      ['handle cover', [colour('老人')]],
      [
        'light hats',
        ['成人', '儿童'].map((v) =>
          colour(`暖灯帽（${v}）`, [spec('单个opp袋装')])
        ),
      ],
      ['Santa ornament', [colour('老人')]],
      [
        'decorative dolls',
        ['红色亮片', '女款', '粉色亮片'].map((v) => colour(v)),
      ],
      ['drawstring bag', [colour('棕色', [spec('12*15(CM)')])]],
      ['dot cover', [colour('圆点款')]],
      ['hat dolls', ['红色尖帽款', '白帽款'].map((v) => colour(v))],
      ['butterfly ornaments', ['蓝色', '粉色'].map((v) => [option('尺寸', v)])],
      ['standing doll', [colour('女款')]],
      [
        'sitting dolls',
        ['女款', '男款'].map((v) => colour('如图', [spec(`坐姿公仔${v}`)])),
      ],
      [
        'gift bags',
        ['红色麋鹿', '红色圣诞树'].map((v) => colour(v, [spec('13*18cm')])),
      ],
    ]),
  },
  {
    name: 'decorative assortment',
    counts: [3, 4, 1, 9],
    snapshot: capture(5, [
      [
        'animal ornaments',
        ['大号金色马', '母子象', '大象'].map((v) =>
          colour(v, [option('尺寸', '如图所示')])
        ),
      ],
      [
        'dancing ornaments',
        ['牵手双人舞', '环球', '芭蕾舞女孩坐姿', '搂腰双人舞'].map((v) =>
          colour(v)
        ),
      ],
      ['storage box', [colour('绿色B款-中号')]],
      ['Egyptian cats', cats],
    ]),
    endings: [
      'A',
      'B',
      'C',
      'A',
      'B',
      'C',
      'D',
      '',
      'AS',
      'AM',
      'BL',
      'BS',
      'CM',
      'CL',
      'AL',
      'CS',
      'BM',
    ],
  },
]
