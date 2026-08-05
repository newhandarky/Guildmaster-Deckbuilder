import { expect, test } from '@playwright/test';

test('desktop table explains phase progress, legal actions, and card states', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');

  const progress = page.getByTestId('phase-progress');
  await expect(progress.locator('li')).toHaveCount(5);
  await expect(progress.locator('[data-phase="action1"]')).toHaveAttribute('aria-current', 'step');
  await expect(page.getByTestId('legal-action-summary')).toHaveText('目前沒有額外卡牌動作，可以結束階段。');

  const legend = page.getByTestId('card-state-legend');
  await expect(legend).toBeVisible();
  await expect(legend.getByRole('listitem')).toHaveCount(4);
  await expect(legend).toContainText('可在詳情確認動作');
  await expect(legend).toContainText('仍可開啟詳情');
});

test('accepted desktop actions advance feedback without duplicating the newest event', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('end-phase').click();

  const progress = page.getByTestId('phase-progress');
  await expect(progress.locator('[data-phase="action1"]')).toHaveAttribute('data-state', 'completed');
  await expect(progress.locator('[data-phase="combat"]')).toHaveAttribute('aria-current', 'step');
  await expect(page.getByTestId('legal-action-summary')).toContainText('1 個目標可討伐');

  const monsterRow = page.locator('section').filter({ has: page.getByRole('heading', { name: /魔物區/ }) });
  await monsterRow.locator('[data-legal-action="true"]').first().click();
  await page.getByTestId('card-details').getByRole('button', { name: '討伐', exact: true }).click();

  const latest = page.getByTestId('latest-event');
  await expect(latest).toContainText('討伐了');
  await expect(latest).toHaveAttribute('role', 'status');
  await expect(page.locator('.event-list')).not.toContainText('討伐了');
  await expect(page.locator('.event-list')).toContainText('結束階段');
});
