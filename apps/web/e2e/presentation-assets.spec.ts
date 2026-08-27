import { expect, test } from '@playwright/test';
import { openGame } from './game-entry.js';

test('responsive presentation art is shared by cards and details without changing authority', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openGame(page, '/?e2ePresentationAsset=valid');

  const cardArt = page.locator('[data-asset-key="demo:starter/newcomer"]').first();
  const cardImage = cardArt.locator('img');
  await expect(cardImage).toBeVisible();
  await expect(cardImage).toHaveAttribute('srcset', /384w.+768w/);
  await expect(cardImage).toHaveAttribute('sizes', /\b112px\b.+\b146px\b/);
  await expect(cardImage).toHaveCSS('object-position', '35% 25%');
  const revisionBefore = await page.getByText(/版本 \d+/).first().textContent();
  const legalActionsBefore = await page.locator('[data-legal-action="true"]').count();

  await cardArt.locator('xpath=ancestor::button').click();
  const details = page.getByTestId('card-details');
  await expect(details.locator('[data-asset-key="demo:starter/newcomer"] img')).toBeVisible();
  await expect(details.locator('img')).toHaveAttribute('sizes', /\b480px\b/);
  await expect(details.locator('img')).toHaveAttribute('alt', '起始牌 A的原創示範插畫');
  await expect(details.locator('img')).toHaveCSS('object-fit', 'contain');
  await expect(details.locator('.card-details-visual .game-card__rules')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await page.getByRole('button', { name: '關閉卡牌詳情' }).click();
  await openGame(page);
  await expect(page.getByText(revisionBefore ?? '')).toBeVisible();
  expect(await page.locator('[data-legal-action="true"]').count()).toBe(legalActionsBefore);
});

test('a broken approved source falls back to the existing CSS placeholder', async ({ page }) => {
  await openGame(page, '/?e2ePresentationAsset=broken');
  const art = page.locator('[data-asset-key="demo:starter/newcomer"]').first();
  await expect(art.locator('[data-image-fallback="visible"]')).toBeVisible();
  await expect(art.locator('[data-html-artwork="true"]')).toBeVisible();
  await expect(art.locator('[data-html-artwork="true"] > span')).toHaveCount(5);
  await expect(art.locator('img')).toHaveCount(0);
  await art.locator('xpath=ancestor::button').click();
  const detailsFallback = page.getByTestId('card-details').locator('[data-image-fallback="visible"]');
  await expect(detailsFallback.locator('[data-html-artwork="true"]')).toBeVisible();
  await expect(detailsFallback).toHaveAttribute(
    'aria-label',
    '起始牌 A的原創示範插畫（目前使用替代插畫）',
  );
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 1440, height: 900 },
]) {
  test(`presentation images preserve card geometry at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openGame(page, '/?e2ePresentationAsset=valid');
    const card = page.locator('[data-asset-key="demo:starter/newcomer"]').first().locator('xpath=ancestor::button');
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs((box!.width / box!.height) - (63 / 88))).toBeLessThan(0.015);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}
