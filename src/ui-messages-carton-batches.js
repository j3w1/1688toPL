export const CARTON_BATCH_MESSAGES = {
  Batch: { zh: '整批登记', es: 'Lote' },
  'Carton number': { zh: '箱号', es: 'N.º de caja' },
  'Carton volume': { zh: '单箱体积', es: 'Volumen de la caja' },
  'Carton weight': { zh: '单箱重量', es: 'Peso de la caja' },
  Status: { zh: '状态', es: 'Estado' },
  Varies: { zh: '不固定', es: 'Variable' },
  'Carton batch {0}': { zh: '装箱批次 {0}', es: 'Lote de cajas {0}' },
  'Linked to the new group': {
    zh: '已关联到新货号组',
    es: 'Vinculado al nuevo grupo',
  },
  'Carton contents, measurements and confirmations stay together under the new group.':
    {
      zh: '箱内商品、尺寸和确认数量随新货号组一同保留。',
      es: 'El contenido, las medidas y las confirmaciones se conservan en el nuevo grupo.',
    },
  'Original carton contents, measurements and month confirmations are kept for review. They are excluded from confirmed packing totals until resolved.':
    {
      zh: '保留原装箱内容、尺寸和月份确认数量供检查。解决前不计入已确认的装箱合计。',
      es: 'Se conservan el contenido, las medidas y las confirmaciones del mes para revisión. Se excluyen de los totales confirmados hasta resolverlo.',
    },
  'Review affected cartons': {
    zh: '检查受影响的装箱',
    es: 'Revisar cajas afectadas',
  },
  'Review the physical cartons before changing their products. Measurements and confirmations are preserved.':
    {
      zh: '更改商品前请检查对应纸箱，尺寸和确认数量均会保留。',
      es: 'Revisa las cajas antes de cambiar sus productos. Las medidas y confirmaciones se conservan.',
    },
  'Carton changes were not applied. Your draft is still here.': {
    zh: '装箱更改尚未应用，草稿仍保留。',
    es: 'Los cambios de cajas no se aplicaron. Tu borrador sigue disponible.',
  },
  'This empty carton batch leaves packing. Undo restores its measurements and confirmations.':
    {
      zh: '此空批次将移出装箱单，撤销可恢复尺寸和确认数量。',
      es: 'Se quita este lote vacío. Deshacer restaura sus medidas y confirmaciones.',
    },
  'Carton measurements and confirmations stay. Review the remaining contents before shipping.':
    {
      zh: '保留纸箱尺寸和确认数量，发货前请检查剩余箱内商品。',
      es: 'Se conservan las medidas y confirmaciones. Revisa el contenido restante antes de enviar.',
    },
  'Carton batch': { zh: '装箱批次', es: 'Lote de cajas' },
  Contents: { zh: '箱内商品', es: 'Contenido' },
  '{0} batches · {1} cartons': {
    zh: '{0} 批次 · {1} 箱',
    es: '{0} lotes · {1} cajas',
  },
  'Set up cartons': { zh: '设置装箱', es: 'Organizar cajas' },
  '{0} batches': { zh: '{0} 批次', es: '{0} lotes' },
  Shared: { zh: '混装', es: 'Compartido' },
  'Cartons belong to the code group. Open to edit contents and measurements.': {
    zh: '纸箱属于此货号组，点击编辑箱内商品和尺寸。',
    es: 'Las cajas pertenecen al grupo. Abre para editar su contenido y medidas.',
  },
  'Edit carton dimensions': {
    zh: '编辑纸箱尺寸',
    es: 'Editar medidas de caja',
  },
  'Volume is calculated from carton dimensions.': {
    zh: '体积按纸箱尺寸计算。',
    es: 'El volumen se calcula con las medidas de la caja.',
  },
  'Edit cartons': { zh: '编辑装箱', es: 'Editar cajas' },
  'Packing backup saved · {0} partial carton batches omitted. Back up all linked purchases to include them.':
    {
      zh: '已保存装箱备份 · 已排除 {0} 个不完整的装箱批次。备份所有关联采购以包含这些批次。',
      es: 'Respaldo guardado · {0} lotes parciales omitidos. Incluye todas las compras vinculadas para respaldarlos.',
    },
  'Carton batches': { zh: '装箱批次', es: 'Lotes de cajas' },
  'Carton contents': { zh: '箱内商品', es: 'Contenido de cajas' },
  'Batch {0}': { zh: '批次 {0}', es: 'Lote {0}' },
  'Review cartons': { zh: '检查装箱', es: 'Revisar cajas' },
  Pieces: { zh: '件数', es: 'Piezas' },
  'Carton measurements': { zh: '纸箱尺寸与重量', es: 'Medidas de cajas' },
  'Supplied volume': { zh: '供应体积', es: 'Volumen indicado' },
  'Weight basis': { zh: '重量方式', es: 'Base del peso' },
  'Per carton': { zh: '每箱', es: 'Por caja' },
  'Batch total': { zh: '整批', es: 'Lote completo' },
  'Remove this order’s active carton batches before deleting it.': {
    zh: '删除此订单前，请先移除其装箱批次。',
    es: 'Quita los lotes de cajas activos de este pedido antes de eliminarlo.',
  },
  'Enter a decimal measurement': {
    zh: '请输入小数测量值',
    es: 'Introduce una medida decimal',
  },
  'Enter a nonnegative decimal measurement': {
    zh: '请输入非负小数测量值',
    es: 'Introduce una medida decimal no negativa',
  },
  'Carton dimensions must be greater than zero': {
    zh: '纸箱尺寸必须大于零',
    es: 'Las medidas de la caja deben ser mayores que cero',
  },
  'Enter all three carton dimensions': {
    zh: '请输入纸箱的三个尺寸',
    es: 'Introduce las tres medidas de la caja',
  },
  'Choose carton contents': {
    zh: '请选择箱内商品',
    es: 'Elige el contenido de las cajas',
  },
  'Carton contents must contain positive whole quantities': {
    zh: '箱内商品数量必须为正整数',
    es: 'El contenido debe tener cantidades enteras positivas',
  },
  'Carton contents exceed the current available product quantity.': {
    zh: '箱内商品数量超过当前可用数量。',
    es: 'El contenido supera la cantidad disponible del producto.',
  },
  'Review migrated cartons before changing contents.': {
    zh: '更改内容之前，请检查迁移的装箱数据。',
    es: 'Revisa las cajas migradas antes de cambiar el contenido.',
  },
}
