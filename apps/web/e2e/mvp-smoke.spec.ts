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
  const unavailable = page.getByTestId('hand').getByRole('button').first();
  await expect(unavailable).toBeEnabled();
  await unavailable.click();
  await expect(page.getByTestId('card-details')).toContainText('目前不可執行');
  await expect(page.getByTestId('card-details').locator('footer .primary')).toHaveCount(0);
});

test('card details support keyboard inspection, Escape, and focus restoration', async ({ page }) => {
  await page.goto('/');
  const card = page.getByTestId('hand').getByRole('button').first();
  await card.focus();
  await card.press('Enter');
  await expect(page.getByTestId('card-details')).toBeVisible();
  await page.getByTestId('card-details').press('Escape');
  await expect(page.getByTestId('card-details')).not.toBeVisible();
  await expect(card).toBeFocused();
  await card.press('Space');
  await expect(page.getByTestId('card-details')).toBeVisible();
  await page.getByRole('button', { name: '關閉卡牌詳情' }).click();
  await expect(card).toBeFocused();
});

test('art-first cards keep their desktop and mobile ratio without page overflow', async ({ page }) => {
  await page.goto('/?e2eScenario=tagged-card-layout');
  const desktopCard = page.getByTestId('hand').getByRole('button').first();
  const desktopBox = await desktopCard.boundingBox();
  expect(desktopBox?.width).toBeCloseTo(146, 0);
  expect((desktopBox?.width ?? 0) / (desktopBox?.height ?? 1)).toBeCloseTo(63 / 88, 2);

  await page.setViewportSize({ width: 390, height: 844 });
  const compactCard = page.getByTestId('hand').getByRole('button').first();
  const compactBox = await compactCard.boundingBox();
  expect(compactBox?.width).toBeCloseTo(112, 0);
  expect((compactBox?.width ?? 0) / (compactBox?.height ?? 1)).toBeCloseTo(63 / 88, 2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await compactCard.click();
  await expect(page.getByTestId('card-details')).toBeVisible();
  const dialogBox = await page.getByRole('dialog').boundingBox();
  expect(dialogBox?.width).toBeLessThanOrEqual(390);
  expect((dialogBox?.y ?? 0) + (dialogBox?.height ?? 0)).toBeCloseTo(844, 0);
  await expect(page.locator('.card-tags')).toContainText('e2e-layout-tag');
  const tagsBox = await page.locator('.card-tags').boundingBox();
  const stateBox = await page.locator('.card-details-state').boundingBox();
  expect((tagsBox?.y ?? 0) + (tagsBox?.height ?? 0)).toBeLessThanOrEqual(stateBox?.y ?? 0);
});

test('malformed local save is cleared and starts a playable new game', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('guildmaster-mvp-save-v2', '{not-json'));
  await page.goto('/');
  await expect(page.getByTestId('human-card-count')).toContainText('手牌 5');
  await expect(page.getByTestId('end-phase')).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('guildmaster-mvp-save-v2'))).toBeNull();
});

test('legacy local save restores the persisted phase', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('end-phase').click();
  await page.evaluate(() => {
    const current = JSON.parse(localStorage.getItem('guildmaster-mvp-save-v2')!);
    localStorage.setItem('guildmaster-mvp-snapshot-v1', JSON.stringify(current.snapshot));
    localStorage.setItem('guildmaster-mvp-events-v1', JSON.stringify(current.events));
    localStorage.removeItem('guildmaster-mvp-save-v2');
  });
  await page.reload();
  await expect(page.getByTestId('interaction-hint')).toContainText('討伐階段');
});

test('replay runner reports malformed JSON without changing the live game', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Replay JSON').fill('{not-json');
  await page.getByTestId('run-replay').click();
  await expect(page.getByTestId('replay-report')).toContainText('Replay JSON 無法解析');
  await expect(page.getByTestId('end-phase')).toBeEnabled();
});

