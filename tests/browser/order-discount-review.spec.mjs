import { test, expect } from './extension-fixture.mjs'
import { buildOrderFixture } from '../fixtures/order-fixture.mjs'
import { buildDiscountReviewFixture } from '../fixtures/discount-review-fixture.mjs'

const orderId = '9990000000000000042'
const orderUrl = `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${orderId}`

async function fixture(extension, options = {}) {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  await page.addScriptTag({
    content: `${buildOrderFixture.toString()}\n${buildDiscountReviewFixture.toString()}\nwindow.discountFixture = buildDiscountReviewFixture(document, '${orderId}', ${JSON.stringify({ rowCount: options.interpretationAlternatives ? 1 : (options.rowCount ?? 15) })});`,
  })
  await page.evaluate(
    async ({
      orderUrl,
      language = 'en',
      hold = false,
      holdRead = false,
      fail = false,
      suggested = true,
      unambiguousMessage,
      interpretationAlternatives = false,
    }) => {
      const { reviewOrderSnapshot, confirmOrderReconciliation } =
        await import('/src/order-snapshot.js')
      const { openOrderDiscountReview } =
        await import('/src/order-discount-review.js')
      const { setLanguage } = await import('/src/i18n.js')
      if (interpretationAlternatives) {
        const { deepQuery } = await import('/src/dom.js')
        const fixture = window.discountFixture
        deepQuery(fixture.cells[0].pay.root).one('.pay > div').textContent =
          '2.00 元/件'
        deepQuery(fixture.cells[0].number.root).one(
          '.order-table-number'
        ).textContent = '50'
        deepQuery(fixture.cells[0].discount.root).one('span').textContent =
          '优惠共20.00元'
        fixture.fields['原价总计'].textContent = '¥120.00'
        fixture.fields['运费'].textContent = '¥0.00'
        fixture.fields['商品改价'].textContent = '¥10.00'
        fixture.fields['PLUS价优惠'].parentNode.querySelector(
          'dt'
        ).textContent = '批发优惠'
        fixture.fields['PLUS价优惠'].textContent = '减 ¥20.00'
        fixture.fields['店铺优惠'].textContent = '减 ¥20.00'
        fixture.fields['红包'].textContent = '减 ¥0.00'
        fixture.total.shadowRoot
          .querySelector('.detail-price')
          .insertAdjacentHTML(
            'beforeend',
            '<dl><dt>定制服务</dt><dd>¥20.00</dd></dl>'
          )
        fixture.total.shadowRoot.querySelector('.total-discount').textContent =
          '40.00'
        fixture.payable.textContent = '¥90.00'
      }
      setLanguage('en', { persist: false })
      const harness = (window.discountHarness = {
        reads: 0,
        writes: 0,
        hold,
        holdRead,
        fail,
      })
      const openerHost = document.createElement('div')
      openerHost.dataset.discountTestOpener = ''
      const opener = document.createElement('button')
      opener.textContent = 'Synthetic review opener'
      openerHost.attachShadow({ mode: 'open' }).append(opener)
      document.body.append(openerHost)
      opener.focus()
      harness.launch = () => {
        harness.lifetime = new AbortController()
        const { review } = reviewOrderSnapshot(document, orderUrl)
        if (!suggested) delete review.suggestedChoice
        harness.done = openOrderDiscountReview({
          document,
          review,
          language,
          signal: harness.lifetime.signal,
          ...(unambiguousMessage ? { unambiguousMessage } : {}),
          async readReview() {
            harness.reads++
            if (harness.holdRead)
              await new Promise((resolve) => {
                harness.releaseRead = resolve
              })
            return reviewOrderSnapshot(document, orderUrl)
          },
          async onConfirm(fresh, choice) {
            harness.writes++
            if (harness.hold)
              await new Promise((resolve) => {
                harness.release = resolve
              })
            if (harness.fail) throw new Error('Synthetic save failed')
            harness.saved = confirmOrderReconciliation(fresh, {
              choice,
              evidenceKey: fresh.evidenceKey,
            })
          },
        })
      }
      harness.launch()
    },
    { orderUrl, ...options }
  )
  return page
}

