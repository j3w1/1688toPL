import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { test, expect } from './extension-fixture.mjs'

let styles
test.beforeAll(async () => {
  const result = await build({
    entryPoints: [
      fileURLToPath(new URL('../../src/library.css', import.meta.url)),
    ],
    bundle: true,
    write: false,
  })
  styles = result.outputFiles[0].text
})

async function fixture(
  extension,
  {
    language = 'en',
    kind = 'order',
    hold = false,
    fail = false,
    large = false,
    chain = false,
  } = {}
) {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  await page.addStyleTag({ content: styles })
  await page.evaluate(
    async ({ language, kind, hold, fail, large, chain }) => {
      const { openProductDetailsDialog } =
        await import('/src/product-detail-editor.js')
      const { setLanguage } = await import('/src/i18n.js')
      setLanguage(language)
      const harness = (window.detailsHarness = {
        writes: 0,
        categoryRequests: 0,
      })
      const base = {
        id: 'first',
        baseCode: 'CE26100101',
        title: 'Synthetic group',
        spanishName: 'SUGGESTED',
        category: '建议',
        naming: {
          spanishName: { source: 'automatic', value: 'SUGGESTED' },
          category: { source: 'automatic', value: '建议' },
        },
        variants: [
          {
            id: 'a',
            entryIds: ['1', '2'],
            variantSuffix: 'A',
            sizeSuffix: '',
            material: 'Glass',
            materialSource: 'suggested',
          },
          {
            id: 'b',
            entryIds: ['3'],
            variantSuffix: 'B',
            sizeSuffix: '',
            spanishName: 'CUSTOM',
            material: '',
            materialSource: 'manual',
          },
        ],
      }
      harness.original = {
        accountId: 'local',
        orderId: '1001',
        groups: large
          ? Array.from({ length: 1000 }, (_, index) => ({
              ...structuredClone(base),
              id: `g${index}`,
            }))
          : [base],
      }
      const launch = document.createElement('button')
      launch.textContent = 'Open details'
      launch.id = 'launch'
      launch.addEventListener('click', () => {
        harness.done = openProductDetailsDialog({
          preparation: harness.original,
          scope: { kind, groupId: 'first', variantId: 'a' },
          async onApply(preparation) {
            harness.writes++
            if (hold)
              await new Promise((resolve) => {
                harness.release = resolve
              })
            if (fail) throw new Error('Synthetic preparation revision changed')
            harness.saved = preparation
          },
          onEditGroupCategory(source) {
            harness.categoryRequests++
            if (chain)
              return openProductDetailsDialog({
                preparation: harness.original,
                scope: { kind: 'group', groupId: 'first' },
                opener: source,
                async onApply(preparation) {
                  harness.saved = preparation
                },
              })
          },
        })
        harness.done.then((applied) => {
          harness.applied = applied
        })
      })
      document.body.append(launch)
    },
    { language, kind, hold, fail, large, chain }
  )
  await page.locator('#launch').click()
  return page
}

test('scoped detail selection preserves custom exceptions and Cancel applies nothing', async ({
  extension,
}) => {
  const page = await fixture(extension)
  const dialog = page.getByRole('dialog', { name: 'Edit order details' })
  await expect(dialog).toContainText('1 groups · 2 variants · 3 source rows')
  await expect(
    dialog.getByRole('radio', { name: 'Keep custom values', exact: true })
  ).toBeChecked()
  await expect(dialog.locator('[data-detail-field="material"]')).toBeDisabled()
  await dialog.locator('[data-detail-select="material"]').check()
  await dialog.locator('[data-detail-field="material"]').fill('Ceramic')
  await dialog.locator('[data-detail-select="spanishName"]').check()
  await dialog.locator('[data-detail-field="spanishName"]').fill('Platos')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await page.evaluate(() => detailsHarness.writes)).toBe(0)
  await page.locator('#launch').click()
  await dialog.locator('[data-detail-select="material"]').check()
  await dialog.locator('[data-detail-field="material"]').fill('Ceramic')
  await dialog.locator('[data-detail-select="spanishName"]').check()
  await dialog.locator('[data-detail-field="spanishName"]').fill('Platos')
  await dialog
    .getByRole('button', { name: 'Apply to order', exact: true })
    .click()
  await expect(dialog).toHaveCount(0)
  const result = await page.evaluate(() => detailsHarness.saved.groups[0])
  expect(result.spanishName).toBe('PLATOS')
  expect(result.variants[0].material).toBe('Ceramic')
  expect(result.variants[1].spanishName).toBe('CUSTOM')
  expect(result.variants[1].material).toBe('')
  expect(result.variants[1].materialSource).toBe('manual')
  expect(result.category).toBe('建议')
})

