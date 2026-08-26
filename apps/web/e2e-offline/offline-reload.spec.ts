import { expect, test } from '@playwright/test';

test('reloads and resumes the local session with the network disabled', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '開始新遠征' }).click();
  await page.getByTestId('end-phase').click();
  await expect(page.getByTestId('save-status')).toContainText('已保存');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect(page.getByRole('heading', { name: '繼續晨星遠征' })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('body')).toContainText('繼續晨星遠征');
  await expect(page.getByRole('heading', { name: '繼續晨星遠征' })).toBeVisible();
  await page.getByRole('button', { name: '繼續最近進度' }).click();
  await expect(page.getByTestId('game-app')).toBeVisible();
  await expect(page.getByTestId('save-status')).toContainText(/已恢復|已保存/);
});