test('replay runner does not expose the current unfinished authoritative game', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '載入已完成對局 Replay' }).click();
  await expect(page.getByTestId('replay-report')).toContainText('只能在對局結束後匯出');
  await expect(page.getByLabel('Replay JSON')).toHaveValue('');
  await expect(page.getByTestId('end-phase')).toBeEnabled();
});

test('replay runner reports the first assertion divergence without changing the live game', async ({ page }) => {
  await page.goto('/?e2eScenario=all-bosses-endgame');
  await finishAllBossesGame(page);
  await page.getByRole('button', { name: '載入已完成對局 Replay' }).click();
  const bundle = JSON.parse(await page.getByLabel('Replay JSON').inputValue());
  bundle.expectedFinalSnapshot.state.rngState += 1;
  await page.getByLabel('Replay JSON').fill(JSON.stringify(bundle));
  await page.getByTestId('run-replay').click();
  await expect(page.getByTestId('replay-report')).toContainText('first divergence $.expectedFinalSnapshot.state.rngState');
  await expect(page.getByRole('heading', { name: '榮譽排名' })).toBeVisible();
});

test('deterministic full-game journey defeats, recruits, rests, restores v3 save, and continues legally', async ({ page }) => {
  await page.goto('/');
  const endPhase = page.getByTestId('end-phase');

  await endPhase.click();
  const monsterRow = page.locator('section').filter({ has: page.getByRole('heading', { name: /魔物區/ }) });
  const legalMonster = monsterRow.locator('[data-legal-action="true"]').first();
  await expect(legalMonster).toBeEnabled();
  await runCardAction(page, legalMonster, '討伐');
  await expect(page.locator('.log')).toContainText('討伐了');
  await expect(page.getByTestId('interaction-hint')).toBeFocused();

  await endPhase.click();
  await endPhase.click();
  const recruitRow = page.locator('section').filter({ has: page.getByRole('heading', { name: /招募區/ }) });
  const legalRecruit = recruitRow.locator('[data-legal-action="true"]').first();
  await expect(legalRecruit).toBeEnabled();
  await runCardAction(page, legalRecruit, '招募');
  await expect(page.locator('.log')).toContainText('取得了');

  await endPhase.click();
  await endPhase.click();
  await expect(page.getByText(/第 \d+ 輪 · 行動一階段/)).toBeVisible();
  await expect(page.getByText('你的回合')).toBeVisible();
  const playableAdventurer = page.getByTestId('hand').locator('[data-card-type="adventurer"][data-legal-action="true"]').first();
  for (let drawAttempt = 0; drawAttempt < 3 && await playableAdventurer.count() === 0; drawAttempt += 1) {
    for (let phase = 0; phase < 5; phase += 1) await endPhase.click();
  }
  await expect(playableAdventurer).toBeVisible();
  await runCardAction(page, playableAdventurer, '加入隊伍');
  await expect(page.locator('.log')).toContainText('加入了一名冒險者');
  await expect(page.evaluate(() => JSON.parse(localStorage.getItem('guildmaster-mvp-save-v2')!).schemaVersion)).resolves.toBe(3);

  await page.reload();
  await expect(page.getByText(/第 \d+ 輪 · 行動一階段/)).toBeVisible();
  await expect(page.getByText('你的回合')).toBeVisible();
  await expect(endPhase).toBeEnabled();
  await endPhase.click();
  await expect(page.getByTestId('interaction-hint')).toContainText('討伐階段');
});

async function finishTriggeredFinalRound(page: import('@playwright/test').Page): Promise<void> {
  const endPhase = page.getByTestId('end-phase');
  for (let phase = 0; phase < 4; phase += 1) await endPhase.click();
  await expect(page.getByRole('heading', { name: '榮譽排名' })).toBeVisible();
}

