import { test, expect } from './extension-fixture.mjs'
import { SYNTHETIC_PHOTO } from '../fixtures/container-fixture.mjs'

async function mount(extension, options = {}) {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/fixture.html`)
  await page.evaluate(
    async ({ photo, options }) => {
      const { mountStoreImportUpdateReview } =
        await import('/src/store-import-update-review.js')
      const current = {
          key: 'photo:0:original',
          url: `local-image:${'a'.repeat(64)}`,
          photoIndex: 0,
          edit: { tags: [] },
        },
        workbook = { key: 'photo:0:original', url: current.url, photoIndex: 0 },
        slots = Array.from({ length: options.slots || 1 }, (_, index) => ({
          key: `slot-${index}`,
          current: { ...current, key: `photo:${index}:original` },
          workbook: { ...workbook, photoIndex: index },
          selected: { ...current, key: `photo:${index}:original` },
          action: 'current',
          currentOptions: [current],
          previousOptions: [],
        })),
        row = {
          row: 2,
          group: '1',
          description: 'Synthetic photo comparison',
          photos: [current.url],
          entryIds: ['1'],
          codes: [],
          price: '2.00',
          quantity: '10',
          boxes: '1',
          variants: [],
        },
        review = {
          summary: {
            hasChanges: true,
            priceChanges: 0,
            unchangedPrices: 1,
            before: { total: '20.00' },
            after: { total: '20.00' },
          },
          rowChanges: [
            {
              incomingRow: 2,
              previousRow: 2,
              before: row,
              after: row,
              fields: [],
              status: 'changed',
              priceStatus: 'unchanged',
            },
          ],
          photoChoices: {},
          photoChanges: [
            {
              entryId: '1',
              incomingRow: 2,
              group: '1',
              changed: false,
              customized: true,
              slots,
            },
          ],
          photoSummary: {
            editedKept: slots.length,
            workbookSelected: 0,
            previousSelected: 0,
            pending: 0,
          },
          issues: [],
          sourceCandidate: { images: [] },
        }
      window.requests = 0
      window.photoChoices = []
      if (options.combined) {
        row.entryIds = ['1', '2']
        review.photoChanges.push({
          ...structuredClone(review.photoChanges[0]),
          entryId: '2',
          sourceVariant: 'B',
          sourceSize: 'L',
          productNumber: 'SYN-2',
        })
        Object.assign(review.photoChanges[0], {
          sourceVariant: 'A',
          sourceSize: 'S',
          productNumber: 'SYN-1',
        })
        review.preparation = {
          groups: [
            {
              baseCode: 'CE26100101',
              variants: [
                { entryIds: ['1'], variantSuffix: 'A', sizeSuffix: 'S' },
                { entryIds: ['2'], variantSuffix: 'B', sizeSuffix: 'L' },
              ],
            },
          ],
        }
      }
      if (options.issueSlot !== undefined) {
        review.issues = [
          {
            code: options.issueCode || 'STORE_UPDATE_PHOTO_PAIRING_REQUIRED',
            message:
              'Choose which current photo this workbook photo replaces, or add it as new.',
            severity: 'error',
            entryId: '1',
            incomingRow: 2,
            photoKey: `slot-${options.issueSlot}`,
          },
        ]
        review.photoChanges[0].slots[options.issueSlot].pairingRequired =
          !options.issueCode
        if (options.issueCode)
          review.photoChoices = {
            1: { 'slot-0': { action: 'current', currentPhoto: current.key } },
          }
      }
      window.reviewFixture = review
      const host = document.createElement('div')
      document.body.append(host)
      window.photoView = mountStoreImportUpdateReview(host, {
        review,
        repository: {
          getImage: async () => {
            window.requests++
            if (options.failFirst && window.requests === 1)
              throw new Error('Synthetic preview failure')
            if (options.delayFirst && window.requests === 1)
              return new Promise((resolve) => {
                window.resolveOldPhoto = () => resolve({ dataUrl: photo })
              })
            return { dataUrl: photo }
          },
        },
        onPhotoChoicesChange: (choices) => window.photoChoices.push(choices),
      })
    },
    { photo: SYNTHETIC_PHOTO, options }
  )
  return page
}

test('failed photo preview retries the original image lookup and enlarged preview is read-only and dismissible', async ({
  extension,
}) => {
  const page = await mount(extension, { failFirst: true })
  await expect(
    page.getByRole('button', { name: 'Retry photo preview' }).first()
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Retry photo preview' })
    .first()
    .click()
  await expect(
    page.locator('.store-update-photo-comparisons img').first()
  ).toHaveAttribute('src', /^data:image\//)
  expect(await page.evaluate(() => window.requests)).toBe(2)
  const enlarge = page.getByRole('button', {
    name: 'Enlarge Current edited photo',
    exact: true,
  })
  await enlarge.click()
  const preview = page.locator('.store-update-photo-preview')
  await expect(preview).toBeVisible()
  await expect(preview.locator('img')).toHaveAttribute('src', /^data:image\//)
  await page.keyboard.press('Escape')
  await expect(preview).toHaveCount(0)
  await expect(enlarge).toBeFocused()
  expect(await page.evaluate(() => window.photoChoices)).toEqual([])
})

test('late photo preparation cannot replace a newer review or write a photo choice', async ({
  extension,
}) => {
  const page = await mount(extension, { delayFirst: true })
  await expect
    .poll(() => page.evaluate(() => typeof window.resolveOldPhoto))
    .toBe('function')
  await page.evaluate((photo) => {
    const next = structuredClone(window.reviewFixture)
    for (const slot of next.photoChanges[0].slots) {
      slot.current = {
        ...slot.current,
        url: photo,
        edit: { background: '#ffcc00', tags: [] },
      }
      slot.selected = slot.current
      slot.workbook = { ...slot.workbook, url: photo }
    }
    window.photoView.setReview(next)
  }, SYNTHETIC_PHOTO)
  const current = page
    .locator('.store-update-photo-comparisons figure')
    .filter({ hasText: 'Current edited photo' })
    .locator('img')
  await expect(current).toHaveAttribute('src', /^data:image\//)
  const newer = await current.getAttribute('src')
  await page.evaluate(() => window.resolveOldPhoto())
  await expect(current).toHaveAttribute('src', newer)
  expect(await page.evaluate(() => window.photoChoices)).toEqual([])
})

test('multi-photo comparisons mount only an expanded six-photo page and preserve the page through revalidation', async ({
  extension,
}) => {
  const page = await mount(extension, { slots: 14 })
  await expect(page.locator('.store-update-photo-slot')).toHaveCount(0)
  await page.getByText('Review 14 product photos', { exact: true }).click()
  await expect(page.locator('.store-update-photo-slot')).toHaveCount(6)
  await page.getByRole('button', { name: 'Next photos', exact: true }).click()
  await expect(
    page.getByRole('group', { name: 'Photo 7', exact: true })
  ).toBeVisible()
  await expect(page.locator('.store-update-photo-slot')).toHaveCount(6)
  await page.evaluate(() =>
    window.photoView.setReview(structuredClone(window.reviewFixture))
  )
  await expect(
    page.getByRole('group', { name: 'Photo 7', exact: true })
  ).toBeVisible()
  await page.getByRole('button', { name: 'Next photos', exact: true }).click()
  await expect(page.locator('.store-update-photo-slot')).toHaveCount(2)
  await page
    .getByRole('group', { name: 'Photo 14', exact: true })
    .getByRole('radio', { name: 'Use workbook photo', exact: true })
    .check()
  expect(
    await page.evaluate(() => window.photoChoices[0]['1']['slot-13'].action)
  ).toBe('workbook')
})

test('combined source-row photo choices identify each complete barcode and change only that product draft', async ({
  extension,
}) => {
  const page = await mount(extension, { combined: true }),
    first = page.locator('[data-photo-entry="1"]'),
    second = page.locator('[data-photo-entry="2"]')
  await expect(
    first.getByRole('heading', {
      name: 'Photo choices for CE26100101AS',
      exact: true,
    })
  ).toBeVisible()
  await expect(
    second.getByRole('heading', {
      name: 'Photo choices for CE26100101BL',
      exact: true,
    })
  ).toBeVisible()
  await expect(first).toContainText(
    'Article number: SYN-1 · Variant: A · Size: S'
  )
  await expect(second).toContainText(
    'Article number: SYN-2 · Variant: B · Size: L'
  )
  await page.evaluate(async () => {
    const { setLanguage } = await import('/src/i18n.js')
    setLanguage('zh', { persist: false })
  })
  await expect(second).toContainText('货号: SYN-2 · 款式: B · 尺码: L')
  await page.evaluate(async () => {
    const { setLanguage } = await import('/src/i18n.js')
    setLanguage('en', { persist: false })
  })
  await second
    .getByRole('radio', { name: 'Use workbook photo', exact: true })
    .check()
  const choice = await page.evaluate(() => window.photoChoices[0])
  expect(choice['1']).toBeUndefined()
  expect(choice['2']['slot-0'].action).toBe('workbook')
})

test('photo blocker opens the correct collapsed gallery page and focuses its associated pairing control', async ({
  extension,
}) => {
  const page = await mount(extension, { slots: 14, issueSlot: 13 })
  await expect(page.locator('.store-update-photo-slot')).toHaveCount(0)
  await page.locator('.store-update-issues [data-blocking="true"]').click()
  const last = page.getByRole('group', { name: 'Photo 14', exact: true }),
    pairing = last.getByLabel(
      'Which current photo does this workbook image replace?',
      { exact: true }
    )
  await expect(last).toBeVisible()
  await expect(pairing).toBeFocused()
  await expect(pairing).toHaveAttribute('aria-describedby', /-help$/)
  await expect(page.locator('.store-update-photo-slot')).toHaveCount(2)
  expect(await page.evaluate(() => window.photoChoices)).toEqual([])
})

test('backend photo preparation retry retains the exact reviewed choices', async ({
  extension,
}) => {
  const page = await mount(extension, {
    issueSlot: 0,
    issueCode: 'STORE_UPDATE_PHOTO_RENDER_FAILED',
  })
  await page
    .getByRole('button', { name: 'Retry photo preparation', exact: true })
    .click()
  expect(await page.evaluate(() => window.photoChoices)).toEqual([
    {
      1: { 'slot-0': { action: 'current', currentPhoto: 'photo:0:original' } },
    },
  ])
})
