import { expect, test } from '@playwright/test';
import { openGame, openNewExpeditionSetup } from './game-entry.js';

test('compact opponent summaries expose only authorized counts, combat, and completed bonds', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await openNewExpeditionSetup(page);
  await page.getByRole('radio', { name: /基礎版原作衍生 Provisional 測試/ }).check();
  await page.getByRole('button', { name: '開始新遠征' }).click();

  const seats = page.locator('.player-seat');
  await expect(seats).toHaveCount(3);
  for (const seat of await seats.all()) {
    await expect(seat).toContainText(/手牌 \d+/);
    await expect(seat).toContainText(/隊伍 \d+/);
    await expect(seat).toContainText(/戰力 \d+/);
    await expect(seat).toContainText(/羈絆 \d+\/5/);
    await expect(seat.locator('[data-card-instance-id]')).toHaveCount(0);
  }

  await seats.first().hover();
  const details = page.getByTestId('opponent-details');
  await expect(details).toBeVisible();
  await expect(details.locator('[data-card-instance-id]')).toHaveCount(0);
  await expect(details).not.toContainText('手牌內容');
});

test('mouse hover opens, crosses into the panel, and closes without pinning on desktop click', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openGame(page);
  const seat = page.locator('.player-seat').first();
  const details = page.locator('.opponent-details');

  await seat.hover();
  await expect(details).toBeVisible();
  const seatBox = await seat.boundingBox();
  const detailsBox = await details.boundingBox();
  await page.mouse.move(
    ((seatBox?.x ?? 0) + (seatBox?.width ?? 0) + (detailsBox?.x ?? 0)) / 2,
    (seatBox?.y ?? 0) + (seatBox?.height ?? 0) / 2,
  );
  await page.waitForTimeout(100);
  await details.hover({ position: { x: 16, y: 16 } });
  await expect(details).toBeVisible();

  await page.mouse.move(0, 0);
  await expect(details).toHaveCount(0);

  await seat.click();
  await expect(details).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(details).toHaveCount(0);
});

test('moving directly between seats switches the public details in four-player mode', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await openNewExpeditionSetup(page);
  await page.getByRole('radio', { name: /基礎版原作衍生 Provisional 測試/ }).check();
  await page.getByRole('button', { name: '開始新遠征' }).click();
  await expect(page.getByTestId('game-app')).toBeVisible();

  const seats = page.locator('.player-seat');
  await expect(seats).toHaveCount(3);
  await seats.first().hover();
  await expect(page.locator('.opponent-details')).toContainText('CPU 一號 的公開隊伍');
  await seats.nth(1).hover();
  await expect(page.locator('.opponent-details')).toContainText('CPU 二號 的公開隊伍');
});

test('keyboard focus keeps public details open inside the cluster and closes after focus leaves', async ({ page }) => {
  await openGame(page);
  const seat = page.locator('.player-seat').first();
  const details = page.locator('.opponent-details');
  const close = details.getByRole('button', { name: /關閉.*公開資訊/ });

  await seat.focus();
  await expect(details).toBeVisible();
  await close.focus();
  await expect(details).toBeVisible();
  await close.press('Enter');
  await expect(details).toHaveCount(0);
  await expect(seat).toBeFocused();

  await page.getByTestId('game-play-column').focus();
  await seat.focus();
  await expect(details).toBeVisible();
  await seat.press('Escape');
  await expect(details).toHaveCount(0);
  await expect(seat).toBeFocused();

  await page.getByTestId('game-play-column').focus();
  await seat.focus();
  await expect(details).toBeVisible();
  await page.getByTestId('game-play-column').focus();
  await expect(details).toHaveCount(0);
  await expect(page.getByTestId('game-play-column')).toBeFocused();
});

test('required lifecycle interaction suspends an already hovered opponent panel', async ({ page }) => {
  await openGame(page, '/?e2eScenario=lifecycle-choice');
  await page.locator('.player-seat').first().hover();
  await expect(page.locator('.opponent-details')).toBeVisible();

  await page.getByTestId('end-phase').evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByTestId('lifecycle-dock')).toBeVisible();
  await expect(page.locator('.opponent-details')).toHaveCount(0);
});

test('opponent overlay is above sticky controls and below card details modal', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openGame(page);
  await page.locator('.player-seat').first().hover();
  const details = page.locator('.opponent-details');
  await expect(details).toBeVisible();

  const interactionZ = Number(await page.getByTestId('interaction-rail').evaluate((element) => getComputedStyle(element).zIndex));
  const overlayZ = Number(await details.evaluate((element) => getComputedStyle(element).zIndex));
  expect(overlayZ).toBeGreaterThan(interactionZ);

  await page.getByTestId('hand').getByRole('button').first().evaluate((button: HTMLButtonElement) => button.click());
  const modal = page.locator('.card-details-dialog');
  await expect(modal).toBeVisible();
  const modalZ = Number(await modal.evaluate((element) => getComputedStyle(element).zIndex));
  expect(modalZ).toBeGreaterThan(overlayZ);
});

test.describe('touch fallback', () => {
  test.use({ hasTouch: true });

  test('tap toggles the opponent panel without hover and keeps it inside the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openGame(page);
    const seat = page.locator('.player-seat').first();
    const details = page.locator('.opponent-details');

    await seat.tap();
    await expect(details).toBeVisible();
    const box = await details.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(844);
    await seat.tap();
    await expect(details).toHaveCount(0);
  });
});
