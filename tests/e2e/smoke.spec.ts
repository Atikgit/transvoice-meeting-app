import { expect, test } from '@playwright/test'

test('dashboard renders the current UI', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('TRANSVOICE', { exact: true })).toBeVisible()
  await expect(page.getByText('Your workspace')).toBeVisible()
  await expect(page.getByText('Translation minutes')).toBeVisible()
})

test('legacy join link opens the join screen with camera preview', async ({ page }) => {
  await page.goto('/?room=room-e2e&view=join')
  await expect(page.getByRole('heading', { name: 'Join Translated Meeting' })).toBeVisible()
  await expect(page.getByText('Camera preview')).toBeVisible()
})