async function finishAllBossesGame(page: import('@playwright/test').Page): Promise<void> {
  const endPhase = page.getByTestId('end-phase');
  await endPhase.click();
  const bossRow = page.locator('section').filter({ has: page.getByRole('heading', { name: /魔王/ }) });
  await runCardAction(page, bossRow.locator('[data-legal-action="true"]').first(), '討伐');
  await finishTriggeredFinalRound(page);
}

test('deterministic all-bosses journey reaches the scoreboard once and restarts with a fresh replay', async ({ page }) => {
  await page.goto('/?e2eScenario=all-bosses-endgame');
  const endPhase = page.getByTestId('end-phase');

  await endPhase.click();
  const bossRow = page.locator('section').filter({ has: page.getByRole('heading', { name: /魔王/ }) });
  const legalBoss = bossRow.locator('[data-legal-action="true"]').first();
  await expect(legalBoss).toBeEnabled();
  await runCardAction(page, legalBoss, '討伐');

  await expect(page.getByTestId('final-round-notice')).toBeVisible();
  await expect(page.getByTestId('game-app')).toBeVisible();
  await finishTriggeredFinalRound(page);
  await expect(page.getByText('base:all-bosses-defeated')).toBeVisible();

  const rows = page.locator('.scoreboard .score-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('#1 你');
  await expect(rows.nth(0)).toContainText('5 榮譽');
  await expect(rows.nth(0)).toContainText('魔王 1／魔物 0');
  await expect(rows.nth(1)).toContainText('#2');
  await expect(rows.nth(1)).toContainText(/\d+ 榮譽/);
  await expect(rows.nth(1)).toContainText('魔王 0');

  await page.getByRole('button', { name: '載入已完成對局 Replay' }).click();
  await page.getByTestId('run-replay').click();
  await expect(page.getByTestId('replay-report')).toContainText('Replay 完成');

  await page.getByRole('button', { name: '開啟新遠征' }).click();
  await expect(page.getByTestId('game-app')).toBeVisible();
  await expect(page.getByText('版本 0')).toBeVisible();
  await expect(page.locator('.log')).toContainText('等待你的第一個行動。');
  await expect(endPhase).toBeEnabled();
  await page.getByRole('button', { name: '載入已完成對局 Replay' }).click();
  await expect(page.getByTestId('replay-report')).toContainText('只能在對局結束後匯出');
});

test('deterministic all-bonds journey triggers the registered bond end condition through UI play', async ({ page }) => {
  await page.goto('/?e2eScenario=all-bonds-endgame');
  const endPhase = page.getByTestId('end-phase');

  await endPhase.click();
  const bossRow = page.locator('section').filter({ has: page.getByRole('heading', { name: /魔王/ }) });
  const legalBoss = bossRow.locator('[data-legal-action="true"]').first();
  await expect(legalBoss).toBeEnabled();
  await runCardAction(page, legalBoss, '討伐');

  await expect(page.getByTestId('final-round-notice')).toBeVisible();
  await finishTriggeredFinalRound(page);
  await expect(page.getByText('base:all-bonds-completed')).toBeVisible();

  const rows = page.locator('.scoreboard .score-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('#1');
  await expect(rows.nth(1)).toContainText('#2');
  await expect(rows.filter({ hasText: '你' })).toContainText('5 榮譽');
  await expect(rows.filter({ hasText: '你' })).toContainText('魔王 1／魔物 0');
});

test('equipment uses details-driven selection and only exposes legal party targets', async ({ page }) => {
  await page.goto('/');
  const equipmentInHand = await buyEquipmentIntoHand(page);
  await equipmentInHand.click();
  await page.getByTestId('card-details').getByRole('button', { name: '選擇配戴對象', exact: true }).click();

  const party = page.locator('section').filter({ has: page.getByRole('heading', { name: /隊伍/ }) });
  const legalTargets = party.locator('[data-card-state="target"]');
  await expect(legalTargets).toHaveCount(5);
  await legalTargets.first().click();
  await page.getByTestId('card-details').getByRole('button', { name: '配戴至此隊員', exact: true }).click();
  await expect(page.locator('.log')).toContainText('配戴');
  await expect(page.getByTestId('hand').locator('[data-card-type="equipment"]')).toHaveCount(0);
});

test('restart clears an in-progress equipment selection', async ({ page }) => {
  await page.goto('/');
  const equipmentInHand = await buyEquipmentIntoHand(page);
  await equipmentInHand.click();
  await page.getByTestId('card-details').getByRole('button', { name: '選擇配戴對象', exact: true }).click();
  await expect(page.locator('[data-card-state="target"]')).toHaveCount(5);
  await expect(page.getByRole('button', { name: '取消配戴' })).toBeVisible();

  await page.getByRole('button', { name: '重新開始' }).click();
  await expect(page.getByText('版本 0')).toBeVisible();
  await expect(page.getByRole('button', { name: '取消配戴' })).toHaveCount(0);
  await expect(page.locator('[data-card-state="target"]')).toHaveCount(0);
  await expect(page.getByTestId('hand').locator('[data-card-type="equipment"]')).toHaveCount(0);
});

test('an authoritative revision invalidates an open details action', async ({ page }) => {
  await page.goto('/');
  const equipmentInHand = await buyEquipmentIntoHand(page);
  await equipmentInHand.click();
  await expect(page.getByTestId('card-details').getByRole('button', { name: '選擇配戴對象', exact: true })).toBeVisible();

  await page.getByTestId('end-phase').evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByTestId('card-details')).not.toBeVisible();
  await expect(page.getByTestId('interaction-hint')).toContainText('討伐階段');
  await expect(equipmentInHand).toBeFocused();
  await equipmentInHand.click();
  await expect(page.getByTestId('card-details').getByRole('button', { name: '選擇配戴對象', exact: true })).toHaveCount(0);
});

test('item use is dispatched only from the current details action', async ({ page }) => {
  await page.goto('/');
  const endPhase = page.getByTestId('end-phase');
  for (let phase = 0; phase < 3; phase += 1) await endPhase.click();
  const store = page.locator('section').filter({ has: page.getByRole('heading', { name: /商店/ }) });
  const itemForSale = store.locator('[data-card-type="item"][data-legal-action="true"]').first();
  await expect(itemForSale).toBeVisible();
  await runCardAction(page, itemForSale, '購買');
  await endPhase.click();
  await endPhase.click();

  const itemInHand = page.getByTestId('hand').locator('[data-card-type="item"][data-legal-action="true"]');
  await expect(itemInHand).toHaveCount(1);
  await itemInHand.click();
  await page.getByTestId('card-details').getByRole('button', { name: '使用道具', exact: true }).click();
  await expect(page.locator('.log')).toContainText('使用了道具');
  await expect(page.getByTestId('hand').locator('[data-card-type="item"]')).toHaveCount(0);
});

async function buyEquipmentIntoHand(page: import('@playwright/test').Page): Promise<import('@playwright/test').Locator> {
  const endPhase = page.getByTestId('end-phase');
  for (let phase = 0; phase < 3; phase += 1) await endPhase.click();
  const store = page.locator('section').filter({ has: page.getByRole('heading', { name: /商店/ }) });
  const equipmentForSale = store.locator('[data-card-type="equipment"][data-legal-action="true"]').first();
  await expect(equipmentForSale).toBeVisible();
  await runCardAction(page, equipmentForSale, '購買');
  await endPhase.click();
  await endPhase.click();
  const equipmentInHand = page.getByTestId('hand').locator('[data-card-type="equipment"]');
  await expect(equipmentInHand).toHaveCount(1);
  return equipmentInHand;
}

async function runCardAction(
  page: import('@playwright/test').Page,
  card: import('@playwright/test').Locator,
  actionName: string,
): Promise<void> {
  await card.click();
  await expect(page.getByTestId('card-details')).toBeVisible();
  await page.getByTestId('card-details').getByRole('button', { name: actionName, exact: true }).click();
}
