import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { test, expect } from './extension-fixture.mjs'
import {
  seedSmartOrder,
  openSmartLibrary,
  revealOrderCard,
  createSmartContainer,
} from './smart-workspace-helpers.mjs'

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

test('the library action reviews and deletes an order with confirmed cartons and an unsealed inclusion', async ({
  extension,
}) => {
  const ref = await seedSmartOrder(extension, { physical: true, count: 1 })
  const containerId = await createSmartContainer(extension, [ref])
  const page = await openSmartLibrary(extension)
  const card = await revealOrderCard(page, ref)
  await card.getByRole('checkbox').check()
  await page.locator('#remove-orders').click()
  const dialog = page.getByRole('dialog', {
    name: 'Delete selected orders',
    exact: true,
  })
  await expect(dialog).toContainText('Synthetic container October')
  await expect(
    dialog.getByRole('button', { name: 'Delete', exact: true })
  ).toBeEnabled()
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('#order-count')).toHaveText('0')
  const retained = await extension.inspector.evaluate(
    async ({ ref, containerId }) => {
      const repository = await window.testRepository
      const backup = await repository.exportBackup()
      return {
        orders: backup.orders,
        batches: backup.cartonBatches,
        container: backup.containers.find(
          (container) => container.id === containerId
        ),
      }
    },
    { ref, containerId }
  )
  expect(retained.orders).toEqual([])
  expect(retained.batches.length).toBeGreaterThan(0)
  expect(retained.batches.every((batch) => Boolean(batch.deletedAt))).toBe(true)
  expect(retained.container.draft.orders).toEqual([])
})

test('background review and removal forward the selected account for identical order IDs', async ({
  extension,
}) => {
  const ref = await seedSmartOrder(extension, { physical: true, count: 1 })
  await extension.inspector.evaluate(async (ref) => {
    const repository = await window.testRepository
    const record = await repository.getOrder(ref.orderId)
    await repository.saveSnapshot({
      ...record.snapshot,
      accountId: 'synthetic-other-account',
    })
  }, ref)
  const review = await extension.inspector.evaluate(
    (orderId) =>
      chrome.runtime.sendMessage({
        type: 'LIBRARY_REVIEW_REMOVAL',
        accountId: 'synthetic-other-account',
        orderIds: [orderId],
      }),
    ref.orderId
  )
  expect(review.ok, review.error).toBe(true)
  expect(review.data.orders.map((order) => order.accountId)).toEqual([
    'synthetic-other-account',
  ])
  expect(review.data.cartonBatchCount).toBe(0)
  const result = await extension.inspector.evaluate(
    (orderId) =>
      chrome.runtime.sendMessage({
        type: 'LIBRARY_REMOVE',
        accountId: 'synthetic-other-account',
        orderIds: [orderId],
      }),
    ref.orderId
  )
  expect(result.ok, result.error).toBe(true)
  const state = await extension.inspector.evaluate(async (orderId) => {
    const repository = await window.testRepository
    return {
      local: Boolean(await repository.getOrder(orderId)),
      other: Boolean(
        await repository.getOrder(orderId, {
          accountId: 'synthetic-other-account',
        })
      ),
      active: (await repository.listCartonBatches()).length,
    }
  }, ref.orderId)
  expect(state.local).toBe(true)
  expect(state.other).toBe(false)
  expect(state.active).toBeGreaterThan(0)
})

async function fixture(
  extension,
  { language = 'en', hold = false, fail = false, blocked = false } = {}
) {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  await page.addStyleTag({ content: styles })
  await page.evaluate(
    async ({ language, hold, fail, blocked }) => {
      const { openOrderRemovalDialog } =
        await import('/src/order-removal-dialog.js')
      const { setLanguage } = await import('/src/i18n.js')
      setLanguage(language)
      const harness = (window.removalHarness = { reviews: 0, writes: 0 })
      const launch = document.createElement('button')
      launch.id = 'launch'
      launch.textContent = 'Review removal'
      document.body.append(launch)
      launch.onclick = () => {
        harness.done = openOrderRemovalDialog({
          orders: [
            {
              orderId: '1001',
              sellerName: 'Synthetic supplier',
              sourceType: 'spreadsheet',
            },
          ],
          async review() {
            harness.reviews++
            const blockers =
              blocked || (fail && harness.writes)
                ? [
                    {
                      kind: 'sealed',
                      orderId: '1001',
                      containerNames: [
                        'Synthetic October',
                        'Synthetic November',
                      ],
                    },
                  ]
                : []
            return {
              orders: [{ orderId: '1001', accountId: 'local' }],
              cartonBatchCount: 3,
              containers: [
                { id: 'draft-1', name: 'Synthetic draft', orderIds: ['1001'] },
              ],
              blockers,
              canRemove: !blockers.length,
            }
          },
          async remove() {
            harness.writes++
            if (hold)
              await new Promise((resolve) => {
                harness.release = resolve
              })
            if (fail) throw new Error('Synthetic concurrent seal')
          },
        })
        harness.done.then((value) => {
          harness.result = value
        })
      }
    },
    { language, hold, fail, blocked }
  )
  await page.locator('#launch').click()
  return page
}

