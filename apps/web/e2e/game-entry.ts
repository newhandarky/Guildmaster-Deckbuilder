import { expect, type Page } from '@playwright/test';

export async function enterGame(page: Page): Promise<void> {
  const entry = page.getByTestId('expedition-entry');
  await expect(entry).toBeVisible();
  const continueButton = entry.getByRole('button', { name: '繼續最近進度' });
  if (await continueButton.count()) await continueButton.click();
  else await entry.getByRole('button', { name: '開始新遠征' }).click();
  await expect(page.getByTestId('game-app')).toBeVisible();
}

export async function openGame(page: Page, url = '/'): Promise<void> {
  await page.goto(url);
  await enterGame(page);
}