test('Replace all explicitly clears variant exceptions and only authors selected fields', async ({
  extension,
}) => {
  const page = await fixture(extension, { kind: 'group' })
  const dialog = page.getByRole('dialog', { name: 'Edit group details' })
  await dialog.locator('[data-detail-select="spanishName"]').check()
  await dialog.locator('[data-detail-field="spanishName"]').fill('Vasos')
  await dialog
    .getByRole('radio', { name: 'Replace all values', exact: true })
    .check()
  await dialog
    .getByRole('button', { name: 'Apply to group', exact: true })
    .click()
  const result = await page.evaluate(() => detailsHarness.saved.groups[0])
  expect(result.spanishName).toBe('VASOS')
  expect(result.variants[1].spanishName).toBeUndefined()
  expect(result.variants[0].material).toBe('Glass')
  expect(result.variants[1].material).toBe('')
})

test('variant editor discloses shared source identities and routes category editing to its group', async ({
  extension,
}) => {
  const page = await fixture(extension, { kind: 'variant' })
  const dialog = page.getByRole('dialog', { name: 'Edit variant details' })
  await expect(dialog).toContainText('A Spanish-name edit affects all of them.')
  await expect(dialog.locator('[data-detail-field="category"]')).toHaveCount(0)
  await expect(dialog).toContainText(
    'Chinese category is shared by the CE product group.'
  )
  await dialog
    .getByRole('button', { name: 'Edit group category', exact: true })
    .click()
  await expect(dialog).toHaveCount(0)
  expect(await page.evaluate(() => detailsHarness.done)).toBe(false)
  expect(
    await page.evaluate(() => ({
      writes: detailsHarness.writes,
      categoryRequests: detailsHarness.categoryRequests,
      applied: detailsHarness.applied,
    }))
  ).toEqual({ writes: 0, categoryRequests: 1, applied: false })
})

test('failed guarded apply retains the full draft and saving blocks duplicate writes and dismissal', async ({
  extension,
}) => {
  const page = await fixture(extension, { hold: true, fail: true })
  const dialog = page.getByRole('dialog', { name: 'Edit order details' })
  await dialog.locator('[data-detail-select="category"]').check()
  await dialog.locator('[data-detail-field="category"]').fill('盘')
  await dialog
    .getByRole('button', { name: 'Apply to order', exact: true })
    .click()
  await expect(dialog).toHaveAttribute('aria-busy', 'true')
  expect(
    await dialog
      .locator('.product-detail-fields')
      .evaluate((node) => node.disabled)
  ).toBe(true)
  await expect(
    dialog.getByRole('button', { name: 'Cancel', exact: true })
  ).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  expect(await page.evaluate(() => detailsHarness.writes)).toBe(1)
  await page.evaluate(() => detailsHarness.release())
  await expect(dialog.getByRole('status')).toHaveText(
    'Synthetic preparation revision changed'
  )
  await expect(dialog.getByRole('status')).toBeFocused()
  await expect(dialog.locator('[data-detail-field="category"]')).toHaveValue(
    '盘'
  )
  await expect(
    dialog.getByRole('button', { name: 'Apply to order', exact: true })
  ).toBeEnabled()
  expect(
    await page.evaluate(() => detailsHarness.original.groups[0].category)
  ).toBe('建议')
})