test('review shows the full source arithmetic and Cancel or Escape saves nothing', async ({
  extension,
}) => {
  const page = await fixture(extension)
  const dialog = page.getByRole('dialog', {
    name: 'Review discounts',
    exact: true,
  })
  await expect(dialog).toContainText('¥6210.00')
  await expect(dialog).toContainText('¥310.50')
  await expect(dialog).toContainText('¥5.00')
  await expect(dialog).toContainText('Payable remains ¥5960.00')
  await expect(dialog.locator('[data-discount-choice]')).toHaveCount(2)
  await expect(dialog.locator('tbody tr')).toHaveCount(15)
  await expect(
    dialog.getByRole('button', { name: 'Cancel', exact: true })
  ).toBeFocused()
  expect(await page.evaluate(() => discountHarness.writes)).toBe(0)
  await dialog.locator('[data-action="cancel-discount-review"]').click()
  expect(await page.evaluate(() => discountHarness.done)).toBe(false)
  await expect(page.locator('[data-discount-test-opener] button')).toBeFocused()
  expect(await page.evaluate(() => discountHarness.writes)).toBe(0)
  await page.evaluate(() => discountHarness.launch())
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => discountHarness.done)).toBe(false)
  expect(await page.evaluate(() => discountHarness.writes)).toBe(0)
})

test('the suggested separate seller reduction still requires confirmation and saves exact product allocations', async ({
  extension,
}) => {
  const page = await fixture(extension)
  const dialog = page.getByRole('dialog', {
    name: 'Review discounts',
    exact: true,
  })
  await expect(dialog.locator('[data-discount-choice]').first()).toBeChecked()
  await expect(dialog).toContainText('confirmation is still required')
  expect(await page.evaluate(() => discountHarness.saved)).toBeUndefined()
  await dialog.locator('[data-action="confirm-discount-review"]').click()
  expect(await page.evaluate(() => discountHarness.done)).toBe(true)
  const saved = await page.evaluate(() => discountHarness.saved)
  expect(saved.items).toHaveLength(15)
  expect(saved.totals).toMatchObject({
    goodsGross: '6210.00',
    sourceDiscount: '315.50',
    orderAdjustment: '4.50',
    goodsNet: '5890.00',
    shipping: '100.00',
    redPacketDiscount: '30.00',
    payable: '5960.00',
  })
  expect(saved.totals.rowIncludedAdjustment).toBeUndefined()
  expect(saved.totals.orderDiscount).toBeUndefined()
  expect(
    saved.items.reduce(
      (sum, item) => sum + Math.round(Number(item.allocatedDiscount) * 100),
      0
    )
  ).toBe(450)
  expect(saved.reconciliationReview.choice).toContain(
    'seller-reduction-additional'
  )
})

test('the alternative treatment retains row discounts and identifies the remaining order-level reduction', async ({
  extension,
}) => {
  const page = await fixture(extension)
  const dialog = page.getByRole('dialog', {
    name: 'Review discounts',
    exact: true,
  })
  await dialog.locator('[data-discount-choice]').last().check()
  await dialog.locator('[data-action="confirm-discount-review"]').click()
  expect(await page.evaluate(() => discountHarness.done)).toBe(true)
  const saved = await page.evaluate(() => discountHarness.saved)
  expect(saved.totals).toMatchObject({
    rowIncludedAdjustment: '4.50',
    orderDiscount: '4.50',
    goodsNet: '5890.00',
    payable: '5960.00',
  })
  expect(saved.items.every((item) => item.allocatedDiscount === '0.00')).toBe(
    true
  )
  expect(saved.reconciliationReview.choice).toContain(
    'seller-reduction-in-rows'
  )
})

test('changed financial evidence replaces the draft and requires a second confirmation', async ({
  extension,
}) => {
  const page = await fixture(extension)
  const dialog = page.getByRole('dialog', {
    name: 'Review discounts',
    exact: true,
  })
  await page.evaluate(() => discountFixture.setAmounts({ adjustment: '3.50' }))
  await dialog.locator('[data-action="confirm-discount-review"]').click()
  await expect(dialog.getByRole('status')).toHaveText(
    'The order amounts changed. Review the updated choices and confirm again.'
  )
  await expect(dialog.getByRole('status')).toBeFocused()
  await expect(dialog).toContainText('Payable remains ¥5961.00')
  expect(await page.evaluate(() => discountHarness.writes)).toBe(0)
  await dialog.locator('[data-action="confirm-discount-review"]').click()
  expect(await page.evaluate(() => discountHarness.done)).toBe(true)
  expect(
    await page.evaluate(() => discountHarness.saved.totals.orderAdjustment)
  ).toBe('3.50')
})

