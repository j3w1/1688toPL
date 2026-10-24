import { test, expect } from './extension-fixture.mjs'

test('a held code reset locks current and newly mounted inputs and cannot be superseded by live validation', async ({
  extension,
}) => {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  await page.evaluate(async () => {
    const { mountStoreImportCodeReview } =
      await import('/src/store-import-code-review.js')
    const style = document.createElement('style')
    style.textContent =
      '.store-import-code-list { height: 320px; overflow: auto; } .store-import-code-group { min-height: 300px; }'
    document.head.append(style)
    const host = document.createElement('fieldset')
    host.id = 'synthetic-code-review'
    document.body.append(host)
    const items = Array.from({ length: 28 }, (_, index) => ({
      entryId: String(index + 1),
      sourceGroup: String(index + 1),
      sourceRow: index + 3,
      description: `Synthetic product ${index + 1}`,
      quantity: '10',
      price: '1.00',
    }))
    const preparation = {
      accountId: 'local',
      orderId: '1001',
      sellerId: 'store:market:1234',
      month: '2026-10',
      revision: 0,
      updatedAt: '2026-10-24T00:00:00Z',
      groups: items.map((item, index) => ({
        id: `group-${item.entryId}`,
        title: item.description,
        baseCode: `CE261001${String(index + 50).padStart(2, '0')}`,
        variants: [
          {
            id: `variant-${item.entryId}`,
            entryIds: [item.entryId],
            variant: 'A',
            size: '',
            variantSuffix: 'A',
            sizeSuffix: '',
            needsSizeMapping: false,
          },
        ],
      })),
    }
    const candidate = {
      snapshot: { accountId: 'local', orderId: '1001', items },
      images: [],
      unitsPerCarton: {},
    }
    window.codeReviewHarness = { calls: [], states: [], candidate }
    const harness = window.codeReviewHarness
    harness.component = mountStoreImportCodeReview(host, {
      review: { candidate, preparation, issues: [] },
      sourceRows: [],
      onValidity(state) {
        harness.states.push(state)
        // The dialog uses the component's public reset state for its inherited lock.
        host.disabled = Boolean(state.resetting)
      },
      repository: {
        async reviewStoreOrderImport(request) {
          harness.calls.push(structuredClone(request))
          const draft = structuredClone(request.preparation)
          if (request.resetCodes) {
            await new Promise((resolve) => {
              harness.releaseReset = resolve
            })
            for (const [index, group] of draft.groups.entries()) {
              group.baseCode = `CE261001${String(index + 1).padStart(2, '0')}`
              group.variants[0].variantSuffix = 'A'
            }
          }
          return {
            candidate: request.candidate,
            preparation: draft,
            issues: [],
          }
        },
      },
    })
    harness.initialIds = preparation.groups.map((group) => [
      group.id,
      group.variants.map((variant) => variant.id),
    ])
  })
  const host = page.locator('#synthetic-code-review'),
    list = host.locator('.store-import-code-list'),
    firstVariant = host.locator(
      '[data-source-group="1"] [data-code-field="variantSuffix"]'
    )
  await firstVariant.fill('Q')
  await expect
    .poll(() => page.evaluate(() => codeReviewHarness.component.valid))
    .toBe(true)
  await page.evaluate(() => {
    codeReviewHarness.resetDone = codeReviewHarness.component.validate({
      resetCodes: true,
    })
  })
  await expect(host).toHaveJSProperty('disabled', true)
  await expect(firstVariant).toBeDisabled()
  expect(
    await firstVariant.evaluate((input) => ({
      ownDisabled: input.disabled,
      nativeDisabled: input.matches(':disabled'),
    }))
  ).toEqual({ ownDisabled: false, nativeDisabled: true })
  expect(
    await page.evaluate(() => codeReviewHarness.states.at(-1))
  ).toMatchObject({ pending: true, resetting: true, valid: false })
  await list.evaluate((node) => {
    node.scrollTop = node.scrollHeight
  })
  const lastVariant = host.locator(
    '[data-source-group="28"] [data-code-field="variantSuffix"]'
  )
  await expect(lastVariant).toBeAttached()
  await expect(lastVariant).toBeDisabled()
  expect(
    await lastVariant.evaluate((input) => ({
      ownDisabled: input.disabled,
      nativeDisabled: input.matches(':disabled'),
    }))
  ).toEqual({ ownDisabled: false, nativeDisabled: true })

  // A pending live-validation request used to revoke the reset's response.
  expect(
    await page.evaluate(() => codeReviewHarness.component.validate())
  ).toBe(false)
  expect(await page.evaluate(() => codeReviewHarness.calls.length)).toBe(2)
  await expect(host).toHaveJSProperty('disabled', true)
  expect(
    await page.evaluate(async () => {
      codeReviewHarness.releaseReset()
      return await codeReviewHarness.resetDone
    })
  ).toBe(true)
  await expect(host).toHaveJSProperty('disabled', false)
  const after = await page.evaluate(() => {
    const harness = codeReviewHarness,
      review = harness.component.review
    return {
      ids: review.preparation.groups.map((group) => [
        group.id,
        group.variants.map((variant) => variant.id),
      ]),
      initialIds: harness.initialIds,
      bases: review.preparation.groups.map((group) => group.baseCode),
      variants: review.preparation.groups.map(
        (group) => group.variants[0].variantSuffix
      ),
      sameCandidate: review.candidate === harness.candidate,
      state: harness.states.at(-1),
    }
  })
  expect(after.ids).toEqual(after.initialIds)
  expect(after.bases).toEqual(
    Array.from(
      { length: 28 },
      (_, index) => `CE261001${String(index + 1).padStart(2, '0')}`
    )
  )
  expect(after.variants).toEqual(Array(28).fill('A'))
  expect(after.sameCandidate).toBe(true)
  expect(after.state).toMatchObject({
    pending: false,
    resetting: false,
    valid: true,
  })
  await list.evaluate((node) => {
    node.scrollTop = 0
  })
  await expect(firstVariant).toBeEnabled()
  await firstVariant.fill('R')
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          codeReviewHarness.component.review.preparation.groups[0].variants[0]
            .variantSuffix
      )
    )
    .toBe('R')
  expect(await page.evaluate(() => codeReviewHarness.calls.length)).toBe(3)
  await page.evaluate(() => codeReviewHarness.component.destroy())
  await page.close()
})
