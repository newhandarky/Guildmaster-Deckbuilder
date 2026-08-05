import { expect, test } from '@playwright/test';

test('desktop card details show an authoritative combat preview before dispatch', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByTestId('end-phase').click();

  const monsterRow = page.locator('section').filter({ has: page.getByRole('heading', { name: /魔物區/ }) });
  await monsterRow.locator('[data-legal-action="true"]').first().click();
  const preview = page.getByTestId('action-preview');
  await expect(preview.getByRole('heading', { name: '討伐預覽' })).toBeVisible();
  await expect(preview).toContainText('需求戰力');
  await expect(preview).toContainText('本次投入');
  await expect(preview).toContainText('戰力餘裕');
  await expect(preview).toContainText('規則結果：擊敗目標。');

  await page.getByTestId('card-details').getByRole('button', { name: '討伐', exact: true }).click();
  await expect(page.getByTestId('latest-event')).toContainText('討伐了');
});

test('desktop card details show current, cost, and remaining purchase power', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const endPhase = page.getByTestId('end-phase');
  await endPhase.click();
  await endPhase.click();
  await endPhase.click();

  const tavern = page.getByTestId('public-table').getByTestId('tavern-area');
  await tavern.locator('[data-legal-action="true"]').first().click();
  const preview = page.getByTestId('action-preview');
  await expect(preview.getByRole('heading', { name: '購買預覽' })).toBeVisible();
  await expect(preview).toContainText('目前購買力');
  await expect(preview).toContainText('卡牌費用');
  await expect(preview).toContainText('購買後剩餘');
  await expect(preview).toContainText('authoritative rules 重新驗證');
});

test('lifecycle-dependent preview withholds unresolved combat values', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?e2eScenario=lifecycle-choice');
  await page.getByTestId('end-phase').click();
  await page.getByTestId('lifecycle-dock').getByRole('button', { name: '繼續', exact: true }).click();

  const monsterRow = page.locator('section').filter({ has: page.getByRole('heading', { name: /魔物區/ }) });
  await monsterRow.locator('[data-legal-action="true"]').first().click();
  const preview = page.getByTestId('action-preview');
  await expect(preview).toContainText('規則互動或隨機結算');
  await expect(preview).not.toContainText('需求戰力');
  await expect(preview).not.toContainText('規則結果');
});

test('combat preview remains scrollable and actionable on the existing narrow layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByTestId('end-phase').click();
  const monsterRow = page.locator('section').filter({ has: page.getByRole('heading', { name: /魔物區/ }) });
  await monsterRow.locator('[data-legal-action="true"]').first().click();

  const details = page.getByTestId('card-details');
  await expect(details.getByTestId('action-preview')).toBeVisible();
  await details.getByRole('button', { name: '討伐', exact: true }).scrollIntoViewIfNeeded();
  await expect(details.getByRole('button', { name: '討伐', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
