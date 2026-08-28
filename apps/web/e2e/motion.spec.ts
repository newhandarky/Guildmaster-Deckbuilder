import { expect, test } from '@playwright/test';
import { openGame } from './game-entry.js';

test('a defeated card uses a non-interactive ghost and skip leaves the authoritative result intact', async ({ page }) => {
  await openGame(page);
  await page.evaluate(() => {
    (window as typeof window & { __motionCls?: number }).__motionCls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
        if (!entry.hadRecentInput) (window as typeof window & { __motionCls?: number }).__motionCls! += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.getByTestId('end-phase').click();
  const monsterRow = page.locator('section').filter({ has: page.getByRole('heading', { name: /魔物區/ }) });
  await monsterRow.locator('[data-legal-action="true"]').first().click();
  await page.getByTestId('card-details').getByRole('button', { name: '討伐', exact: true }).click();

  const ghost = page.locator('.motion-card-ghost[data-card-type="monster"]');
  await expect(ghost).toBeVisible();
  await expect(ghost).not.toHaveAttribute('data-card-instance-id');
  await expect(ghost).toBeDisabled();
  await page.getByRole('button', { name: '略過動畫' }).click();
  await expect(page.locator('.motion-ghost-layer').locator('*')).toHaveCount(0);
  expect(await page.locator('.card').evaluateAll((cards) => cards.reduce((count, card) => count + card.getAnimations().length, 0))).toBe(0);
  await expect(page.getByText('版本 2')).toBeVisible();
  await page.getByRole('button', { name: '事件', exact: true }).click();
  await expect(page.locator('.log')).toContainText('討伐了');
  expect(await page.evaluate(() => (window as typeof window & { __motionCls?: number }).__motionCls ?? 0)).toBeLessThan(0.05);
});

test('rapid duplicate gameplay input commits only once', async ({ page }) => {
  await openGame(page);
  await page.getByTestId('end-phase').dblclick();
  await expect(page.getByText('版本 1')).toBeVisible();
  const savedRevision = await page.evaluate(() => JSON.parse(localStorage.getItem('guildmaster-mvp-save-v2')!).snapshot.state.revision);
  expect(savedRevision).toBe(1);
});

test('reduced motion commits immediately without spatial card animation or ghosts', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openGame(page);
  await page.getByTestId('end-phase').click();
  await expect(page.getByText('版本 1')).toBeVisible();
  await expect(page.getByRole('button', { name: '略過動畫' })).toHaveCount(0);
  expect(await page.evaluate(() => document.getAnimations().filter(({ playState }) => playState === 'running').length)).toBe(0);
  await expect(page.locator('.motion-ghost-layer').locator('*')).toHaveCount(0);
});