test('review shows selected orders and related data; Cancel and Escape reserve and remove nothing', async ({
  extension,
}) => {
  const page = await fixture(extension)
  const dialog = page.getByRole('dialog', { name: 'Delete selected orders' })
  await expect(dialog).toContainText('1001')
  await expect(dialog).toContainText('3 carton batches')
  await expect(dialog).toContainText('Synthetic draft')
  await expect(
    dialog.getByRole('button', { name: 'Cancel', exact: true })
  ).toBeFocused()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(await page.evaluate(() => removalHarness.done)).toBe(false)
  expect(
    await page.evaluate(() => ({
      writes: removalHarness.writes,
      result: removalHarness.result,
    }))
  ).toEqual({ writes: 0, result: false })
  await page.locator('#launch').click()
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  expect(await page.evaluate(() => removalHarness.done)).toBe(false)
  expect(await page.evaluate(() => removalHarness.writes)).toBe(0)
})

test('one confirmation holds the dialog and prevents duplicate writes until commit completes', async ({
  extension,
}) => {
  const page = await fixture(extension, { hold: true })
  const dialog = page.getByRole('dialog', { name: 'Delete selected orders' })
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(dialog).toHaveAttribute('aria-busy', 'true')
  await expect(
    dialog.getByRole('button', { name: 'Delete', exact: true })
  ).toBeDisabled()
  await expect(
    dialog.getByRole('button', { name: 'Cancel', exact: true })
  ).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  expect(await page.evaluate(() => removalHarness.writes)).toBe(1)
  await page.evaluate(() => removalHarness.release())
  await expect(dialog).toHaveCount(0)
  expect(await page.evaluate(() => removalHarness.done)).toBe(true)
  expect(await page.evaluate(() => removalHarness.result)).toBe(true)
})

test('a concurrent seal refreshes named blockers inside the open review and retains the selection', async ({
  extension,
}) => {
  const page = await fixture(extension, { fail: true })
  const dialog = page.getByRole('dialog', { name: 'Delete selected orders' })
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(dialog).toContainText('Synthetic October, Synthetic November')
  await expect(dialog).toContainText('Nothing has been deleted.')
  await expect(
    dialog.getByRole('button', { name: 'Delete', exact: true })
  ).toBeDisabled()
  await expect(dialog.getByRole('status')).toBeFocused()
  await expect(dialog.locator('.order-removal-orders')).toContainText('1001')
  expect(
    await page.evaluate(() => ({
      reviews: removalHarness.reviews,
      writes: removalHarness.writes,
    }))
  ).toEqual({ reviews: 2, writes: 1 })
})

test('blocked reviews remain readable in narrow windows in every supported language', async ({
  extension,
}) => {
  for (const [language, name, deletion, sealed] of [
    ['en', 'Delete selected orders', 'Delete', 'sealed containers'],
    [
      'es',
      'Eliminar pedidos seleccionados',
      'Eliminar',
      'contenedores sellados',
    ],
    ['zh', '删除所选订单', '删除', '封存的集装箱'],
  ]) {
    const page = await fixture(extension, { language, blocked: true })
    await page.setViewportSize({ width: 390, height: 650 })
    const dialog = page.getByRole('dialog', { name, exact: true })
    await expect(dialog).toContainText(sealed)
    await expect(dialog).toContainText('Synthetic October, Synthetic November')
    const button = dialog.getByRole('button', { name: deletion, exact: true })
    await expect(button).toBeDisabled()
    const dimensions = await dialog.evaluate((node) => {
      const bounds = node.getBoundingClientRect()
      return {
        width: bounds.width,
        right: bounds.right,
        bottom: bounds.bottom,
        overflow: node.scrollWidth > node.clientWidth,
      }
    })
    expect(dimensions.width).toBeLessThanOrEqual(390)
    expect(dimensions.right).toBeLessThanOrEqual(390)
    expect(dimensions.bottom).toBeLessThanOrEqual(650)
    expect(dimensions.overflow).toBe(false)
    expect(await page.evaluate(() => removalHarness.writes)).toBe(0)
    await page.close()
  }
})
