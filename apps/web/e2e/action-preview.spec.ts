import { expect, test } from '@playwright/test';
import { replayGame } from '@guildmaster/game-engine';
import { createWebRuleset } from '../src/app/ruleset.js';
import { openGame } from './game-entry.js';

test('desktop card details show an authoritative combat preview before dispatch', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openGame(page);
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
  await openGame(page);
  const endPhase = page.getByTestId('end-phase');
  await endPhase.click();
  await endPhase.click();
  await endPhase.click();

  await page.getByRole('tab', { name: /酒館區/ }).click();
  const tavern = page.getByTestId('public-table').getByTestId('tavern-area');
  await tavern.locator('[data-legal-action="true"]').first().click();
  const preview = page.getByTestId('action-preview');
  await expect(preview.getByRole('heading', { name: '購買預覽' })).toBeVisible();
  await expect(preview).toContainText('目前購買力');
  await expect(preview).toContainText('卡牌費用');
  await expect(preview).toContainText('購買後剩餘');
  await expect(preview).toContainText('authoritative rules 重新驗證');
});

test('Batch A helper discount, rotation, rest hand size, save, and replay stay authoritative', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGame(page, '/?e2eScenario=helper-batch-a');
  await expect(page.getByTestId('helper-panel')).toContainText('候選協助者 01');
  await expect(page.locator('body')).not.toContainText('base:helper/helper-07');
  const endPhase = page.getByTestId('end-phase');
  await endPhase.click();
  await endPhase.click();
  await endPhase.click();

  await page.getByRole('tab', { name: /酒館區/ }).click();
  const supply = page.locator('[data-zone-id="base:item-row"] [data-card-type="item"][data-legal-action="true"]').first();
  await expect(supply).toBeVisible();
  await supply.click();
  const preview = page.getByTestId('action-preview');
  await expect(preview).toContainText('原費用6');
  await expect(preview).toContainText('協助者折扣後費用5');
  await page.getByTestId('card-details').getByRole('button', { name: '購買', exact: true }).click();
  const purchased = await page.evaluate(() => JSON.parse(localStorage.getItem('guildmaster-mvp-save-v2')!));
  expect(purchased.snapshot.state.players[0].turnPurchaseSpent).toBe(5);

  await endPhase.click();
  await endPhase.click();
  const combatItem = page.getByTestId('hand').getByRole('button', { name: /道具 A/ });
  await expect(combatItem).toBeVisible();
  await combatItem.click();
  await page.getByTestId('card-details').getByRole('button', { name: '使用道具', exact: true }).click();
  await endPhase.click();
  await page.getByRole('tab', { name: /遭遇區/ }).click();
  const boss = page.locator('[data-zone-id="base:boss-row"] [data-legal-action="true"]').first();
  await boss.click();
  await page.getByTestId('card-details').getByRole('button', { name: '討伐', exact: true }).click();
  await expect(page.getByTestId('helper-panel')).toContainText('候選協助者 07');
  await endPhase.click();
  await endPhase.click();
  await endPhase.click();
  await endPhase.click();
  await expect(page.getByTestId('human-card-count')).toContainText('手牌 6');

  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('guildmaster-mvp-save-v2')!));
  expect(persisted.snapshot.state.zones['base:helper-deck']).toMatchObject({ visibility: 'hidden', cardIds: [] });
  expect(replayGame(persisted.replayBundle, createWebRuleset('helper-batch-a'))).toMatchObject({ status: 'completed', finalSnapshot: persisted.snapshot });
  await page.reload();
  await page.getByRole('button', { name: '繼續最近進度' }).click();
  await expect(page.getByTestId('human-card-count')).toContainText('手牌 6');
  await expect(page.getByTestId('helper-panel')).toContainText('候選協助者 07');
});

test('lifecycle-dependent preview withholds unresolved combat values', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openGame(page, '/?e2eScenario=lifecycle-choice');
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
  await openGame(page);
  await page.getByTestId('end-phase').click();
  const monsterRow = page.locator('section').filter({ has: page.getByRole('heading', { name: /魔物區/ }) });
  await monsterRow.locator('[data-legal-action="true"]').first().click();

  const details = page.getByTestId('card-details');
  await expect(details.getByTestId('action-preview')).toBeVisible();
  await details.getByRole('button', { name: '討伐', exact: true }).scrollIntoViewIfNeeded();
  await expect(details.getByRole('button', { name: '討伐', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