test('a pending save prevents duplicate submission or dismissal, and failed saving retains the selected treatment for retry', async ({
  extension,
}) => {
  const page = await fixture(extension, { hold: true, fail: true })
  const dialog = page.getByRole('dialog', {
    name: 'Review discounts',
    exact: true,
  })
  await dialog.locator('[data-discount-choice]').last().check()
  await dialog.locator('[data-action="confirm-discount-review"]').click()
  await expect(dialog).toHaveAttribute('aria-busy', 'true')
  await expect(
    dialog.locator('[data-action="cancel-discount-review"]')
  ).toBeDisabled()
  await expect(dialog.locator('[data-discount-choice]').last()).toBeDisabled()
  await dialog
    .locator('[data-action="confirm-discount-review"]')
    .evaluate((button) => button.click())
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  expect(await page.evaluate(() => discountHarness.writes)).toBe(1)
  await page.evaluate(() => discountHarness.release())
  await expect(dialog.getByRole('status')).toHaveText('Synthetic save failed')
  await expect(dialog.getByRole('status')).toBeFocused()
  await expect(dialog.locator('[data-discount-choice]').last()).toBeChecked()
  await page.evaluate(() => {
    discountHarness.hold = false
    discountHarness.fail = false
  })
  await dialog.locator('[data-action="confirm-discount-review"]').click()
  expect(await page.evaluate(() => discountHarness.done)).toBe(true)
  expect(await page.evaluate(() => discountHarness.writes)).toBe(2)
})

test('a changed order that becomes unambiguous cannot save the old choice', async ({
  extension,
}) => {
  const page = await fixture(extension)
  const dialog = page.getByRole('dialog', {
    name: 'Review discounts',
    exact: true,
  })
  await page.evaluate(() => discountFixture.setAmounts({ adjustment: '0.00' }))
  await dialog.locator('[data-action="confirm-discount-review"]').click()
  await expect(dialog.getByRole('status')).toHaveText(
    'This order no longer needs discount review. Cancel and save the order again.'
  )
  await expect(
    dialog.locator('[data-action="confirm-discount-review"]')
  ).toBeDisabled()
  expect(await page.evaluate(() => discountHarness.writes)).toBe(0)
  await dialog.locator('[data-action="cancel-discount-review"]').click()
  expect(await page.evaluate(() => discountHarness.done)).toBe(false)
})

test('wholesale and customization alternatives expose every financial distinction including an unsigned seller increase', async ({
  extension,
}) => {
  const page = await fixture(extension, { interpretationAlternatives: true })
  const dialog = page.getByRole('dialog')
  const radios = dialog.locator('[data-discount-choice]')
  await expect(radios).toHaveCount(3)
  const descriptions = await radios.evaluateAll((inputs) =>
    inputs.map((input) => input.getAttribute('aria-description'))
  )
  expect(new Set(descriptions).size).toBe(3)
  for (const description of descriptions) {
    expect(description).toContain('Wholesale reduction already in row prices')
    expect(description).toContain('Customization included in original total')
    expect(description).toContain('Payable remains ¥90.00')
  }
  for (const choice of await dialog.locator('.choice').all()) {
    await expect(choice).toContainText(
      'Wholesale reduction already in row prices'
    )
    await expect(choice).toContainText(
      'Customization included in original total'
    )
  }
  const increase = dialog.getByRole('radio', {
    name: 'Seller price increase is additional',
    exact: true,
  })
  await increase.check()
  await expect(increase).toHaveAttribute(
    'aria-description',
    /Additional seller increase allocated to products: ¥10.00/
  )
  await expect(increase).toHaveAttribute(
    'aria-description',
    /Wholesale reduction already in row prices: ¥0.00/
  )
  await expect(increase).toHaveAttribute(
    'aria-description',
    /Customization included in original total: ¥20.00/
  )
  await expect(dialog.locator('tbody tr').first()).toContainText('¥-10.00')
  await dialog.locator('[data-action="confirm-discount-review"]').click()
  expect(await page.evaluate(() => discountHarness.done)).toBe(true)
  const saved = await page.evaluate(() => discountHarness.saved)
  expect(saved.totals).toMatchObject({
    orderAdjustment: '-10.00',
    grossIncludedCustomization: '20.00',
    orderDiscount: '20.00',
    payable: '90.00',
  })
  expect(saved.items[0].allocatedDiscount).toBe('-10.00')
})

