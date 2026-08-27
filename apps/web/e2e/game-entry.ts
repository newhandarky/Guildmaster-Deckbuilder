import { expect, type Page } from '@playwright/test';

export async function openNewExpeditionSetup(page: Page): Promise<void> {
  const entry = page.getByTestId('expedition-entry');
  const launch = entry.getByRole('button', { name: /^(開始|開啟)新遠征$/ });
  await expect(launch).toBeVisible();
  await launch.click();
  await expect(entry.getByRole('heading', { name: '選擇遠征內容' })).toBeFocused();
}

export async function startNewExpedition(page: Page): Promise<void> {
  await openNewExpeditionSetup(page);
  await page.getByTestId('expedition-entry').getByRole('button', { name: '開始新遠征', exact: true }).click();
}

export async function enterGame(page: Page): Promise<void> {
  const entry = page.getByTestId('expedition-entry');
  await expect(entry).toBeVisible();
  const continueButton = entry.getByRole('button', { name: '繼續最近進度' });
  if (await continueButton.count()) await continueButton.click();
  else await startNewExpedition(page);
  await expect(page.getByTestId('game-app')).toBeVisible();
}

export async function openGame(page: Page, url = '/'): Promise<void> {
  await page.goto(url);
  await enterGame(page);
}
