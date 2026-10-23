import { expect, test } from '@playwright/test'

test('"/" opens the dashboard, which asks signed-out visitors to sign in', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/)
  await expect(page.getByText('TransVoice AI', { exact: true })).toBeAttached()
  await expect(page.getByText('Meet without limits')).toBeVisible()
})

test('meeting lobby and room require sign-in', async ({ page }) => {
  const meeting = '11111111-1111-4111-8111-111111111111'
  await page.goto(`/m/${meeting}/lobby`)
  await expect(page).toHaveURL(new RegExp(`/login\\?next=%2Fm%2F${meeting}%2Flobby$`))
})

test('an invalid invitation link explains itself', async ({ page }) => {
  await page.goto('/invite/not-a-real-token')
  await expect(page.getByRole('heading', { name: 'Invitation unavailable' })).toBeVisible()
  await expect(page.getByText(/not valid/)).toBeVisible()
})