test('a queued review that becomes unambiguous directs recovery through Activity in every language', async ({
  extension,
}) => {
  const page = await fixture(extension, {
    unambiguousMessage:
      'This order no longer needs discount review. Cancel and resume this import from Activity.',
  })
  const dialog = page.getByRole('dialog')
  await page.evaluate(() => discountFixture.setAmounts({ adjustment: '0.00' }))
  await dialog.locator('[data-action="confirm-discount-review"]').click()
  for (const [language, message] of [
    [
      'en',
      'This order no longer needs discount review. Cancel and resume this import from Activity.',
    ],
    [
      'es',
      'Este pedido ya no necesita revisión de descuentos. Cancela y reanuda esta importación desde Actividad.',
    ],
    ['zh', '此订单不再需要核对优惠。请取消，然后从动态中继续此次导入。'],
  ]) {
    await dialog
      .locator('[data-action="discount-review-language"]')
      .selectOption(language)
    await expect(dialog.getByRole('status')).toHaveText(message)
  }
  await expect(
    dialog.locator('[data-action="confirm-discount-review"]')
  ).toBeDisabled()
  expect(await page.evaluate(() => discountHarness.writes)).toBe(0)
  await dialog.locator('[data-action="cancel-discount-review"]').click()
  expect(await page.evaluate(() => discountHarness.done)).toBe(false)
})

test('a review without a suggestion requires an explicit radio choice', async ({
  extension,
}) => {
  const page = await fixture(extension, { suggested: false })
  const dialog = page.getByRole('dialog', {
    name: 'Review discounts',
    exact: true,
  })
  await dialog.locator('[data-action="confirm-discount-review"]').click()
  await expect(dialog.getByRole('status')).toHaveText(
    'Choose a discount treatment before saving.'
  )
  await expect(dialog.locator('[data-discount-choice]').first()).toBeFocused()
  expect(await page.evaluate(() => discountHarness.reads)).toBe(0)
  expect(await page.evaluate(() => discountHarness.writes)).toBe(0)
})

test('large reviews render bounded rows and keep language switching and controls usable in a narrow window', async ({
  extension,
}) => {
  const page = await fixture(extension, { rowCount: 1000 })
  await page.setViewportSize({ width: 390, height: 650 })
  for (const [language, heading, confirmation] of [
    ['en', 'Review discounts', 'Confirm and save'],
    ['es', 'Revisar descuentos', 'Confirmar y guardar'],
    ['zh', '核对优惠', '确认并保存'],
  ]) {
    const current = page.getByRole('dialog')
    await current
      .locator('[data-action="discount-review-language"]')
      .selectOption(language)
    const dialog = page.getByRole('dialog', { name: heading, exact: true })
    await expect(
      dialog.getByRole('button', { name: confirmation, exact: true })
    ).toBeVisible()
    await expect(dialog.locator('tbody tr')).toHaveCount(40)
    const bounds = await dialog.evaluate((node) => ({
      right: node.getBoundingClientRect().right,
      bottom: node.getBoundingClientRect().bottom,
      overflow: node.scrollWidth > node.clientWidth,
    }))
    expect(bounds.right).toBeLessThanOrEqual(390)
    expect(bounds.bottom).toBeLessThanOrEqual(650)
    expect(bounds.overflow).toBe(false)
  }
  await page
    .getByRole('dialog')
    .locator('[data-action="discount-review-next"]')
    .click()
  await expect(
    page.getByRole('dialog').locator('tbody tr').first().locator('td').first()
  ).toHaveText('41')
  expect(await page.evaluate(() => discountHarness.writes)).toBe(0)
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => discountHarness.done)).toBe(false)
})

test('disposing the source while rereading closes the review without saving or leaving an orphan dialog', async ({
  extension,
}) => {
  const page = await fixture(extension, { holdRead: true })
  const dialog = page.getByRole('dialog', {
    name: 'Review discounts',
    exact: true,
  })
  await dialog.locator('[data-action="confirm-discount-review"]').click()
  await expect(dialog).toHaveAttribute('aria-busy', 'true')
  await page.evaluate(() => {
    discountHarness.lifetime.abort()
    discountHarness.releaseRead()
  })
  expect(await page.evaluate(() => discountHarness.done)).toBe(false)
  expect(await page.evaluate(() => discountHarness.writes)).toBe(0)
  await expect(page.locator('[data-order-discount-review]')).toHaveCount(0)
})
