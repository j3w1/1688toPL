export const ORDER_REMOVAL_MESSAGES = {
  Delete: { zh: '删除', es: 'Eliminar' },
  'Delete selected orders': {
    zh: '删除所选订单',
    es: 'Eliminar pedidos seleccionados',
  },
  'Reviewing related cartons and containers…': {
    zh: '正在检查关联纸箱和集装箱…',
    es: 'Revisando cajas y contenedores relacionados…',
  },
  'The selected orders, their history, preparation and owned cartons will be removed. A saved backup can restore the orders.':
    {
      zh: '将删除所选订单及其历史记录、备货数据和所属纸箱。可使用已保存的备份恢复订单。',
      es: 'Se eliminarán los pedidos seleccionados, su historial, preparación y cajas propias. Una copia guardada puede restaurar los pedidos.',
    },
  '{orders} orders · {cartons} carton batches · {containers} unsealed container inclusions':
    {
      zh: '{orders} 个订单 · {cartons} 批纸箱 · {containers} 处未封存集装箱关联',
      es: '{orders} pedidos · {cartons} lotes de cajas · {containers} inclusiones en contenedores sin sellar',
    },
  'The orders and their loading decisions will be removed from these unsealed containers. The containers and their other orders will remain.':
    {
      zh: '将从这些未封存的集装箱中移除订单及其装载决定。集装箱及其中其他订单将保留。',
      es: 'Los pedidos y sus decisiones de carga se retirarán de estos contenedores sin sellar. Se conservarán los contenedores y sus otros pedidos.',
    },
  'Review complete. Delete removes all selected orders together.': {
    zh: '检查完成。点击删除将一并删除全部所选订单。',
    es: 'Revisión terminada. Eliminar retira todos los pedidos seleccionados juntos.',
  },
  'Deletion is blocked. Nothing has been deleted.': {
    zh: '无法删除。未删除任何数据。',
    es: 'La eliminación está bloqueada. No se ha eliminado nada.',
  },
  'Deleting selected orders…': {
    zh: '正在删除所选订单…',
    es: 'Eliminando pedidos seleccionados…',
  },
  'Order {orderId}': { zh: '订单 {orderId}', es: 'Pedido {orderId}' },
  'This order can’t be deleted because its cartons are recorded in sealed containers: {names}. Nothing has been deleted.':
    {
      zh: '无法删除此订单，因为其纸箱已记录在封存的集装箱中：{names}。未删除任何数据。',
      es: 'No se puede eliminar este pedido porque sus cajas están registradas en contenedores sellados: {names}. No se ha eliminado nada.',
    },
  'Retained shipment history requires this source purchase in containers: {names}. Nothing has been deleted.':
    {
      zh: '这些集装箱的保留出货历史需要此原始采购订单：{names}。未删除任何数据。',
      es: 'El historial de envíos conservado necesita esta compra de origen en los contenedores: {names}. No se ha eliminado nada.',
    },
  'Retained shipment history requires this source purchase and its originals. Nothing has been deleted.':
    {
      zh: '保留的出货历史需要此原始采购订单及其原始资料。未删除任何数据。',
      es: 'El historial de envíos conservado necesita esta compra de origen y sus originales. No se ha eliminado nada.',
    },
  'Unlink this order’s payments before deleting it, or delete the complete linked set together. Nothing has been deleted.':
    {
      zh: '删除前请先解除此订单的付款关联，或一并删除全部关联订单。未删除任何数据。',
      es: 'Desvincula los pagos de este pedido antes de eliminarlo, o elimina todos los pedidos vinculados juntos. No se ha eliminado nada.',
    },
  'Carton batch {batch} also references unselected purchases: {orders}. Review its ownership before deleting this order.':
    {
      zh: '纸箱批次 {batch} 还引用了未选中的采购订单：{orders}。删除此订单前请检查其归属。',
      es: 'El lote de cajas {batch} también hace referencia a compras no seleccionadas: {orders}. Revisa su propiedad antes de eliminar este pedido.',
    },
}
