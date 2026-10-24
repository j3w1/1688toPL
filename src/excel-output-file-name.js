/** The popup language owns the filename; filesystem characters cannot become paths. */
export function excelOutputTitle(language = 'en') {
  return `CE唛头 · ${{ en: 'List', es: 'Lista', zh: '清单' }[language] || 'List'}`
}

export function excelOutputFileName(rows, language = 'en', date = new Date()) {
  const stores = new Map(
    rows.map((row) => [
      String(row.sellerMemberLogin || row.sellerName || '').trim(),
      String(row.sellerName || row.sellerMemberLogin || '').trim(),
    ])
  )
  if (stores.size === 1 && !stores.has('')) {
    const name = [...stores.values()][0]
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
      .replace(/[. ]+$/g, '')
    const safe =
      [...name].reduce(
        (value, character) =>
          value.length + character.length <= 220 ? value + character : value,
        ''
      ) || 'Store'
    return `${safe}_货清单.xlsx`
  }
  const day = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
  return `${day}-${{ en: 'list', es: 'lista', zh: '货清单' }[language] || 'list'}.xlsx`
}
