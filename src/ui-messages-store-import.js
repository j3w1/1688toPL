import { STORE_UPDATE_MESSAGES } from './ui-messages-store-update.js'

export const STORE_IMPORT_MESSAGES = {
  ...STORE_UPDATE_MESSAGES,
  'Review products and codes before saving': {
    zh: '保存前审核商品与货号',
    es: 'Revisa productos y códigos antes de guardar',
  },
  'First confirm the workbook date, photos, quantities, allocations and total. Review products and codes opens editable details and proposals without saving an order or reserving codes. Import and assign codes saves the reviewed order, photos, details, preparation and assignments together.':
    {
      zh: '先确认工作簿的采购日期、照片、数量、分配和总金额。“审核商品与编码”打开可编辑详情与方案，不保存订单，也不占用货号。“导入并分配编码”会一起保存已审核的订单、照片、详情、备货数据和编码分配。',
      es: 'Confirma primero la fecha, las fotos, las cantidades, los repartos y el total. Revisar productos y códigos abre detalles y propuestas editables sin guardar pedidos ni reservar códigos. Importar y asignar códigos guarda juntos el pedido, las fotos, los detalles, la preparación y las asignaciones revisadas.',
    },
  'Optional. A nonblank var is the complete suggested ending. Combined variants require a reviewed quantity split.':
    {
      zh: '可选。非空 var 是完整的建议后缀。合并款式需要审核实际数量分配。',
      es: 'Opcional. Un var no vacío define el sufijo sugerido completo. Las variantes combinadas requieren revisar el reparto de cantidades.',
    },
  'Mark the order total with total on both sides. Review the workbook, choose Review products and codes, edit details and endings, then choose Import and assign codes.':
    {
      zh: '在订单总金额两侧标记 total。审核工作簿后选择“审核商品与编码”，编辑详情与后缀，再选择“导入并分配编码”。',
      es: 'Marca el total del pedido con total a ambos lados. Revisa el libro, elige Revisar productos y códigos, edita detalles y sufijos y después Importar y asignar códigos.',
    },
  'Review each variant ending and size ending; the full barcode updates as you edit. Resolve unknown inferred sizes or explicitly choose Do not add size endings. Physical sizes remain in the source descriptions. An unresolved size or invalid or conflicting code blocks the final import.':
    {
      zh: '核对每个款式与尺码后缀；完整条码随编辑更新。解决未知的推断尺码，或明确选择“不添加尺码后缀”。实际尺寸仍保留在原始描述中。未解决的尺码、无效编码或编码冲突会阻止最终导入。',
      es: 'Revisa los sufijos de variante y talla; el código completo se actualiza al editar. Resuelve las tallas inferidas desconocidas o elige No añadir sufijos de talla. Las medidas físicas se conservan en las descripciones. Una talla pendiente o un código inválido o en conflicto bloquea la importación final.',
    },
  'Respect the workbook declaration': {
    zh: '遵循工作簿声明',
    es: 'Respeta la declaración del libro',
  },
  'A nonblank var defines the complete suggested ending: a means A, s means size S, and as means AS. Description measurements do not append extra size characters. Blank var cells keep normal suggestions. Deliberate edits stay custom; resetting suggestions returns to the declaration. Correct existing codes through the group size-handling review rather than importing another purchase.':
    {
      zh: '非空 var 定义完整的建议后缀：a 表示 A，s 表示尺码 S，as 表示 AS。描述中的尺寸不会自动追加尺码字符。空白 var 使用常规建议。主动编辑保留为自定义值；重置建议会恢复工作簿声明。通过商品组的尺码处理审核修正已有编码，不要另建采购订单。',
      es: 'Un var no vacío define el sufijo sugerido completo: a significa A, s significa talla S y as significa AS. Las medidas de la descripción no añaden caracteres de talla. Un var vacío mantiene las sugerencias normales. Las ediciones deliberadas son personalizadas; restablecer sugerencias recupera la declaración. Corrige los códigos existentes mediante la revisión de tallas del grupo en lugar de importar otra compra.',
    },
  'Edit order, group or variant details': {
    zh: '编辑订单、商品组或款式详情',
    es: 'Edita detalles del pedido, grupo o variante',
  },
  'Edit order details applies selected fields across the purchase; Edit group details covers one CE product base. Both offer Spanish name, Chinese category and Material. Edit variant details offers Spanish name and Material; Chinese category stays shared for the carton mark. Keep custom values preserves manual exceptions and deliberate blanks by default. Replace all values replaces them explicitly. Review affected counts before Apply; Cancel changes nothing. These controls are also available in Orders.':
    {
      zh: '“编辑订单详情”将所选字段应用到整笔采购；“编辑商品组详情”用于同一 CE 商品基础货号。两者均提供西班牙语名称、中文品类和材质。“编辑款式详情”提供西班牙语名称和材质；中文品类仍由整组共用以打印箱唛。默认“保留自定义值”会保留手动例外和刻意留空；“替换所有值”才会覆盖它们。应用前核对影响数量；取消不作更改。订单中也提供这些控件。',
      es: 'Editar detalles del pedido aplica los campos seleccionados a la compra; Editar detalles del grupo cubre una base CE. Ambos ofrecen Nombre en español, Categoría en chino y Material. Editar detalles de variante ofrece Nombre en español y Material; la categoría se comparte para la marca de caja. Conservar valores personalizados mantiene por defecto excepciones manuales y vacíos deliberados. Reemplazar todos los valores los sustituye expresamente. Revisa las cantidades afectadas antes de Aplicar; Cancelar no cambia nada. Estos controles también están en Pedidos.',
    },
  'Use Back to review the workbook, Cancel to leave without saving, or Reset to suggested to restore proposed codes while preserving authored details. Proposals reserve nothing. Final confirmation revalidates the current library; a new conflict must be resolved before anything is saved.':
    {
      zh: '返回可重新审核工作簿，取消会退出且不保存，重置为建议编码可恢复建议货号并保留已编辑详情。方案不占用货号。最终确认会重新校验当前资料库；任何新冲突都必须解决后才能保存。',
      es: 'Usa Volver para revisar el libro, Cancelar para salir sin guardar o Restablecer sugerencias para recuperar códigos conservando los detalles editados. Las propuestas no reservan nada. La confirmación final valida otra vez la biblioteca; cualquier conflicto nuevo debe resolverse antes de guardar.',
    },
  'Review codes before saving': {
    zh: '保存前审核货号',
    es: 'Revisa los códigos antes de guardar',
  },
  'First confirm the workbook date, photos, quantities, allocations and total. Review codes opens editable proposals without saving an order or reserving codes. Import and assign codes saves the reviewed order, photos, preparation and assignments together.':
    {
      zh: '先确认工作簿的采购日期、照片、数量、分配和总金额。“审核编码”会打开可编辑方案，不保存订单，也不占用货号。“导入并分配编码”会一次保存已审核的订单、照片、准备数据和货号分配。',
      es: 'Confirma primero la fecha de compra, las fotos, las cantidades, los repartos y el total. Revisar códigos abre propuestas editables sin guardar el pedido ni reservar códigos. Importar y asignar códigos guarda juntos el pedido revisado, las fotos, la preparación y las asignaciones.',
    },
  'Use one base code per group': {
    zh: '每组共用一个基础货号',
    es: 'Usa un código base por grupo',
  },
  'Equal group values share one editable CE product base, even when rows are separated or titles differ. Edit the base once for the whole group. A literal group value such as 12 is a grouping key, not the CE digits to assign.':
    {
      zh: '相同 group 值共用一个可编辑的 CE 商品基础货号，即使行不相邻或标题不同。修改一次基础货号即可应用于整组。12 等原始 group 值只是分组标识，不会成为待分配的 CE 数字。',
      es: 'Los valores group iguales comparten una base CE editable, aunque las filas estén separadas o tengan títulos distintos. Edita la base una vez para todo el grupo. Un valor como 12 solo identifica el grupo; no indica los dígitos CE que se asignarán.',
    },
  'Edit variant and size endings': {
    zh: '编辑款式和尺码后缀',
    es: 'Edita los sufijos de variante y talla',
  },
  'Review each variant ending and size ending; the full barcode updates as you edit. Resolve every unknown size or explicitly choose No size difference when appropriate. An unresolved size or invalid or conflicting code blocks the final import.':
    {
      zh: '核对每个款式后缀和尺码后缀；完整条码会随编辑实时更新。请解决所有未知尺码，或在适用时明确选择“无尺寸差异”。未解决的尺码、无效货号或货号冲突都会阻止最终导入。',
      es: 'Revisa cada sufijo de variante y talla; el código de barras completo se actualiza al editar. Resuelve las tallas desconocidas o elige expresamente Sin diferencia de talla cuando corresponda. Una talla pendiente o un código inválido o en conflicto bloquea la importación final.',
    },
  'Keep purchase-month and ownership rules': {
    zh: '遵守采购月份和货号归属规则',
    es: 'Respeta el mes de compra y la titularidad',
  },
  'New codes must use the confirmed purchase calendar month and known supplier identity. Current assignments and immutable shipment history protect code ownership. Proposed edits must satisfy these same rules; changing a group label cannot bypass them.':
    {
      zh: '新货号必须使用已确认的采购日历月份和已知供应商身份。当前分配与不可变更的出货历史共同保护货号归属。编辑方案同样必须遵守这些规则；更改 group 标识不能绕过校验。',
      es: 'Los códigos nuevos deben usar el mes calendario de la compra confirmada y la identidad conocida del proveedor. Las asignaciones actuales y el historial inmutable de envíos protegen la titularidad. Las propuestas deben cumplir las mismas reglas; cambiar la etiqueta group no las evita.',
    },
  'Return or reset without reserving codes': {
    zh: '返回或重置方案不会占用货号',
    es: 'Vuelve o restablece sin reservar códigos',
  },
  'Use Back to review the workbook, Cancel to leave without saving, or Reset to suggested to restore proposed codes. Proposals reserve nothing. Final confirmation revalidates the current library; a new conflict must be resolved before anything is saved.':
    {
      zh: '选择“返回”可重新核对工作簿，“取消”会退出且不保存，“重置为建议编码”可恢复建议货号。方案不会占用任何货号。最终确认时会重新校验当前资料库；出现新冲突时，必须解决后才能保存任何内容。',
      es: 'Usa Volver para revisar el libro, Cancelar para salir sin guardar o Restablecer sugerencias para recuperar las propuestas. Las propuestas no reservan nada. La confirmación final vuelve a validar la biblioteca actual; cualquier conflicto nuevo debe resolverse antes de guardar.',
    },
  'This appears to match {0} imported order(s). Importing again creates a separate purchase; review the date before continuing.':
    {
      es: 'Esto parece coincidir con {0} pedido(s) importado(s). Volver a importar crea una compra separada; revisa la fecha antes de continuar.',
      zh: '此文件似乎与 {0} 个已导入订单相同。再次导入会创建独立采购；请先核对日期。',
    },
  'Workbook guide': { zh: '工作簿指南', es: 'Guía del libro' },
  Setup: { zh: '准备', es: 'Preparar' },
  Markers: { zh: '标记', es: 'Marcadores' },
  Checks: { zh: '核对', es: 'Revisar' },
  'Use the store number or factory name as the filename. Copy suffixes keep the same store; each import adds a new order.':
    {
      zh: '用门店号或工厂名命名文件。复制后缀不改变门店；每次导入都会新增一个订单。',
      es: 'Usa el número de tienda o el nombre de fábrica como archivo. Los sufijos de copia conservan la tienda; cada importación añade un pedido.',
    },
  'Keep the original. Add one marker row above the seller’s headers in a copy. Only marked columns are read, in any order.':
    {
      zh: '保留原文件。在副本的卖家表头上方添加一行标记。只读取已标记的列，列顺序不限。',
      es: 'Conserva el original. Añade una fila de marcadores sobre los encabezados en una copia. Solo se leen las columnas marcadas, en cualquier orden.',
    },
  'Copy markers from the Markers tab. Repeat desc to combine description columns.':
    {
      zh: '从“标记”页复制标记。重复使用 desc 可合并多个描述列。',
      es: 'Copia los marcadores de la pestaña Marcadores. Repite desc para combinar columnas de descripción.',
    },
  'Check boxes × perbox = qty, price × qty = amount, and the row amounts against total. A mismatch blocks import and names the affected cells; values are never silently corrected.':
    {
      zh: '核对 boxes × perbox = qty、price × qty = amount，以及各行金额之和是否等于 total。不一致时会阻止导入并指出相关单元格，不会自动修改数值。',
      es: 'Comprueba boxes × perbox = qty, price × qty = amount y la suma frente a total. Una diferencia bloquea la importación e identifica las celdas; nunca se corrigen valores sin avisar.',
    },
  'Numbers may include units, such as 6元, 20.5 KG or 0.14 CBM. Ambiguous values need review. kg and cbm always describe one carton.':
    {
      zh: '数字可带单位，如 6元、20.5 KG 或 0.14 CBM。含义不清的值需要审核。kg 和 cbm 始终表示每箱数值。',
      es: 'Los números pueden incluir unidades, como 6元, 20.5 KG o 0.14 CBM. Revisa los valores ambiguos. kg y cbm siempre corresponden a una caja.',
    },
  'cbm is supplier volume per carton. Put complete centimetre dimensions in cbmx, cbmy and cbmz. In the workspace, volume is calculated from Length × Width × Height ÷ 1,000,000; supplied volume stays read-only until dimensions supersede it.':
    {
      zh: 'cbm 是供应商提供的每箱体积。完整厘米尺寸分别填入 cbmx、cbmy、cbmz。工作区按长 × 宽 × 高 ÷ 1,000,000 计算体积；填写完整尺寸前，供应商体积仅供查看。',
      es: 'cbm es el volumen por caja indicado por el proveedor. Pon las medidas completas en centímetros en cbmx, cbmy y cbmz. El espacio de trabajo calcula largo × ancho × alto ÷ 1,000,000; el volumen indicado es de solo lectura hasta completar las medidas.',
    },
  'abcd shares one quantity and amount across A–D. Quantities start with an even whole-piece split; extra pieces go one each in declaration order. Edit the split if the seller supplies a different breakdown. abs, abm and abl mean A/B in sizes S, M and L. Allocations keep one source carton record; they never multiply its cartons.':
    {
      zh: 'abcd 表示 A–D 共用一份数量和金额。默认按整件平均分配，余数按声明顺序逐款多分一件；供应商提供其他分配时可修改。abs、abm、abl 分别表示 S、M、L 尺码的 A/B 款。分配后仍保留一份来源纸箱记录，不会增加箱数。',
      es: 'abcd comparte una cantidad e importe entre A–D. Se propone un reparto uniforme de piezas enteras; los sobrantes se distribuyen de uno en uno según el orden declarado. Ajusta las cantidades si el proveedor indica otro reparto. abs, abm y abl indican A/B en tallas S, M y L. Se conserva un único registro original de cajas, sin multiplicarlas.',
    },
  'Every product needs a photo. One photo can serve different groups when its anchor or merged pic cell covers their rows. Confirm shared photos during review. Missing or unreadable photos block import. Square thumbnails keep proportions and originals.':
    {
      zh: '每件商品都需要照片。图片锚定范围或合并的 pic 单元格覆盖对应行时，不同商品组可以共用照片。审核时请确认共用照片。缺失或无法读取的照片会阻止导入。正方形缩略图保持比例，并保留原图。',
      es: 'Cada producto necesita foto. Una foto puede servir a distintos grupos si su anclaje o celda pic combinada cubre sus filas. Confirma las fotos compartidas al revisar. Las fotos ausentes o ilegibles bloquean la importación. Las miniaturas cuadradas conservan las proporciones y los originales.',
    },
  'Import once, then review Products and Cartons in Orders. Supported source carton facts are confirmed during import; capacity-only edits remain proposals. Review prefilled remainders and confirm one order when its physical facts are ready. Add extra order costs separately.':
    {
      zh: '只导入一次，然后在“订单”的“商品”和“纸箱”中核对。导入时确认有来源支持的纸箱事实；仅修改每箱件数仍是方案。核对自动填写的余件，实物事实齐全后统一确认该采购。额外订单费用单独记录。',
      es: 'Importa una vez y revisa Productos y Cajas en Pedidos. Los datos físicos respaldados por el archivo se confirman al importar; editar solo la capacidad sigue siendo una propuesta. Revisa los sobrantes precargados y confirma el pedido cuando sus datos físicos estén listos. Registra los costes extra aparte.',
    },
  'Choose contents and carton mark': {
    zh: '选择箱内商品与实际唛头',
    es: 'Elige contenido y marca de caja',
  },
  'Each carton belongs to one purchase. Products from that purchase may mix, with an independent carton mark even when its group contributes no pieces. Eligible repeat purchases may share reviewed codes across purchase months, but keep separate quantities, prices and cartons. Unequal cartons and aggregate totals never establish a uniform per-box split.':
    {
      zh: '每个纸箱只属于一笔采购。同一采购的商品可以混装，唛头单独选择，即使唛头组没有商品装入此箱。符合条件的重复采购可以跨采购月份复用已核对货号，但数量、价格和实物纸箱始终分开。不等量纸箱或合计数不能证明每箱均分。',
      es: 'Cada caja pertenece a una sola compra. Puedes mezclar sus productos y elegir una marca independiente, aunque su grupo no aporte piezas. Las compras repetidas elegibles pueden compartir códigos revisados entre meses, pero conservan cantidades, precios y cajas separados. Las cajas desiguales y los totales conjuntos no prueban un reparto uniforme.',
    },
  'Confirm loading in a container': {
    zh: '在货柜中确认装柜',
    es: 'Confirma la carga en un contenedor',
  },
  'In Packing, include whole orders in a named container and confirm Loaded or Left behind for physical cartons. Product quantities follow those decisions. Seal a revision after review; correct sealed facts through an amendment. Keep per-carton and combined measurements distinct; partial combined totals stay unknown. Receiving and supplier delivery remain separate.':
    {
      zh: '在“装箱”中，把整笔采购加入已命名货柜，再确认实物纸箱“已装柜”或“留下”。商品数量由这些决定自动得出。核对后封存修订，已封存事实通过修订更正。单箱与合计测量分开保留；部分箱数不能推算合计测量。实收与供应商发货仍分别记录。',
      es: 'En Empaque, incluye pedidos completos en un contenedor con nombre y confirma las cajas Cargadas o Se quedaron. Las cantidades se derivan de esas decisiones. Sella una revisión después de comprobarla; corrige lo sellado mediante una enmienda. Distingue medidas por caja y conjuntas: una parte no determina el total combinado. La recepción y la entrega del proveedor siguen separadas.',
    },
  'Confirm the purchase date in the form. The filename identifies the store, not the date.':
    {
      zh: '在表单中确认购买日期。文件名只标识门店，不表示购买日期。',
      es: 'Confirma la fecha de compra en el formulario. El archivo identifica la tienda, no la fecha.',
    },
  'Download template': { zh: '下载模板', es: 'Descargar plantilla' },
  'Download an editable workbook with ready import markers, formatted product rows and formulas.':
    {
      zh: '下载可编辑的工作簿，其中已设好导入标记、商品行格式和公式。',
      es: 'Descarga un libro editable con marcadores, filas de productos y fórmulas ya preparados.',
    },
  'Save your completed copy as the store number or factory name, then choose it below.':
    {
      zh: '填写后以门店编号或工厂名称保存副本，再在下方选择文件。',
      es: 'Guarda tu copia completada con el número de tienda o el nombre de la fábrica y selecciónala debajo.',
    },
  'Workbook checks': { zh: '表格核对', es: 'Revisión del Excel' },
  'Check all reviews': {
    zh: '勾选全部审核项',
    es: 'Marcar todas las revisiones',
  },
  'Confirms review warnings only. Workbook errors, variant quantities and the final photo check still need attention.':
    {
      zh: '仅确认可审核的提醒。表格错误、款式数量分配及最终照片核对仍需单独处理。',
      es: 'Solo confirma los avisos revisables. Los errores, las cantidades por variante y la comprobación final de fotos siguen requiriendo atención.',
    },
  '{checked}/{total} reviews checked · {blocking} blocking': {
    zh: '已核对 {checked}/{total} 项 · {blocking} 项阻止导入',
    es: '{checked}/{total} revisiones marcadas · {blocking} bloqueos',
  },
  'Confirm review {0}': {
    zh: '确认第 {0} 项审核',
    es: 'Confirmar revisión {0}',
  },
  'Shared product photo': {
    zh: '商品共用照片',
    es: 'Foto compartida de productos',
  },
  'Missing product photo': {
    zh: '缺少商品照片',
    es: 'Falta la foto del producto',
  },
  'Unreadable photo': { zh: '照片无法读取', es: 'Foto ilegible' },
  'Split variant quantities': {
    zh: '分配款式数量',
    es: 'Repartir cantidades por variante',
  },
  'Quantity mismatch': { zh: '数量不符', es: 'Cantidad incorrecta' },
  'Product amount mismatch': {
    zh: '商品金额不符',
    es: 'Importe del producto incorrecto',
  },
  'Order total mismatch': {
    zh: '订单总金额不符',
    es: 'Total del pedido incorrecto',
  },
  'Incomplete carton dimensions': {
    zh: '纸箱尺寸不完整',
    es: 'Medidas de caja incompletas',
  },
  'Confirm these rows share this photo.': {
    zh: '请确认这些商品行共用此照片。',
    es: 'Confirma que estas filas comparten la foto.',
  },
  'Paste a picture into this row’s pic cell in Excel.': {
    zh: '请在 Excel 中将照片粘贴到此行的 pic 单元格。',
    es: 'Pega una foto en la celda pic de esta fila en Excel.',
  },
  'Replace this picture with an embedded image in Excel.': {
    zh: '请在 Excel 中将此照片替换为嵌入图片。',
    es: 'Sustituye esta foto por una imagen incrustada en Excel.',
  },
  'Review the suggested quantities in the product row below; adjust them if needed.':
    {
      zh: '请查看下方商品行的建议数量，需要时可修改。',
      es: 'Revisa las cantidades propuestas en la fila inferior y ajústalas si hace falta.',
    },
  'Correct qty, boxes or perbox in Excel.': {
    zh: '请在 Excel 中修改 qty、boxes 或 perbox。',
    es: 'Corrige qty, boxes o perbox en Excel.',
  },
  'Correct price, qty or amount in Excel.': {
    zh: '请在 Excel 中修改 price、qty 或 amount。',
    es: 'Corrige price, qty o amount en Excel.',
  },
  'Correct the product rows or the seller’s total in Excel.': {
    zh: '请在 Excel 中修改商品行或卖家总金额。',
    es: 'Corrige las filas de productos o el total del vendedor en Excel.',
  },
  'Review photo {0}': { zh: '核对照片 {0}', es: 'Foto de revisión {0}' },
  'View review photo for row {0}, photo {1}': {
    zh: '查看第 {0} 行的审核照片 {1}',
    es: 'Ver foto {1} de la revisión de la fila {0}',
  },
  'Rows {0}': { zh: '第 {0} 行', es: 'Filas {0}' },
  'Source qty': { zh: '表格数量', es: 'Cantidad original' },
  'Source amount': { zh: '表格金额', es: 'Importe original' },
  'Seller total': { zh: '卖家合计', es: 'Total del vendedor' },
  Calculated: { zh: '计算结果', es: 'Calculado' },
  Blocked: { zh: '需修正', es: 'Bloqueado' },
  Manual: { zh: '需填写', es: 'Manual' },
  'The source photo changed. Reopen the photo before editing it.': {
    zh: '来源照片已更改。请重新打开照片后再编辑。',
    es: 'La foto original cambió. Vuelve a abrirla antes de editar.',
  },
  'Copy store number': { zh: '复制门店号', es: 'Copiar número de tienda' },
  'The order was imported. Close this window and reopen the workspace to refresh the table.':
    {
      zh: '订单已导入。请关闭此窗口并重新打开工作区以刷新表格。',
      es: 'El pedido se importó. Cierra esta ventana y vuelve a abrir el espacio de trabajo para actualizar la tabla.',
    },
  'Skipped rows': { zh: '跳过行数', es: 'Filas omitidas' },
  box: { zh: '箱', es: 'caja' },
  'Import spreadsheet': { zh: '导入表格', es: 'Importar Excel' },
  'Source spreadsheet': { zh: '来源表格', es: 'Archivo Excel original' },
  'Store number': { zh: '门店号', es: 'Número de tienda' },
  'Save store name': { zh: '保存门店名称', es: 'Guardar nombre de tienda' },
  'View all {0} orders from this store': {
    zh: '查看此门店的全部 {0} 个订单',
    es: 'Ver los {0} pedidos de esta tienda',
  },
  'Import a marked store spreadsheet. Review pictures, quantities, prices and purchase date before saving a new order.':
    {
      zh: '导入已添加标记的门店表格。保存新订单前核对照片、数量、价格和购买日期。',
      es: 'Importa un Excel de tienda con marcadores. Revisa las fotos, las cantidades, los precios y la fecha antes de guardar un pedido nuevo.',
    },
  'Enter a number.': { zh: '请输入数字。', es: 'Introduce un número.' },
  'Enter one number, not a calculation or dimensions.': {
    zh: '请输入单个数字，不要填写算式或尺寸组合。',
    es: 'Introduce un solo número, no una operación ni varias medidas.',
  },
  'Use a decimal point and valid thousands separators.': {
    zh: '请使用小数点及正确的千位分隔符。',
    es: 'Usa un punto decimal y separadores de miles válidos.',
  },
  'Enter one unambiguous number; optional units may follow it.': {
    zh: '请输入一个明确的数字，后面可附单位。',
    es: 'Introduce un número inequívoco; puedes añadir la unidad.',
  },
  'Enter a positive number.': {
    zh: '请输入正数。',
    es: 'Introduce un número positivo.',
  },
  'Enter a nonnegative number.': {
    zh: '请输入不小于零的数字。',
    es: 'Introduce un número mayor o igual a cero.',
  },
  'Enter a positive whole number within the supported range.': {
    zh: '请输入支持范围内的正整数。',
    es: 'Introduce un entero positivo dentro del rango admitido.',
  },
  'Use a variant letter, size, combined letters (abcd), or letters with a size (abs).':
    {
      zh: '请填写款式字母、尺寸、组合字母（abcd），或字母加尺寸（abs）。',
      es: 'Usa una letra de variante, una talla, varias letras (abcd) o letras con una talla (abs).',
    },
  'Choose a worksheet from this workbook.': {
    zh: '请从此工作簿中选择工作表。',
    es: 'Elige una hoja de este libro.',
  },
  'Add the required {marker} marker to the marker row.': {
    zh: '请在标记行添加必填标记 {marker}。',
    es: 'Añade el marcador obligatorio {marker} a la fila de marcadores.',
  },
  'Add perbox, qty, or both to the marker row.': {
    zh: '请在标记行添加 perbox、qty，或同时添加两者。',
    es: 'Añade perbox, qty o ambos a la fila de marcadores.',
  },
  'Use {marker} only once in the marker row.': {
    zh: '标记行只能出现一次 {marker}。',
    es: 'Usa {marker} solo una vez en la fila de marcadores.',
  },
  'The value between total markers must be a valid monetary amount.': {
    zh: '两个 total 标记之间必须是有效金额。',
    es: 'El valor entre los marcadores total debe ser un importe válido.',
  },
  'Surround exactly one whole-order amount with two total markers: total | amount | total.':
    {
      zh: '请用两个 total 标记包围唯一的订单总金额：total | 金额 | total。',
      es: 'Rodea un único total de pedido con dos marcadores total: total | importe | total.',
    },
  'Remove or pair the extra total markers.': {
    zh: '请移除多余的 total 标记，或将其正确配对。',
    es: 'Elimina o empareja los marcadores total sobrantes.',
  },
  'Correct this spreadsheet formula error before importing.': {
    zh: '请先修正此表格公式错误再导入。',
    es: 'Corrige este error de fórmula antes de importar.',
  },
  'Open and save this workbook in Excel so this formula has a calculated value.':
    {
      zh: '请在 Excel 中打开并保存工作簿，使此公式具有计算结果。',
      es: 'Abre y guarda el libro en Excel para que la fórmula tenga un resultado calculado.',
    },
  'Enter {marker} for this included product row.': {
    zh: '请为此待导入商品行填写 {marker}。',
    es: 'Indica {marker} para esta fila incluida.',
  },
  '{marker}: {reason}': { zh: '{marker}：{reason}', es: '{marker}: {reason}' },
  'Supply an exact positive qty or perbox value; qty must divide evenly across boxes.':
    {
      zh: '请填写准确的正整数 qty 或 perbox；qty 必须能被 boxes 整除。',
      es: 'Indica un valor entero positivo exacto en qty o perbox; qty debe repartirse entre boxes sin sobrantes.',
    },
  '{boxes} boxes × {perbox} pcs/box = {expected} pieces, but qty is {quantity}. Correct the source values.':
    {
      zh: '{boxes} 箱 × 每箱 {perbox} 件 = {expected} 件，但 qty 为 {quantity}。请修改源数据。',
      es: '{boxes} cajas × {perbox} pzas/caja = {expected} piezas, pero qty indica {quantity}. Corrige los valores originales.',
    },
  'The calculated quantity exceeds the supported whole-number range.': {
    zh: '计算出的数量超出支持的整数范围。',
    es: 'La cantidad calculada supera el rango de enteros admitido.',
  },
  'Price {price} × quantity {quantity} = ¥{expected}, but amount is ¥{amount}. Correct the source values.':
    {
      zh: '单价 {price} × 数量 {quantity} = ¥{expected}，但 amount 为 ¥{amount}。请修改源数据。',
      es: 'Precio {price} × cantidad {quantity} = ¥{expected}, pero amount indica ¥{amount}. Corrige los valores originales.',
    },
  'Enter all three carton dimensions: cbmx, cbmy and cbmz.': {
    zh: '请填写全部三项纸箱尺寸：cbmx、cbmy 和 cbmz。',
    es: 'Introduce las tres medidas de la caja: cbmx, cbmy y cbmz.',
  },
  'This row combines variants. Quantities are suggested evenly; adjust them if needed. Source totals and cartons stay unchanged.':
    {
      zh: '此行包含多种款式，默认建议平均分配，可按需要修改。来源总数量、金额和箱数保持不变。',
      es: 'Esta fila combina variantes. Se propone un reparto uniforme que puedes ajustar. Los totales y las cajas originales no cambian.',
    },
  'No included product rows were found. Add group values to the product rows to import.':
    {
      zh: '未找到待导入商品行。请为需要导入的商品行填写 group 值。',
      es: 'No hay filas incluidas. Añade valores group a los productos que quieras importar.',
    },
  'A group with multiple source rows cannot contain combined variants without distinct sizes. Give each variant its own row, or use distinct sized assortments such as abs, abm and abl.':
    {
      zh: '同组有多个源数据行时，合并款式必须有不同尺寸。请将每个款式分行，或使用 abs、abm、abl 等不同尺寸的组合。',
      es: 'Un grupo con varias filas no puede combinar variantes sin tallas distintas. Usa una fila por variante o surtidos de tallas distintas como abs, abm y abl.',
    },
  'This picture is not embedded as a readable raster image. Paste the picture into its product row in Excel.':
    {
      zh: '此照片未以可读取的位图形式嵌入。请在 Excel 中将照片粘贴到对应的商品行。',
      es: 'Esta foto no está incrustada como una imagen legible. Pégala en su fila de producto en Excel.',
    },
  'This picture covers multiple product rows, which may belong to different groups. Confirm these rows share this photo.':
    {
      zh: '此照片覆盖多个商品行，这些行可以属于不同商品组。请确认这些商品行共用此照片。',
      es: 'Esta foto cubre varias filas de productos, que pueden pertenecer a distintos grupos. Confirma que estas filas comparten la foto.',
    },
  'Every included product row needs an embedded picture anchored to its pic cell or a merged pic cell covering that row.':
    {
      zh: '每个待导入商品行都需要嵌入照片，并定位在其 pic 单元格或覆盖该行的合并 pic 单元格内。',
      es: 'Cada fila incluida necesita una foto incrustada anclada a su celda pic o a una celda pic combinada que cubra esa fila.',
    },
  'The product rows total ¥{computedTotal}, but the whole-order total control is ¥{total}. Correct the source values before importing.':
    {
      zh: '商品行合计为 ¥{computedTotal}，但订单总金额校验值为 ¥{total}。请先修改源数据再导入。',
      es: 'Las filas suman ¥{computedTotal}, pero el control del pedido indica ¥{total}. Corrige los valores originales antes de importar.',
    },
  'The spreadsheet exceeds the 100 MB import limit.': {
    zh: '表格文件超过 100 MB 导入限制。',
    es: 'El archivo supera el límite de importación de 100 MB.',
  },
  'Choose an Excel .xlsx or .xls workbook.': {
    zh: '请选择 .xlsx 或 .xls 格式的 Excel 工作簿。',
    es: 'Elige un libro de Excel .xlsx o .xls.',
  },
  'Spreadsheet could not be read.': {
    zh: '无法读取表格文件。',
    es: 'No se pudo leer el archivo de Excel.',
  },
  'Photo dimensions are invalid': {
    zh: '照片尺寸无效',
    es: 'Las dimensiones de la foto no son válidas',
  },
  'Adjust photo': { zh: '调整照片', es: 'Ajustar foto' },
  'Save photo': { zh: '保存照片', es: 'Guardar foto' },
  'Reset photo': { zh: '重置照片', es: 'Restablecer foto' },
  'Fit inside square': { zh: '完整放入方形', es: 'Encajar en el cuadrado' },
  'Fill square (crop)': {
    zh: '填满方形（裁剪）',
    es: 'Llenar el cuadrado (recortar)',
  },
  'Canvas fit': { zh: '画布适配', es: 'Ajuste al lienzo' },
  'Image size': { zh: '图片大小', es: 'Tamaño de imagen' },
  'Horizontal position': { zh: '水平位置', es: 'Posición horizontal' },
  'Vertical position': { zh: '垂直位置', es: 'Posición vertical' },
  'Canvas background': { zh: '画布背景', es: 'Fondo del lienzo' },
  'Adjust the square canvas. The original photo is kept.': {
    zh: '调整方形画布，原始照片将保留。',
    es: 'Ajusta el lienzo cuadrado. Se conserva la foto original.',
  },
  'Photo saved. Original preserved.': {
    zh: '照片已保存，原图已保留。',
    es: 'Foto guardada. Original conservado.',
  },
  'Carton details': { zh: '纸箱信息', es: 'Datos de la caja' },
  'One carton · optional': { zh: '单箱数据 · 选填', es: 'Una caja · opcional' },
  'Save to apply changes': {
    zh: '保存后应用修改',
    es: 'Guarda para aplicar los cambios',
  },
  'Decrease cartons': { zh: '减少箱数', es: 'Reducir cajas' },
  'Increase cartons': { zh: '增加箱数', es: 'Aumentar cajas' },
  Weight: { zh: '重量', es: 'Peso' },
  Length: { zh: '长度', es: 'Largo' },
  'Manual volume': { zh: '手动体积', es: 'Volumen manual' },
  'Using manual volume': { zh: '使用手动体积', es: 'Usando el volumen manual' },
  'Complete dimensions take priority. Manual volume is kept.': {
    zh: '尺寸齐全时优先计算，手动体积会保留。',
    es: 'Las medidas completas tienen prioridad. El volumen manual se conserva.',
  },
  'Carton dimensions must be greater than zero.': {
    zh: '纸箱尺寸必须大于零。',
    es: 'Las medidas de la caja deben ser mayores que cero.',
  },
  'Weight (kg/box)': { zh: '重量（千克/箱）', es: 'Peso (kg/caja)' },
  'Volume (m³/box)': { zh: '体积（立方米/箱）', es: 'Volumen (m³/caja)' },
  'Length (cm)': { zh: '长度（厘米）', es: 'Largo (cm)' },
  'Width (cm)': { zh: '宽度（厘米）', es: 'Ancho (cm)' },
  'Height (cm)': { zh: '高度（厘米）', es: 'Alto (cm)' },
  'Volume per carton: {0} m³': {
    zh: '单箱体积：{0} 立方米',
    es: 'Volumen por caja: {0} m³',
  },
  'Complete centimetre dimensions take priority over the supplied volume. Weight and volume always describe one carton.':
    {
      zh: '以厘米填写的三项尺寸齐全时，优先用于计算体积。重量和体积始终指单箱值。',
      es: 'Las tres medidas en centímetros tienen prioridad sobre el volumen indicado. El peso y el volumen siempre corresponden a una caja.',
    },
  'Import store spreadsheet': {
    zh: '导入门店表格',
    es: 'Importar Excel de tienda',
  },
  'Review one sheet, then save it as a new order.': {
    zh: '审核一个工作表后，将其保存为新订单。',
    es: 'Revisa una hoja y guárdala como un pedido nuevo.',
  },
  'Import order': { zh: '导入订单', es: 'Importar pedido' },
  'Close import': { zh: '关闭导入', es: 'Cerrar importación' },
  Workbook: { zh: '工作簿', es: 'Libro de Excel' },
  'Store or factory name': {
    zh: '门店或工厂名称',
    es: 'Nombre de tienda o fábrica',
  },
  'Choose the marked .xlsx or .xls file to begin.': {
    zh: '请选择已添加标记的 .xlsx 或 .xls 文件。',
    es: 'Elige el archivo .xlsx o .xls con los marcadores para empezar.',
  },
  'Confirm the date of this purchase; the filename only identifies the store.':
    {
      zh: '请确认本次购买日期；文件名仅用于识别门店。',
      es: 'Confirma la fecha de esta compra; el nombre del archivo solo identifica la tienda.',
    },
  'I checked the product photos, quantities and order total.': {
    zh: '我已核对商品照片、数量和订单总金额。',
    es: 'He revisado las fotos, las cantidades y el total del pedido.',
  },
  'File naming, markers and review rules': {
    zh: '文件命名、导入标记与审核规则',
    es: 'Nombres de archivo, marcadores y reglas de revisión',
  },
  'Store number {0} · Each import creates a separate order.': {
    zh: '门店号 {0} · 每次导入均创建独立订单。',
    es: 'Tienda n.º {0} · Cada importación crea un pedido independiente.',
  },
  'Factory · No store number · Each import creates a separate order.': {
    zh: '工厂 · 无门店号 · 每次导入均创建独立订单。',
    es: 'Fábrica · Sin número de tienda · Cada importación crea un pedido independiente.',
  },
  'Included rows': { zh: '导入行数', es: 'Filas incluidas' },
  'Product groups': { zh: '商品组数', es: 'Grupos de productos' },
  'Calculated total · CNY': {
    zh: '计算总金额 · 人民币',
    es: 'Total calculado · CNY',
  },
  'Seller total · CNY': {
    zh: '卖家总金额 · 人民币',
    es: 'Total del vendedor · CNY',
  },
  'Row {0}': { zh: '第 {0} 行', es: 'Fila {0}' },
  'Group {0}': { zh: '分组 {0}', es: 'Grupo {0}' },
  'Row {0}, photo {1}': {
    zh: '第 {0} 行，第 {1} 张照片',
    es: 'Fila {0}, foto {1}',
  },
  'View or adjust row {0}, photo {1}': {
    zh: '查看或调整第 {0} 行的第 {1} 张照片',
    es: 'Ver o ajustar la foto {1} de la fila {0}',
  },
  'Photo missing': { zh: '缺少照片', es: 'Falta la foto' },
  'kg/carton': { zh: '千克/箱', es: 'kg/caja' },
  'm³/carton': { zh: '立方米/箱', es: 'm³/caja' },
  'Carton · cm': { zh: '纸箱尺寸 · 厘米', es: 'Caja · cm' },
  'Split the combined quantity': {
    zh: '分配合计数量',
    es: 'Reparte la cantidad combinada',
  },
  'Split evenly by default. Adjust these quantities if the seller supplies a different breakdown.':
    {
      zh: '默认平均分配。供应商提供不同分配时，请修改这些数量。',
      es: 'Se reparte por igual de forma predeterminada. Ajusta estas cantidades si el proveedor indica otro reparto.',
    },
  'For the default split, extra pieces go one each to the first variants in declaration order.':
    {
      zh: '默认分配时，多出的件数按声明顺序逐款多分一件。',
      es: 'En el reparto predeterminado, las piezas sobrantes se asignan de una en una a las primeras variantes según el orden declarado.',
    },
  'Row {0}: {1} pieces cannot give all {2} variants a positive whole-piece quantity. Correct the total or variant declaration.':
    {
      zh: '第 {0} 行：{1} 件不足以为全部 {2} 个款式各分配至少一整件。请更正总数量或款式声明。',
      es: 'Fila {0}: {1} piezas no permiten asignar al menos una pieza entera a cada una de las {2} variantes. Corrige el total o la declaración de variantes.',
    },
  'These variants share the source row’s cartons. Their physical packing needs review; carton counts are never multiplied.':
    {
      zh: '这些款式共用源数据行的纸箱。实际装箱需要审核；箱数不会重复计算。',
      es: 'Estas variantes comparten las cajas de la fila original. Revisa su empaque físico; el número de cajas nunca se multiplica.',
    },
  '{0} of {1} units allocated': {
    zh: '已分配 {0} / {1} 件',
    es: '{0} de {1} unidades asignadas',
  },
  'Row {0}, variant {1} quantity': {
    zh: '第 {0} 行，款式 {1} 的数量',
    es: 'Fila {0}, cantidad de la variante {1}',
  },
  '{0} workbook issues block import. Fix the marked cells and choose the corrected file.':
    {
      zh: '工作簿中有 {0} 个问题阻止导入。请修改标出的单元格后重新选择文件。',
      es: '{0} problemas del libro impiden importar. Corrige las celdas indicadas y elige el archivo corregido.',
    },
  'Check the photos and totals, confirm the date, and complete the highlighted reviews.':
    {
      zh: '请核对照片和总金额、确认日期，并完成标出的审核项。',
      es: 'Comprueba las fotos y los totales, confirma la fecha y completa las revisiones señaladas.',
    },
  'Reading workbook and product photos…': {
    zh: '正在读取工作簿和商品照片…',
    es: 'Leyendo el libro y las fotos de los productos…',
  },
  'Saving the reviewed order…': {
    zh: '正在保存已审核的订单…',
    es: 'Guardando el pedido revisado…',
  },
  'Preparing photo {0} of {1}…': {
    zh: '正在处理第 {0} / {1} 张照片…',
    es: 'Preparando foto {0} de {1}…',
  },
  Review: { zh: '待核对', es: 'Revisar' },
  Checked: { zh: '已核对', es: 'Comprobado' },
  'Fix in workbook': { zh: '请修改工作簿', es: 'Corregir en el libro' },
  'Choose a workbook with at least one included product row.': {
    zh: '请选择至少包含一行待导入商品的工作簿。',
    es: 'Elige un libro que incluya al menos una fila de producto.',
  },
  'Confirm the purchase date before importing.': {
    zh: '请先确认购买日期再导入。',
    es: 'Confirma la fecha de compra antes de importar.',
  },
  'Enter the store or factory name.': {
    zh: '请填写门店或工厂名称。',
    es: 'Introduce el nombre de la tienda o fábrica.',
  },
  'Review the product photos and source totals before importing.': {
    zh: '请先核对商品照片和源数据总金额再导入。',
    es: 'Revisa las fotos y los totales del archivo antes de importar.',
  },
  'Confirm each highlighted review item before importing.': {
    zh: '请先确认每个标出的审核项再导入。',
    es: 'Confirma cada revisión señalada antes de importar.',
  },
  'Row {0}: enter a positive quantity for every variant; the sum must be {1}.':
    {
      zh: '第 {0} 行：请为每种款式填写正整数数量；总和必须为 {1}。',
      es: 'Fila {0}: indica una cantidad positiva para cada variante; la suma debe ser {1}.',
    },
  'Could not read this workbook. Check the file and try again.': {
    zh: '无法读取工作簿，请检查文件后重试。',
    es: 'No se pudo leer el libro. Revisa el archivo e inténtalo de nuevo.',
  },
  'Use the exact English markers': {
    zh: '使用准确的英文标记',
    es: 'Usa los marcadores exactos en inglés',
  },
  'Only the markers listed here are imported. Old pinyin names and alternate spellings must be replaced in your workbook. amount checks one product row; the two total markers check the complete order.':
    {
      zh: '仅导入本指南列出的标记。请替换工作簿中的旧拼音标记或其他拼写。amount 核对单行商品金额；两个 total 标记核对整张订单的总金额。',
      es: 'Solo se importan los marcadores de esta guía. Sustituye los nombres antiguos en pinyin y las variantes de escritura. amount comprueba una fila; los dos marcadores total comprueban el pedido completo.',
    },
  'Store spreadsheet guide': {
    zh: '门店表格格式指南',
    es: 'Guía de Excel de tiendas',
  },
  'Close spreadsheet guide': {
    zh: '关闭表格指南',
    es: 'Cerrar guía de Excel',
  },
  'Check import markers, filenames and review rules. This format guide does not import files or change your library.':
    {
      zh: '查看导入标记、文件命名和审核规则。本格式指南不会导入文件，也不会更改资料库。',
      es: 'Consulta los marcadores, los nombres de archivo y las reglas de revisión. Esta guía de formato no importa archivos ni cambia tu biblioteca.',
    },
  'Prepare a copy of the seller’s workbook, then review its rows, photos, totals and editable code proposals before saving a new order.':
    {
      zh: '请先制作卖家工作簿的副本，保存新订单前审核行、照片、总金额和可编辑的货号方案。',
      es: 'Prepara una copia del libro del vendedor y revisa sus filas, fotos, totales y propuestas de códigos editables antes de guardar un pedido nuevo.',
    },
  'Spreadsheet guide sections': {
    zh: '表格指南章节',
    es: 'Secciones de la guía de Excel',
  },
  'Start here': { zh: '从这里开始', es: 'Primeros pasos' },
  'Import markers': { zh: '导入标记', es: 'Marcadores de importación' },
  'Review rules': { zh: '审核规则', es: 'Reglas de revisión' },
  'Copy import marker': {
    zh: '复制导入标记',
    es: 'Copiar marcador de importación',
  },
  'Copy filename example': {
    zh: '复制文件名示例',
    es: 'Copiar nombre de archivo',
  },
  'Name the file': { zh: '命名文件', es: 'Nombra el archivo' },
  'A numeric filename identifies a store number. A company-name filename identifies a factory without a store number. Windows copy suffixes do not change the store identity. Each import creates a new order.':
    {
      zh: '纯数字文件名代表门店号；公司名称文件名代表没有门店号的工厂。Windows 复制文件时添加的后缀不会改变门店身份。每次导入均创建新订单。',
      es: 'Un nombre numérico identifica el número de tienda. Un nombre de empresa identifica una fábrica sin número de tienda. Los sufijos de copia de Windows no cambian la tienda. Cada importación crea un pedido nuevo.',
    },
  'Same store · new orders': {
    zh: '同一门店 · 新订单',
    es: 'Misma tienda · pedidos nuevos',
  },
  'Same factory · new orders': {
    zh: '同一工厂 · 新订单',
    es: 'Misma fábrica · pedidos nuevos',
  },
  'Mark a copy of the workbook': {
    zh: '在工作簿副本中添加标记',
    es: 'Marca una copia del libro',
  },
  'Keep the seller’s original file. Add a row of import markers above the seller’s column headers. Only marked columns are included; their position does not matter.':
    {
      zh: '保留卖家的原文件，在卖家列标题上方添加一行导入标记。仅导入已标记的列；列的位置不限。',
      es: 'Conserva el archivo original del vendedor. Añade una fila de marcadores sobre sus encabezados. Solo se incluyen las columnas marcadas; su posición no importa.',
    },
  'Copy markers from the next tab. Repeat desc for every description column to combine.':
    {
      zh: '从下一个标签页复制标记。在需要合并的每个描述列中重复填写 desc。',
      es: 'Copia los marcadores de la siguiente pestaña. Repite desc en cada columna de descripción que quieras combinar.',
    },
  'Give each imported row a group value. Matching group values can appear anywhere in the sheet.':
    {
      zh: '为每个需要导入的行填写 group 值。相同 group 值可以分散在工作表中的不同位置。',
      es: 'Asigna un valor group a cada fila que quieras importar. Los valores iguales pueden aparecer en cualquier parte de la hoja.',
    },
  'Mark the order total with total on both sides. Review the workbook, choose Review codes, edit the proposals, then choose Import and assign codes.':
    {
      zh: '在订单总金额两侧各填写 total。核对工作簿后选择“审核编码”，编辑方案，再选择“导入并分配编码”。',
      es: 'Pon total a ambos lados del importe total. Revisa el libro, elige Revisar códigos, edita las propuestas y selecciona Importar y asignar códigos.',
    },
  'Click a marker to copy its exact spelling. Markers stay the same in every language.':
    {
      zh: '点击标记可复制准确拼写。所有语言均使用相同的标记。',
      es: 'Haz clic en un marcador para copiarlo exactamente. Los marcadores son iguales en todos los idiomas.',
    },
  Marker: { zh: '标记', es: 'Marcador' },
  'Meaning and requirement': {
    zh: '含义与要求',
    es: 'Significado y requisito',
  },
  'Product photos': { zh: '商品照片', es: 'Fotos del producto' },
  'Required for every imported product.': {
    zh: '每个导入商品均须提供。',
    es: 'Obligatorio para cada producto importado.',
  },
  'Product group': { zh: '商品组', es: 'Grupo de productos' },
  'Required. Equal values share one product base, even across separated rows or different titles. A blank skips the row.':
    {
      zh: '必填。相同值共用一个商品基础货号，即使行不相邻或标题不同。留空则跳过该行。',
      es: 'Obligatorio. Los valores iguales comparten una base de producto, aunque las filas estén separadas o tengan títulos distintos. Una celda vacía omite la fila.',
    },
  Cartons: { zh: '箱数', es: 'Cajas' },
  'Required. Number of cartons for this row.': {
    zh: '必填。该行商品的箱数。',
    es: 'Obligatorio. Número de cajas de esta fila.',
  },
  'Provide perbox, qty, or both. Units inside one carton.': {
    zh: 'perbox 和 qty 至少填写一项。一个箱内的商品件数。',
    es: 'Indica perbox, qty o ambos. Unidades dentro de una caja.',
  },
  'Total quantity': { zh: '总数量', es: 'Cantidad total' },
  'Provide perbox, qty, or both. Units across all cartons.': {
    zh: 'perbox 和 qty 至少填写一项。全部箱子中的商品总件数。',
    es: 'Indica perbox, qty o ambos. Unidades de todas las cajas.',
  },
  'Unit price': { zh: '单价', es: 'Precio unitario' },
  'Required. Price of one unit in yuan.': {
    zh: '必填。单件商品的人民币价格。',
    es: 'Obligatorio. Precio de una unidad en yuanes.',
  },
  'Product amount': { zh: '商品金额', es: 'Importe del producto' },
  'Optional. Must equal unit price × total quantity.': {
    zh: '选填。必须等于单价 × 总数量。',
    es: 'Opcional. Debe ser igual al precio unitario × cantidad total.',
  },
  'Seller description': { zh: '卖家描述', es: 'Descripción del vendedor' },
  'Optional. Repeat for all descriptions; colors, sizes and materials are recognized even without seller headers.':
    {
      zh: '选填。在所有描述列重复填写；即使没有卖家表头，也可识别颜色、尺寸和材质。',
      es: 'Opcional. Repítelo en todas las descripciones; se reconocen colores, medidas y materiales incluso sin encabezados del vendedor.',
    },
  'Variant or size': { zh: '款式或尺寸', es: 'Variante o talla' },
  'Optional. Combined variants require a reviewed quantity split.': {
    zh: '选填。合并款式的数量必须经审核后拆分。',
    es: 'Opcional. Las variantes combinadas requieren revisar el reparto de cantidades.',
  },
  'Carton weight': { zh: '每箱重量', es: 'Peso por caja' },
  'Optional. Kilograms per carton, never the row total.': {
    zh: '选填。每箱千克数，不是该行的总重量。',
    es: 'Opcional. Kilogramos por caja, nunca el total de la fila.',
  },
  'Carton volume': { zh: '每箱体积', es: 'Volumen por caja' },
  'Optional. Cubic metres per carton, never the row total.': {
    zh: '选填。每箱立方米数，不是该行的总体积。',
    es: 'Opcional. Metros cúbicos por caja, nunca el total de la fila.',
  },
  'Carton dimensions': { zh: '纸箱尺寸', es: 'Medidas de la caja' },
  'Optional. Length, width and height in centimetres; all three take priority over cbm.':
    {
      zh: '选填。以厘米填写长、宽、高；三项齐全时优先用于计算体积，保留 cbm 原值。',
      es: 'Opcional. Largo, ancho y alto en centímetros; las tres medidas tienen prioridad sobre cbm.',
    },
  'Order total': { zh: '订单总金额', es: 'Total del pedido' },
  'Required twice, on either side of the seller’s whole-order total.': {
    zh: '必填两次，分别位于卖家订单总金额的左右两侧。',
    es: 'Obligatorio dos veces, a cada lado del importe total indicado por el vendedor.',
  },
  'Check quantities and prices': {
    zh: '核对数量与价格',
    es: 'Comprueba cantidades y precios',
  },
  'When both quantities are supplied, boxes × perbox must equal qty. Each product amount must equal unit price × total quantity, and the sum must match the total between the two total markers. Mismatches must pause import and identify the affected cells; values are never silently corrected.':
    {
      zh: '两种数量都提供时，boxes × perbox 必须等于 qty。商品金额必须等于单价 × 总数量，各商品金额之和须与两个 total 之间的总金额一致。不一致时必须暂停导入并指出具体单元格，不会自动更正数据。',
      es: 'Si se indican ambas cantidades, boxes × perbox debe ser igual a qty. Cada importe debe ser precio unitario × cantidad total y la suma debe coincidir con el total entre los dos total. Las diferencias deben detener la importación e identificar las celdas afectadas; nunca se corrigen valores en silencio.',
    },
  'Read numbers without their units': {
    zh: '读取数字并识别单位',
    es: 'Lee los números sin sus unidades',
  },
  'Values such as 6元, 8RMB, 20.5 K.G. and 0.14 CBM describe numbers with units. Ambiguous values must be reviewed instead of guessed. Weight and volume always describe one carton.':
    {
      zh: '6元、8RMB、20.5 K.G.、0.14 CBM 等写法包含数字与单位。含义不明确的值必须审核，不得猜测。重量和体积均指单箱数据。',
      es: 'Valores como 6元, 8RMB, 20.5 K.G. y 0.14 CBM contienen números y unidades. Los valores ambiguos deben revisarse, sin adivinarlos. El peso y el volumen siempre corresponden a una caja.',
    },
  'Keep combined variants together until review': {
    zh: '合并款式须先审核再拆分',
    es: 'Revisa antes de separar variantes combinadas',
  },
  'Review photos before importing': {
    zh: '导入前审核照片',
    es: 'Revisa las fotos antes de importar',
  },
  'Every imported product needs a photo. Missing or uncertain row links must pause import. Shared group photos and multiple photos require review. Square thumbnails must fit without stretching, and any later photo adjustment must retain the original.':
    {
      zh: '每个导入商品均须有照片。照片缺失或所属行不明确时必须暂停导入。同组共用图片及多张图片均须审核。方形缩略图须保持原图比例，不得拉伸；后续调整也必须保留原图。',
      es: 'Cada producto importado necesita una foto. Las fotos ausentes o sin una fila clara deben detener la importación. Las fotos compartidas y las múltiples requieren revisión. Las miniaturas cuadradas deben encajar sin deformarse y cualquier ajuste posterior debe conservar el original.',
    },
  'Keep packing exceptions explicit': {
    zh: '明确记录装箱例外',
    es: 'Registra las excepciones de empaque',
  },
  'Keep the ordered quantity separate from the actual carton allocation. Do not turn loose units into fractional cartons or silently combine them with another group. Mixed cartons and unequal carton contents need a reviewed physical packing record. Additional order charges must be entered separately and explained.':
    {
      zh: '订购数量与实际装箱分配需分别记录。不得将零散件自动折算为小数箱数，或擅自与其他商品组合箱。混装箱和不同装箱数量需经过审核并记录实际装箱明细。订单附加费用必须单独填写并注明原因。',
      es: 'Registra por separado la cantidad pedida y la distribución real en cajas. No conviertas unidades sueltas en fracciones de caja ni las mezcles con otro grupo sin avisar. Las cajas mixtas y los contenidos desiguales necesitan un registro físico revisado. Los cargos adicionales del pedido deben anotarse y explicarse por separado.',
    },
  'Keep carton measurements separate': {
    zh: '分别填写纸箱尺寸与体积',
    es: 'Separa las medidas de la caja',
  },
  'cbm is a decimal volume in cubic metres, not text such as 58*35*47. Put centimetre dimensions in cbmx, cbmy and cbmz. Their volume is length × width × height ÷ 1,000,000 per carton; it takes priority over the supplied decimal volume.':
    {
      zh: 'cbm 为以立方米表示的小数体积，不是 58*35*47 等尺寸文本。厘米尺寸请分别填入 cbmx、cbmy、cbmz。每箱体积按长 × 宽 × 高 ÷ 1,000,000 计算，并优先于卖家填写的小数体积。',
      es: 'cbm es un volumen decimal en metros cúbicos, no texto como 58*35*47. Pon las medidas en centímetros en cbmx, cbmy y cbmz. El volumen por caja es largo × ancho × alto ÷ 1,000,000 y tiene prioridad sobre el volumen decimal indicado.',
    },
  'Confirm the purchase date': {
    zh: '确认购买日期',
    es: 'Confirma la fecha de compra',
  },
  'Review must require a confirmed purchase date when the workbook has no reliable date. The filename identifies the store, not the purchase date.':
    {
      zh: '工作簿中没有可靠日期时，审核必须要求确认购买日期。文件名用于识别门店，不代表购买日期。',
      es: 'La revisión debe exigir una fecha de compra confirmada cuando el libro no tenga una fecha fiable. El nombre del archivo identifica la tienda, no la fecha de compra.',
    },
  'Review the workbook, then review and assign its product codes.': {
    es: 'Revisa el libro y después revisa y asigna sus códigos de producto.',
    zh: '先核对工作簿，再审核并分配商品编码。',
  },
  'Resolve the source size or choose No size difference.': {
    es: 'Resuelve la talla de origen o elige Sin diferencia de talla.',
    zh: '请明确来源尺寸，或选择“无尺寸差异”。',
  },
  'Enter a base code or generate the suggested codes.': {
    es: 'Introduce un código base o genera los códigos sugeridos.',
    zh: '请输入基础编码，或生成建议编码。',
  },
  'The code review must belong to this new spreadsheet purchase.': {
    es: 'La revisión de códigos debe corresponder a esta nueva compra del libro.',
    zh: '编码审核必须对应本次新增的工作簿采购。',
  },
  'Keep the source spreadsheet groups and variants together.': {
    es: 'Conserva la agrupación de productos y variantes del libro de origen.',
    zh: '请保留来源工作簿中的商品分组和款式归属。',
  },
  ' · Reserved by shipment history': {
    es: ' · Reservado por el historial de envíos',
    zh: ' · 已由出货历史保留',
  },
  'Finish editing the code field to check its format.': {
    es: 'Termina de editar el campo del código para comprobar su formato.',
    zh: '完成编码字段的编辑后再检查格式。',
  },
  Back: { es: 'Volver', zh: '返回' },
  'Review codes': { es: 'Revisar códigos', zh: '审核编码' },
  'Import and assign codes': {
    es: 'Importar y asignar códigos',
    zh: '导入并分配编码',
  },
  'Reset to suggested': { es: 'Restablecer sugerencias', zh: '重置为建议编码' },
  'Review product codes': {
    es: 'Revisar códigos de producto',
    zh: '审核商品编码',
  },
  'Proposed product codes': {
    es: 'Códigos de producto propuestos',
    zh: '建议商品编码',
  },
  'Product base code': { es: 'Código base del producto', zh: '商品基础编码' },
  'Complete barcode': { es: 'Código de barras completo', zh: '完整条码' },
  'Each group shares one product base code. Variant and size endings form the complete barcode. Review does not reserve codes.':
    {
      es: 'Cada grupo comparte un código base. Las terminaciones de variante y talla forman el código de barras completo. La revisión no reserva códigos.',
      zh: '同一组共用一个商品基础编码。款式和尺寸后缀组成完整条码。审核时不会预占编码。',
    },
  'CE + purchase year/month + supplier number + product number + variant/size endings. New codes must use the confirmed purchase month.':
    {
      es: 'CE + año/mes de compra + número de proveedor + número de producto + terminaciones de variante/talla. Los códigos nuevos deben usar el mes de compra confirmado.',
      zh: 'CE + 采购年月 + 供应商编号 + 商品编号 + 款式/尺寸后缀。新编码必须使用已确认的采购月份。',
    },
  ' · Owner: order {0}, product {1}': {
    es: ' · Asignado a: pedido {0}, producto {1}',
    zh: ' · 所属订单 {0}，商品 {1}',
  },
  'Checking proposed codes…': {
    es: 'Comprobando los códigos propuestos…',
    zh: '正在检查建议编码…',
  },
  'All proposed codes are valid. Nothing is saved until you import.': {
    es: 'Todos los códigos propuestos son válidos. No se guarda nada hasta que importes.',
    zh: '所有建议编码均有效。点击导入前不会保存任何数据。',
  },
  'Resolve these code issues before importing.': {
    es: 'Resuelve estos problemas de códigos antes de importar.',
    zh: '请先解决以下编码问题，再导入。',
  },
  'Row {row}: {quantity} pcs × ¥{price}': {
    es: 'Fila {row}: {quantity} unidades × ¥{price}',
    zh: '第 {row} 行：{quantity} 件 × ¥{price}',
  },
  'Source cells {0}': { es: 'Celdas de origen {0}', zh: '来源单元格 {0}' },
  'Saving the reviewed order and codes…': {
    es: 'Guardando el pedido y los códigos revisados…',
    zh: '正在保存已审核的订单和编码…',
  },
  'Review the proposed codes before importing.': {
    es: 'Revisa los códigos propuestos antes de importar.',
    zh: '请在导入前审核建议编码。',
  },
  'Preparing proposed product codes…': {
    es: 'Preparando los códigos de producto propuestos…',
    zh: '正在生成建议商品编码…',
  },
  'Workbook details changed. Review the regenerated codes.': {
    es: 'Los datos del libro cambiaron. Revisa los códigos generados de nuevo.',
    zh: '工作簿信息已更改。请审核重新生成的编码。',
  },
  'Review products and codes': {
    es: 'Revisar productos y códigos',
    zh: '审核商品与编码',
  },
  'Spanish: {name} · Chinese category: {category} · Material: {material}{custom}':
    {
      es: 'Español: {name} · Categoría china: {category} · Material: {material}{custom}',
      zh: '西语名称：{name} · 中文类别：{category} · 材质：{material}{custom}',
    },
  'Mixed values': { es: 'Valores diferentes', zh: '多个不同值' },
  'Mixed materials': { es: 'Materiales diferentes', zh: '多种材质' },
  ' · Custom values: {0}': {
    es: ' · Valores personalizados: {0}',
    zh: ' · 自定义值：{0}',
  },
  'Workbook declaration {cell}: {value}': {
    es: 'Declaración del libro {cell}: {value}',
    zh: '工作簿声明 {cell}：{value}',
  },
  'No var declaration; description-based suggestions apply.': {
    es: 'Sin declaración var; se usan sugerencias de las descripciones.',
    zh: '未填写 var，将根据描述提供建议。',
  },
  'Size ending: None declared': {
    es: 'Terminación de talla: ninguna declarada',
    zh: '尺寸后缀：未声明',
  },
  'Needs size review': { es: 'Revisar talla', zh: '需要审核尺寸' },
  'Resolve the source size or choose Do not add size endings.': {
    es: 'Resuelve la talla de origen o elige No añadir terminaciones de talla.',
    zh: '请确认原始尺寸，或选择“不添加尺寸后缀”。',
  },
  'Code endings follow the workbook declaration.': {
    es: 'Las terminaciones siguen la declaración del libro.',
    zh: '编码后缀遵循工作簿声明。',
  },
  'Custom code endings differ from the workbook declaration.': {
    es: 'Las terminaciones personalizadas difieren de la declaración del libro.',
    zh: '自定义编码后缀与工作簿声明不同。',
  },
  'Code endings are suggested from source descriptions or edited manually.': {
    es: 'Las terminaciones se sugieren a partir de las descripciones o se editan manualmente.',
    zh: '编码后缀根据原始描述建议或手动编辑。',
  },
  'Do not add size endings': {
    es: 'No añadir terminaciones de talla',
    zh: '不添加尺寸后缀',
  },
  'Suggest size endings from descriptions': {
    es: 'Sugerir terminaciones de talla desde las descripciones',
    zh: '根据描述建议尺寸后缀',
  },
  'Remove only the size endings from these barcodes. Keep variant letters, physical measurements, source descriptions and other products unchanged.':
    {
      es: 'Quita solo las terminaciones de talla de estos códigos. Conserva las letras de variante, medidas físicas, descripciones y otros productos.',
      zh: '仅移除这些条码的尺寸后缀。保留款式字母、实际尺寸、原始描述及其他商品。',
    },
  'Review size endings suggested from the descriptions. Applying them is an explicit code edit; workbook declarations and physical measurements remain unchanged.':
    {
      es: 'Revisa las terminaciones de talla sugeridas desde las descripciones. Aplicarlas es una edición explícita del código; las declaraciones y medidas físicas se conservan.',
      zh: '审核根据描述建议的尺寸后缀。应用后属于明确的编码编辑；工作簿声明和实际尺寸保持不变。',
    },
  'This import review is no longer available.': {
    es: 'Esta revisión de importación ya no está disponible.',
    zh: '此导入审核已不可用。',
  },
}
