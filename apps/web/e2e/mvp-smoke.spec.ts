import { expect, test } from '@playwright/test';

test('opening game shows the human guild, hand, and a valid action', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('game-app')).toBeVisible();
  await expect(page.getByTestId('player-summary')).toContainText('你的公會');
  await expect(page.getByTestId('human-card-count')).toContainText('手牌 5');
  await expect(page.getByTestId('hand').getByRole('button')).toHaveCount(5);
  await expect(page.getByTestId('end-phase')).toBeEnabled();
  await expect(page.getByTestId('interaction-hint')).toContainText('可操作');
});

test('a completed human turn lets the AI finish and returns control to the human', async ({ page }) => {
  await page.goto('/');
  const endPhase = page.getByTestId('end-phase');
  for (let phase = 0; phase < 5; phase += 1) await endPhase.click();
  await expect(page.getByText('你的回合')).toBeVisible();
  await expect(endPhase).toBeEnabled();
});

test('unavailable actions show a clear phase-specific hint', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('end-phase').click();
  await expect(page.getByTestId('interaction-hint')).toContainText('討伐階段');
  await expect(page.getByTestId('hand').getByRole('button').first()).toBeDisabled();
});
