import { expect, test } from '@playwright/test';
import { startNewExpedition } from '../e2e/game-entry.js';

const pagesPath = '/Guildmaster-Deckbuilder/';

test('boots, persists, and reloads offline from the GitHub Pages project path', async ({ page, context }) => {
  const badResponses: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400 && response.url().startsWith('http://127.0.0.1:4175')) badResponses.push(`${response.status()} ${response.url()}`);
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(pagesPath);
  await expect(page.getByTestId('expedition-entry')).toBeVisible();
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', `${pagesPath}manifest.webmanifest`);

  const registration = await page.evaluate(async () => {
    const ready = await navigator.serviceWorker.ready;
    return { scope: ready.scope, script: ready.active?.scriptURL };
  });
  expect(new URL(registration.scope).pathname).toBe(pagesPath);
  expect(new URL(registration.script ?? '').pathname).toBe(`${pagesPath}service-worker.js`);

  await startNewExpedition(page);
  await expect(page.getByTestId('game-app')).toBeVisible();
  await page.getByTestId('end-phase').click();
  await expect(page.getByTestId('save-status')).toContainText('已保存');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect(page.getByRole('heading', { name: '繼續晨星遠征' })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: '繼續晨星遠征' })).toBeVisible();
  expect(badResponses).toEqual([]);
});

test('keeps the playable table inside a phone landscape viewport', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(pagesPath);
  await startNewExpedition(page);

  const dock = page.getByTestId('turn-control-dock');
  const dockBox = await dock.boundingBox();
  expect(dockBox?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect(dockBox?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((dockBox?.x ?? 0) + (dockBox?.width ?? 0)).toBeLessThanOrEqual(845);
  expect((dockBox?.y ?? 0) + (dockBox?.height ?? 0)).toBeLessThanOrEqual(391);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
