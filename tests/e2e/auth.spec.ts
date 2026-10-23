import { expect, test } from '@playwright/test'

test('protected pages redirect to login and keep the destination', async ({ page }) => {
  await page.goto('/dashboard/settings')
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard%2Fsettings$/)
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()

  await page.goto('/m/abc/lobby')
  await expect(page).toHaveURL(/\/login\?next=%2Fm%2Fabc%2Flobby$/)
})

test('login links to signup with the same next path', async ({ page }) => {
  await page.goto('/login?next=/dashboard/settings')
  await page.getByRole('link', { name: 'Create a free account' }).click()
  await expect(page).toHaveURL(/\/signup\?next=%2Fdashboard%2Fsettings$/)
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
  await expect(page.getByText(/15 free minutes/)).toBeVisible()
})

test('OAuth buttons are hidden while their flags are off', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: /Continue with/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
})

test('an external next value is neutralised', async ({ page }) => {
  await page.goto('/login?next=//evil.example')
  await expect(page.getByRole('link', { name: 'Create a free account' })).toHaveAttribute(
    'href',
    '/signup?next=%2Fdashboard',
  )
})

test('login links to the forgot-password page', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('link', { name: 'Forgot password?' }).click()
  await expect(page).toHaveURL(/\/forgot-password$/)
  await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible()
})

test('a reset page without a recovery session offers a new link', async ({ page }) => {
  await page.goto('/auth/reset')
  await expect(page.getByRole('link', { name: 'Request a new link' })).toHaveAttribute(
    'href',
    '/forgot-password',
  )
})
