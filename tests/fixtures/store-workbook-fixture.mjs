import { CFB, utils, write } from 'xlsx'
import { crc32, deflateSync } from 'node:zlib'

export const png = (() => {
  const chunk = (name, content) => {
    const kind = Buffer.from(name),
      header = Buffer.alloc(4),
      crc = Buffer.alloc(4)
    header.writeUInt32BE(content.length)
    crc.writeUInt32BE(crc32(Buffer.concat([kind, content])))
    return Buffer.concat([header, kind, content, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(16, 0)
  header.writeUInt32BE(8, 4)
  header[8] = 8
  header[9] = 2
  const pixels = Buffer.concat(
    Array.from({ length: 8 }, () =>
      Buffer.concat([
        Buffer.from([0]),
        Buffer.from(Array.from({ length: 16 }, () => [30, 100, 180]).flat()),
      ])
    )
  )
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ])
})()

export function workbookFile({
  variants = '',
  amount = 60,
  total = 60,
  name = '4321.xlsx',
  rows,
  photoBytes = png,
  photoSpans = [{ from: 1, to: 2 }],
  additionalSheets = [],
} = {}) {
  const workbook = utils.book_new()
  utils.book_append_sheet(
    workbook,
    utils.aoa_to_sheet(
      rows ?? [
        ['pic', 'desc', 'boxes', 'perbox', 'price', 'amount', 'group', 'var'],
        ['', 'Synthetic import cup', 2, 10, 3, amount, 1, variants],
        [],
        ['total', total, 'total'],
      ]
    ),
    'Products'
  )
  for (const sheet of additionalSheets)
    utils.book_append_sheet(
      workbook,
      utils.aoa_to_sheet(sheet.rows),
      sheet.name
    )
  const archive = CFB.read(
    new Uint8Array(write(workbook, { type: 'array', bookType: 'xlsx' })),
    { type: 'array' }
  )
  const add = (path, value) =>
    CFB.utils.cfb_add(
      archive,
      path,
      typeof value === 'string' ? new TextEncoder().encode(value) : value
    )
  const part =
    archive.FileIndex[
      archive.FullPaths.indexOf('Root Entry/xl/worksheets/sheet1.xml')
    ]
  part.content = new TextEncoder().encode(
    new TextDecoder()
      .decode(part.content)
      .replace('</worksheet>', '<drawing r:id="photos"/></worksheet>')
  )
  part.size = part.content.length
  add(
    'xl/worksheets/_rels/sheet1.xml.rels',
    '<Relationships><Relationship Id="photos" Target="../drawings/drawing1.xml"/></Relationships>'
  )
  add(
    'xl/drawings/drawing1.xml',
    `<xdr:wsDr>${photoSpans.map(({ from, to }) => `<xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:row>${from}</xdr:row></xdr:from><xdr:to><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${to}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:pic><a:blip r:embed="photo1"/></xdr:pic></xdr:twoCellAnchor>`).join('')}</xdr:wsDr>`
  )
  add(
    'xl/drawings/_rels/drawing1.xml.rels',
    '<Relationships><Relationship Id="photo1" Target="../media/photo.png"/></Relationships>'
  )
  add('xl/media/photo.png', photoBytes)
  return {
    name,
    mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(CFB.write(archive, { type: 'array', fileType: 'zip' })),
  }
}
