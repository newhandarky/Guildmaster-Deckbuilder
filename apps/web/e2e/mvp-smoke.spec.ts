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
  await expect(page.getByTestId('replay-report')).toHaveAttribute('role', 'status');
  await expect(page.getByTestId('interaction-hint')).toHaveAttribute('aria-live', 'polite');
  await expect(page.getByTestId('end-phase')).toBeEnabled();
});

test('replay runner completes the current exported audit without changing the live game', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '載入目前 Replay' }).click();
  await page.getByTestId('run-replay').click();
  await expect(page.getByTestId('replay-report')).toContainText('Replay 完成');
  await expect(page.getByTestId('end-phase')).toBeEnabled();
});

test('replay runner reports the first assertion divergence without changing the live game', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '載入目前 Replay' }).click();
  const bundle = JSON.parse(await page.getByLabel('Replay JSON').inputValue());
  bundle.expectedFinalSnapshot.state.rngState += 1;
  await page.getByLabel('Replay JSON').fill(JSON.stringify(bundle));
  await page.getByTestId('run-replay').click();
  await expect(page.getByTestId('replay-report')).toContainText('first divergence $.expectedFinalSnapshot.state.rngState');
  await expect(page.getByTestId('end-phase')).toBeEnabled();
});

test('deterministic full-game journey defeats, recruits, rests, restores v3 save, and continues legally', async ({ page }) => {
  await page.goto('/');
  const endPhase = page.getByTestId('end-phase');

  await endPhase.click();
  const monsterRow = page.locator('section').filter({ has: page.getByRole('heading', { name: /魔物區/ }) });
  const legalMonster = monsterRow.locator('button:not([disabled])').first();
  await expect(legalMonster).toBeEnabled();
  await legalMonster.click();
  await expect(page.locator('.log')).toContainText('討伐了');

  await endPhase.click();
  await endPhase.click();
  const recruitRow = page.locator('section').filter({ has: page.getByRole('heading', { name: /招募區/ }) });
  const legalRecruit = recruitRow.locator('button:not([disabled])').first();
  await expect(legalRecruit).toBeEnabled();
  await legalRecruit.click();
  await expect(page.locator('.log')).toContainText('取得了');

  await endPhase.click();
  await endPhase.click();
  await expect(page.getByText(/第 \d+ 輪 · 行動一階段/)).toBeVisible();
  await expect(page.getByText('你的回合')).toBeVisible();
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

test('deterministic all-bosses journey reaches the scoreboard once and restarts with a fresh replay', async ({ page }) => {
  await page.goto('/?e2eScenario=all-bosses-endgame');
  const endPhase = page.getByTestId('end-phase');

  await endPhase.click();
  const bossRow = page.locator('section').filter({ has: page.getByRole('heading', { name: /魔王/ }) });
  const legalBoss = bossRow.locator('button:not([disabled])').first();
  await expect(legalBoss).toBeEnabled();
  await legalBoss.click();

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

  await page.getByRole('button', { name: '開啟新遠征' }).click();
  await expect(page.getByTestId('game-app')).toBeVisible();
  await expect(page.getByText('版本 0')).toBeVisible();
  await expect(page.locator('.log')).toContainText('等待你的第一個行動。');
  await expect(endPhase).toBeEnabled();
  await page.getByRole('button', { name: '載入目前 Replay' }).click();
  await page.getByTestId('run-replay').click();
  await expect(page.getByTestId('replay-report')).toContainText('commands 0 · events 0 · revision 0');
});

test('deterministic all-bonds journey triggers the registered bond end condition through UI play', async ({ page }) => {
  await page.goto('/?e2eScenario=all-bonds-endgame');
  const endPhase = page.getByTestId('end-phase');

  await endPhase.click();
  const bossRow = page.locator('section').filter({ has: page.getByRole('heading', { name: /魔王/ }) });
  const legalBoss = bossRow.locator('button:not([disabled])').first();
  await expect(legalBoss).toBeEnabled();
  await legalBoss.click();

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

test('keyboard reaches a legal target, submits it with Space, and retains a useful focus target', async ({ page }) => {
  await page.goto('/');
  const endPhase = page.getByTestId('end-phase');

  await page.keyboard.press('Tab');
  await expect(endPhase).toBeFocused();
  await expect(endPhase).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('interaction-hint')).toContainText('討伐階段');

  await page.keyboard.press('Shift+Tab');
  await expect(page.locator(':focus')).toHaveAttribute('aria-label', /討伐：/);
  await page.keyboard.press('Space');
  await expect(page.locator('.log')).toContainText('討伐了');
  await expect(endPhase).toBeFocused();
});

const viewports = [
  { name: 'desktop', size: { width: 1280, height: 800 } },
  { name: 'tablet', size: { width: 1024, height: 768 } },
  { name: 'mobile landscape', size: { width: 667, height: 375 } },
  { name: 'narrow fallback', size: { width: 320, height: 640 } }
] as const;

for (const { name, size } of viewports) {
  test(`${name} viewport avoids page-level horizontal overflow`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/');
    if (size.width === 320) await page.addStyleTag({ content: 'html { font-size: 150%; }' });
    expect(await page.locator('body').evaluate((body) => body.scrollWidth <= body.clientWidth)).toBe(true);
  });
}

for (const { name, size } of viewports.filter(({ size }) => size.width === 1024 || size.width === 667)) {
  test(`${name} viewport completes a legal attack and phase advance`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/');
    await page.getByTestId('end-phase').click();
    const monsterRow = page.locator('section').filter({ has: page.getByRole('heading', { name: /魔物區/ }) });
    await monsterRow.locator('button:not([disabled])').first().click();
    await expect(page.locator('.log')).toContainText('討伐了');
    await page.getByTestId('end-phase').click();
    await expect(page.getByText(/第 \d+ 輪 · 行動二階段/)).toBeVisible();
    expect(await page.locator('body').evaluate((body) => body.scrollWidth <= body.clientWidth)).toBe(true);
  });
}

test('mobile landscape scoreboard and new expedition controls remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await page.goto('/?e2eScenario=all-bosses-endgame');
  await page.getByTestId('end-phase').click();
  const bossRow = page.locator('section').filter({ has: page.getByRole('heading', { name: /魔王/ }) });
  await bossRow.locator('button:not([disabled])').first().click();
  await finishTriggeredFinalRound(page);

  const newExpedition = page.getByRole('button', { name: '開啟新遠征' });
  await expect(newExpedition).toBeFocused();
  await newExpedition.click();
  await expect(page.getByTestId('game-app')).toBeVisible();
  await expect(page.getByTestId('end-phase')).toBeFocused();
  expect(await page.locator('body').evaluate((body) => body.scrollWidth <= body.clientWidth)).toBe(true);
});