test('large scoped reviews stay bounded and narrow dialogs work in English, Spanish and Chinese', async ({
  extension,
}) => {
  for (const [language, name] of [
    ['en', 'Edit order details'],
    ['es', 'Editar detalles del pedido'],
    ['zh', '编辑订单详情'],
  ]) {
    const page = await fixture(extension, { language, large: true })
    await page.setViewportSize({ width: 390, height: 650 })
    const dialog = page.getByRole('dialog', { name, exact: true })
    await expect(dialog.locator('[data-detail-field]')).toHaveCount(3)
    await expect(dialog).toContainText('1000')
    await expect(dialog.getByRole('radio').first()).toBeChecked()
    await dialog.locator('[data-action="apply-product-details"]').click()
    await expect(
      dialog.locator('[data-detail-select="spanishName"]')
    ).toBeFocused()
    const bounds = await dialog.evaluate((node) => ({
      right: node.getBoundingClientRect().right,
      bottom: node.getBoundingClientRect().bottom,
      overflow: node.scrollWidth > node.clientWidth,
    }))
    expect(bounds.right).toBeLessThanOrEqual(390)
    expect(bounds.bottom).toBeLessThanOrEqual(650)
    expect(bounds.overflow).toBe(false)
    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => detailsHarness.writes)).toBe(0)
    await page.close()
  }
})

test('a portalled detail editor inherits its opener language without changing the workspace language', async ({
  extension,
}) => {
  const page = await fixture(extension)
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click()
  expect(await page.evaluate(() => detailsHarness.done)).toBe(false)
  await page.evaluate(async () => {
    const { createLanguageScope } = await import('/src/i18n.js')
    createLanguageScope(document.getElementById('launch'), 'es')
  })
  await page.locator('#launch').click()
  const dialog = page.getByRole('dialog', {
    name: 'Editar detalles del pedido',
    exact: true,
  })
  await expect(dialog).toHaveAttribute('lang', 'es')
  await expect(
    dialog.getByRole('button', { name: 'Aplicar al pedido', exact: true })
  ).toBeVisible()
  expect(
    await page.evaluate(async () =>
      (await import('/src/i18n.js')).getLanguage()
    )
  ).toBe('en')
})

test('a category transition inherits the detached Spanish opener and resolves its caller only after the group editor closes', async ({
  extension,
}) => {
  const page = await fixture(extension, { kind: 'variant', chain: true })
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click()
  expect(await page.evaluate(() => detailsHarness.done)).toBe(false)
  await page.evaluate(async () => {
    const { createLanguageScope } = await import('/src/i18n.js')
    createLanguageScope(document.getElementById('launch'), 'es')
    delete detailsHarness.applied
  })
  await page.locator('#launch').click()
  const variant = page.getByRole('dialog', {
    name: 'Editar detalles de la variante',
    exact: true,
  })
  await variant.locator('[data-action="edit-shared-group-category"]').click()
  const group = page.getByRole('dialog', {
    name: 'Editar detalles del grupo',
    exact: true,
  })
  await expect(group).toHaveAttribute('lang', 'es')
  expect(await page.evaluate(() => detailsHarness.applied)).toBeUndefined()
  await group.locator('[data-detail-select="category"]').check()
  await group.locator('[data-detail-field="category"]').fill('共享品类')
  await group.locator('[data-action="apply-product-details"]').click()
  await expect(group).toHaveCount(0)
  expect(await page.evaluate(() => detailsHarness.done)).toBe(true)
  expect(await page.evaluate(() => detailsHarness.applied)).toBe(true)
  expect(
    await page.evaluate(() => detailsHarness.saved.groups[0].category)
  ).toBe('共享品类')
  expect(
    await page.evaluate(async () =>
      (await import('/src/i18n.js')).getLanguage()
    )
  ).toBe('en')
})
