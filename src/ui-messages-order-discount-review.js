export const ORDER_DISCOUNT_REVIEW_MESSAGES = {
  'Review discounts': { zh: '核对优惠', es: 'Revisar descuentos' },
  'The order total balances, but the discount allocation needs your review.': {
    zh: '订单总额一致，但优惠的分配方式需要您核对。',
    es: 'El total del pedido cuadra, pero debes revisar cómo se asignan los descuentos.',
  },
  'This order needs a confirmed discount review.': {
    zh: '此订单需要先确认优惠核对结果。',
    es: 'Este pedido necesita una revisión de descuentos confirmada.',
  },
  'This order does not belong to that import.': {
    zh: '此订单不属于该次导入。',
    es: 'Este pedido no pertenece a esa importación.',
  },
  'This order no longer needs a discount review.': {
    zh: '此订单不再需要核对优惠。',
    es: 'Este pedido ya no necesita una revisión de descuentos.',
  },
  'The review does not match this order page.': {
    zh: '核对结果与当前订单页面不一致。',
    es: 'La revisión no coincide con esta página de pedido.',
  },
  'Open this order from its import discount review.': {
    zh: '请从导入记录的优惠核对操作打开此订单。',
    es: 'Abre este pedido desde la revisión de descuentos de su importación.',
  },
  'The saved discount review does not match this order.': {
    zh: '已保存的优惠核对结果与此订单不一致。',
    es: 'La revisión de descuentos guardada no coincide con este pedido.',
  },
  'Pause or finish this import before saving this order.': {
    zh: '保存此订单前，请先暂停或完成当前导入。',
    es: 'Pausa o termina esta importación antes de guardar este pedido.',
  },
  'Expected {expected} product rows but read {actual}. No saved data was replaced.':
    {
      zh: '预计应有 {expected} 行商品，但读取到 {actual} 行。未替换任何已保存的数据。',
      es: 'Se esperaban {expected} filas de productos, pero se leyeron {actual}. No se sustituyó ningún dato guardado.',
    },
  'Choose how the seller reduction is applied. Both treatments match the payable; product costs differ.':
    {
      zh: '请选择卖家改价的计算方式。两种方式都与实付款一致，但商品成本不同。',
      es: 'Elige cómo se aplica la rebaja del vendedor. Ambas opciones coinciden con el importe a pagar, pero cambian los costes de los productos.',
    },
  'Source amounts': { zh: '页面原始金额', es: 'Importes originales' },
  'Discount treatment': { zh: '优惠计算方式', es: 'Tratamiento del descuento' },
  'Seller reduction is additional to row discounts': {
    zh: '卖家改价在商品行优惠之外另行扣减',
    es: 'La rebaja del vendedor se añade a los descuentos de las filas',
  },
  'Seller reduction is already included in row discounts': {
    zh: '商品行优惠已包含卖家改价',
    es: 'La rebaja del vendedor ya está incluida en los descuentos de las filas',
  },
  'No seller price change': {
    zh: '无卖家改价',
    es: 'Sin cambio de precio del vendedor',
  },
  'Seller price increase is additional': {
    zh: '卖家加价另行计入',
    es: 'El aumento de precio del vendedor se añade por separado',
  },
  'Additional seller increase allocated to products': {
    zh: '另行分摊到商品的卖家加价',
    es: 'Aumento adicional del vendedor asignado a los productos',
  },
  'Seller change allocated to products': {
    zh: '分摊到商品的卖家改价',
    es: 'Cambio del vendedor asignado a los productos',
  },
  'Allocated seller change': {
    zh: '分摊的卖家改价',
    es: 'Cambio del vendedor asignado',
  },
  'Positive allocated changes reduce product cost; negative changes increase it.':
    {
      zh: '分摊值为正数时降低商品成本，为负数时增加商品成本。',
      es: 'Los cambios asignados positivos reducen el coste del producto; los negativos lo aumentan.',
    },
  'Suggested from the matching source discounts; confirmation is still required.':
    {
      zh: '根据一致的原始优惠金额建议此选项，仍需您确认。',
      es: 'Sugerido porque coinciden los descuentos originales; aún requiere confirmación.',
    },
  'Additional seller reduction allocated to products': {
    zh: '另行分摊到商品的卖家改价',
    es: 'Rebaja adicional del vendedor asignada a los productos',
  },
  'Discount remaining at order level': {
    zh: '保留在订单层级的优惠',
    es: 'Descuento que permanece a nivel del pedido',
  },
  'Wholesale reduction already in row prices': {
    zh: '商品单价已包含的批发优惠',
    es: 'Descuento mayorista ya incluido en los precios de las filas',
  },
  'Customization included in original total': {
    zh: '原价总计已包含的定制服务费',
    es: 'Personalización incluida en el total original',
  },
  'Payable remains {amount}': {
    zh: '实付款保持为 {amount}',
    es: 'El importe a pagar sigue siendo {amount}',
  },
  'Product-cost comparison': {
    zh: '商品成本对比',
    es: 'Comparación de costes',
  },
  'Source row': { zh: '原始行', es: 'Fila original' },
  'Row discount': { zh: '商品行优惠', es: 'Descuento de fila' },
  'Row discounts': {
    zh: '商品行优惠合计',
    es: 'Total de descuentos de las filas',
  },
  'Additional reduction': { zh: '另行扣减', es: 'Rebaja adicional' },
  'Product net': { zh: '商品净额', es: 'Neto del producto' },
  'Product net excludes shipping, red packets and discounts remaining at order level.':
    {
      zh: '商品净额不含运费、红包及保留在订单层级的优惠。',
      es: 'El neto del producto excluye el envío, los sobres rojos y los descuentos que permanecen a nivel del pedido.',
    },
  'Rows {start}–{end} of {total}': {
    zh: '第 {start}–{end} 行，共 {total} 行',
    es: 'Filas {start}–{end} de {total}',
  },
  'Choose a discount treatment before saving.': {
    zh: '保存前请选择优惠计算方式。',
    es: 'Elige un tratamiento del descuento antes de guardar.',
  },
  'The order amounts changed. Review the updated choices and confirm again.': {
    zh: '订单金额已变化。请核对更新后的选项并重新确认。',
    es: 'Los importes del pedido cambiaron. Revisa las opciones actualizadas y confirma de nuevo.',
  },
  'This order no longer needs discount review. Cancel and save the order again.':
    {
      zh: '此订单不再需要核对优惠。请取消，然后重新保存订单。',
      es: 'Este pedido ya no necesita revisión de descuentos. Cancela y vuelve a guardar el pedido.',
    },
  'This order no longer needs discount review. Cancel and resume this import from Activity.':
    {
      zh: '此订单不再需要核对优惠。请取消，然后从动态中继续此次导入。',
      es: 'Este pedido ya no necesita revisión de descuentos. Cancela y reanuda esta importación desde Actividad.',
    },
  'This order no longer needs discount review. Resume this import from Activity.':
    {
      zh: '此订单不再需要核对优惠。请从动态中继续此次导入。',
      es: 'Este pedido ya no necesita revisión de descuentos. Reanuda esta importación desde Actividad.',
    },
  'Confirm and save': { zh: '确认并保存', es: 'Confirmar y guardar' },
  'Confirming discounts and saving…': {
    zh: '正在确认优惠并保存…',
    es: 'Confirmando descuentos y guardando…',
  },
  'Discount review canceled. Nothing was saved.': {
    zh: '已取消优惠核对，未保存任何内容。',
    es: 'Revisión de descuentos cancelada. No se guardó nada.',
  },
  '{count} products saved to your spreadsheet.': {
    zh: '已将 {count} 个商品保存到工作区。',
    es: 'Se guardaron {count} productos en tu hoja.',
  },
}
