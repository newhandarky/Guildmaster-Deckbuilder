import { expect, test } from '@playwright/test';
import { createGame, dispatch, replayGame, serializeSnapshot } from '@guildmaster/game-engine';
import type { CommandEnvelope } from '@guildmaster/game-protocol';
import { createWebRuleset } from '../src/app/ruleset.js';
import { enterGame, openGame } from './game-entry.js';

const localSaveKey = 'guildmaster-mvp-save-v2';

function pendingConsentSave(requesterId: 'human-1' | 'ai-1'): string {
  const ruleset = createWebRuleset('lifecycle-consent');
  const state = createGame({
    gameId: `e2e-consent-${requesterId}`,
    seed: 20260731,
    players: [{ id: 'human-1', name: '你', kind: 'human' }, { id: 'ai-1', name: '星塵 AI', kind: 'ai' }],
    startingPlayerId: 'human-1',
  }, ruleset);
  state.activePlayerId = requesterId;
  state.turnFacts!.playerId = requesterId;
  state.phase = requesterId === 'ai-1' ? 'rest' : 'action1';
  state.players.find(({ id }) => id === requesterId)!.counters.push({
    resourceId: 'e2e:private-counter',
    amount: 73,
    visibility: 'allPlayersByConsent',
  });
  const envelope: CommandEnvelope = {
    protocolVersion: 1,
    gameId: state.gameId,
    commandId: `e2e-consent-root-${requesterId}`,
    actorId: requesterId,
    expectedRevision: 0,
    command: { type: 'END_PHASE', phase: state.phase },
  };
  const suspended = dispatch(state, ruleset, envelope);
  if (suspended.error || !suspended.state.effectState.pendingCounterConsent) throw new Error(`Failed to create pending E2E consent state: ${suspended.error?.message ?? 'missing pending consent'}.`);
  return JSON.stringify({ schemaVersion: 3, snapshot: serializeSnapshot(suspended.state), events: [] });
}

async function installPendingConsent(page: import('@playwright/test').Page, requesterId: 'human-1' | 'ai-1'): Promise<void> {
  const save = pendingConsentSave(requesterId);
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: localSaveKey, value: save });
}

function pendingFoundationCardChoiceSave(): string {
  const ruleset = createWebRuleset(undefined, 'provisional-playtest');
  const state = createGame({
    gameId: 'e2e-foundation-card-choice',
    seed: 20260807,
    players: [{ id: 'human-1', name: '你', kind: 'human' }, { id: 'ai-1', name: '星塵 AI', kind: 'ai' }],
    startingPlayerId: 'human-1',
  }, ruleset);
  const itemId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:resource/resource-10')!.id;
  for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== itemId);
  state.players[0]!.drawPile.push(...state.players[0]!.party.splice(-2).map(({ adventurerId }) => adventurerId));
  state.players[0]!.hand.push(itemId);
  const suspended = dispatch(state, ruleset, {
    protocolVersion: 1,
    gameId: state.gameId,
    commandId: 'e2e-foundation-card-choice-root',
    actorId: 'human-1',
    expectedRevision: 0,
    command: { type: 'USE_ITEM', cardId: itemId },
  });
  if (suspended.error || suspended.state.effectState.pendingCommand?.kind !== 'card-use-effect') throw new Error('Failed to create pending foundation card choice.');
  return JSON.stringify({ schemaVersion: 3, snapshot: serializeSnapshot(suspended.state), events: [] });
}

async function installPendingFoundationCardChoice(page: import('@playwright/test').Page): Promise<void> {
  const save = pendingFoundationCardChoiceSave();
  await page.addInitScript(({ key, value }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
  }, { key: localSaveKey, value: save });
}

function pendingFoundationFilteredChoiceSave(): string {
  const ruleset = createWebRuleset(undefined, 'provisional-playtest');
  const state = createGame({
    gameId: 'e2e-foundation-filtered-card-choice',
    seed: 20260810,
    players: [{ id: 'human-1', name: '你', kind: 'human' }, { id: 'ai-1', name: '星塵 AI', kind: 'ai' }],
    startingPlayerId: 'human-1',
  }, ruleset);
  const itemId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:resource/resource-05')!.id;
  const equipmentId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:resource/resource-02')!.id;
  const adventurerId = Object.values(state.cards).find((card) => ruleset.registry.definitions[card.definitionId]?.type === 'adventurer')!.id;
  for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== itemId && id !== equipmentId && id !== adventurerId);
  state.players[0]!.hand.push(itemId);
  state.players[0]!.discardPile.push(adventurerId, equipmentId);
  const suspended = dispatch(state, ruleset, {
    protocolVersion: 1,
    gameId: state.gameId,
    commandId: 'e2e-foundation-filtered-card-choice-root',
    actorId: 'human-1',
    expectedRevision: 0,
    command: { type: 'USE_ITEM', cardId: itemId },
  });
  if (suspended.error || suspended.state.effectState.pendingChoice?.options.length !== 1) throw new Error('Failed to create pending filtered foundation card choice.');
  return JSON.stringify({ schemaVersion: 3, snapshot: serializeSnapshot(suspended.state), events: [] });
}

async function installPendingFoundationFilteredChoice(page: import('@playwright/test').Page): Promise<void> {
  const save = pendingFoundationFilteredChoiceSave();
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: localSaveKey, value: save });
}

function pendingFoundationMultiSourceChoiceSave(): string {
  const ruleset = createWebRuleset(undefined, 'provisional-playtest');
  const state = createGame({
    gameId: 'e2e-foundation-multi-source-card-choice',
    seed: 20260814,
    players: [{ id: 'human-1', name: '你', kind: 'human' }, { id: 'ai-1', name: '星塵 AI', kind: 'ai' }],
    startingPlayerId: 'human-1',
  }, ruleset);
  const itemId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:resource/resource-15')!.id;
  const equipmentId = Object.values(state.cards).find(({ definitionId }) => definitionId === 'base:resource/resource-02')!.id;
  for (const zone of Object.values(state.zones)) zone.cardIds = zone.cardIds.filter((id) => id !== itemId && id !== equipmentId);
  const player = state.players[0]!;
  player.drawPile.push(...player.hand);
  player.hand = [itemId];
  player.party[0]!.equipmentId = equipmentId;
  const suspended = dispatch(state, ruleset, {
    protocolVersion: 1,
    gameId: state.gameId,
    commandId: 'e2e-foundation-multi-source-choice-root',
    actorId: 'human-1',
    expectedRevision: 0,
    command: { type: 'USE_ITEM', cardId: itemId },
  });
  if (suspended.error || suspended.state.effectState.pendingChoice?.options.length !== player.party.length) throw new Error('Failed to create pending multi-source foundation card choice.');
  return JSON.stringify({ schemaVersion: 3, snapshot: serializeSnapshot(suspended.state), events: [] });
}

async function installPendingFoundationMultiSourceChoice(page: import('@playwright/test').Page): Promise<void> {
  const save = pendingFoundationMultiSourceChoiceSave();
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: localSaveKey, value: save });
}

test('fresh desktop entry explains the new expedition and starts a persisted game', async ({ page }) => {
  await page.goto('/');
  const entry = page.getByTestId('expedition-entry');
  await expect(entry.getByRole('heading', { name: '準備新的遠征' })).toBeFocused();
  await expect(entry.getByTestId('expedition-summary')).toContainText('第 1 輪 · 行動一階段');
  await expect(entry.getByTestId('expedition-summary')).toContainText('完整紀錄');
  await expect(page.getByTestId('game-app')).toHaveCount(0);
  await entry.getByRole('button', { name: '開始新遠征' }).click();
  await expect(page.getByTestId('game-app')).toBeVisible();
  await expect(page.getByTestId('player-summary')).toContainText('你的公會');
  await expect(page.getByTestId('human-card-count')).toContainText('手牌 5');
  await expect(page.getByTestId('hand').getByRole('button')).toHaveCount(5);
  await expect(page.getByTestId('end-phase')).toBeEnabled();
  await expect(page.getByTestId('interaction-hint')).toContainText('可操作');
  await expect(page.getByTestId('save-status')).toHaveText('本機：已保存');
});

test('explicit helper composition reaches PlayerView and persisted Snapshot identity', async ({ page }) => {
  await openGame(page, '/?e2eScenario=optional-helper');
  await expect(page.getByRole('heading', { name: '隊伍（6/6）' })).toBeVisible();
  await expect(page.getByTestId('helper-panel')).toContainText('候選協助者 08');
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('guildmaster-mvp-save-v2')!));
  expect(persisted.snapshot.rulesModules).toEqual([
    expect.objectContaining({ id: 'base:rules' }),
    expect.objectContaining({
      id: 'base:helpers',
      version: '1.0.0',
      compositionFingerprint: expect.any(String),
    }),
  ]);
  expect(persisted.snapshot.state.moduleState['base:helpers']).toEqual({ schemaVersion: 1 });
  expect(persisted.snapshot.state.zones['base:helper-deck'].visibility).toBe('hidden');
});

test('helper 08 rotates after a boss and discards the rightmost overflow member atomically across reload', async ({ page }) => {
  await openGame(page, '/?e2eScenario=optional-helper');
  await expect(page.getByRole('heading', { name: '隊伍（6/6）' })).toBeVisible();
  const initial = await page.evaluate(() => JSON.parse(localStorage.getItem('guildmaster-mvp-save-v2')!));
  const expectedAdventurerId = initial.snapshot.state.players[0].party.at(-1).adventurerId as string;
  const equipment = page.getByTestId('hand').locator('[data-card-type="equipment"]');
  await expect(equipment).toHaveCount(1);
  const expectedEquipmentId = await equipment.getAttribute('data-card-instance-id');
  expect(expectedEquipmentId).toBeTruthy();
  await equipment.click();
  await page.getByTestId('card-details').getByRole('button', { name: '選擇配戴對象', exact: true }).click();
  const rightmostMember = page.locator('[data-card-state="target"]').last();
  await expect(rightmostMember).toHaveAttribute('data-card-instance-id', expectedAdventurerId);
  await rightmostMember.click();
  await page.getByTestId('card-details').getByRole('button', { name: '配戴至此隊員', exact: true }).click();
  await page.getByTestId('end-phase').click();
  const boss = page.locator('[data-zone-id="base:boss-row"] [data-legal-action="true"]').first();
  await runCardAction(page, boss, '討伐');
  await expect(page.getByRole('heading', { name: '隊伍（5/5）' })).toBeVisible();
  await expect(page.getByTestId('helper-panel')).toContainText('候選協助者 01');
  await expect(page.getByTestId('helper-panel')).toContainText('已離場 1 張');
  await expect(page.locator('.log')).toContainText('隊伍上限降低');
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('guildmaster-mvp-save-v2')!));
  expect(persisted.snapshot.state.players[0].discardPile.slice(-2)).toEqual([expectedAdventurerId, expectedEquipmentId]);
  expect(persisted.replayBundle).toBeDefined();
  const replay = replayGame(persisted.replayBundle, createWebRuleset('optional-helper'));
  expect(replay).toMatchObject({ status: 'completed', finalSnapshot: persisted.snapshot });
  await page.reload();
  await enterGame(page);
  await expect(page.getByRole('heading', { name: '隊伍（5/5）' })).toBeVisible();
  await expect(page.getByTestId('helper-panel')).toContainText('已離場 1 張');
});

test('provisional foundation mode is explicit, visibly limited, and restored by content fingerprint', async ({ page }) => {
  await page.goto('/');
  const entry = page.getByTestId('expedition-entry');
  const provisional = entry.getByRole('radio', { name: /基礎候選數值測試/ });
  await expect(provisional).not.toBeChecked();
  await provisional.check();
  await expect(entry.getByText(/內部測試模式：卡牌名稱使用中性代號/)).toBeVisible();
  await entry.getByRole('button', { name: '開始新遠征' }).click();

  await expect(page.getByTestId('provisional-content-warning')).toContainText('已接入首批物資與十項卡牌效果');
  await expect(page.getByText('基礎候選數值測試 · 單機人機對戰')).toBeVisible();
  const persistedPackId = await page.evaluate(() => JSON.parse(localStorage.getItem('guildmaster-mvp-save-v2')!).snapshot.contentPacks[0].id);
  expect(persistedPackId).toBe('base:provisional-foundation');

  await page.reload();
  await expect(page.getByRole('heading', { name: '繼續晨星遠征' })).toBeFocused();
  await expect(page.getByTestId('expedition-summary')).toContainText('基礎候選數值測試');
  await expect(page.getByRole('radio', { name: /基礎候選數值測試/ })).toBeChecked();
});

test('helper advanced rules are provisional-only and restore from pack/module identity', async ({ page }) => {
  await page.goto('/');
  const entry = page.getByTestId('expedition-entry');
  await expect(entry.getByRole('checkbox', { name: /協助者進階規則/ })).toHaveCount(0);
  await entry.getByRole('radio', { name: /基礎候選數值測試/ }).check();
  const helpers = entry.getByRole('checkbox', { name: /協助者進階規則/ });
  await helpers.check();
  await entry.getByRole('button', { name: '開始新遠征' }).click();
  await expect(page.getByTestId('helper-panel')).toBeVisible();
  await expect(page.getByTestId('provisional-content-warning')).toContainText('協助者 08 效果已啟用');
  await page.reload();
  await expect(page.getByTestId('expedition-summary')).toContainText('協助者');
  await expect(page.getByRole('checkbox', { name: /協助者進階規則/ })).toBeChecked();
});

test('local save status moves from saved to restored without changing the authoritative revision', async ({ page }) => {
  await openGame(page);
  await page.getByTestId('end-phase').click();
  await expect(page.getByTestId('save-status')).toHaveText('本機：已保存');
  await expect(page.getByText('版本 1')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: '繼續晨星遠征' })).toBeFocused();
  await expect(page.getByTestId('expedition-summary')).toContainText('修訂1');
  const saveBeforeContinue = await page.evaluate(() => localStorage.getItem('guildmaster-mvp-save-v2'));
  await enterGame(page);
  expect(await page.evaluate(() => localStorage.getItem('guildmaster-mvp-save-v2'))).toBe(saveBeforeContinue);
  await expect(page.getByTestId('save-status')).toHaveText('本機：已恢復本機進度');
  await expect(page.getByTestId('restore-notice')).toHaveText('已恢復最近的本機進度。');
  await expect(page.getByText('版本 1')).toBeVisible();
  await expect(page.getByTestId('end-phase')).toBeEnabled();
});

test('restored entry requires confirmation before replacing the saved expedition', async ({ page }) => {
  await openGame(page);
  await page.getByTestId('end-phase').click();
  const priorGameId = await page.evaluate(() => JSON.parse(localStorage.getItem('guildmaster-mvp-save-v2')!).snapshot.state.gameId);
  await page.reload();

  const entry = page.getByTestId('expedition-entry');
  await entry.getByRole('radio', { name: /基礎候選數值測試/ }).check();
  const startNew = entry.getByRole('button', { name: '開啟新遠征' });
  const saveBeforeConfirmation = await page.evaluate(() => localStorage.getItem('guildmaster-mvp-save-v2'));
  await startNew.click();
  const confirm = entry.getByRole('button', { name: '確認開啟新遠征' });
  await expect(entry.getByText(/會被「基礎候選數值測試 · 協助者關閉」新對局覆蓋/)).toBeVisible();
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  await expect(startNew).toBeFocused();

  await startNew.click();
  await entry.getByRole('button', { name: '保留目前進度' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(startNew).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem('guildmaster-mvp-save-v2'))).toBe(saveBeforeConfirmation);

  await startNew.click();
  await entry.getByRole('button', { name: '確認開啟新遠征' }).click();
  await expect(page.getByText('版本 0')).toBeVisible();
  await expect(page.getByTestId('interaction-hint')).toBeFocused();
  const restarted = await page.evaluate(() => JSON.parse(localStorage.getItem('guildmaster-mvp-save-v2')!));
  expect(restarted.snapshot.state).toMatchObject({ revision: 0, eventLogCursor: 0 });
  expect(restarted.snapshot.contentPacks[0].id).toBe('base:provisional-foundation');
  expect(restarted.snapshot.state.gameId).not.toBe(priorGameId);
  expect(restarted.events).toEqual([]);
  expect(restarted.replayBundle.commands).toEqual([]);
});

test('storage read failure is explained at entry and still allows memory-only play', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Storage unavailable', 'SecurityError');
      },
    });
  });
  await page.goto('/');

  const entry = page.getByTestId('expedition-entry');
  await expect(entry.getByTestId('entry-storage-warning')).toHaveText(
    '本機儲存目前不可用；仍可遊玩，但進度只會保留在此分頁。',
  );
  await entry.getByRole('button', { name: '開始新遠征' }).click();
  await expect(page.getByTestId('game-app')).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveText('本機：僅保留在此分頁');
  await expect(page.getByTestId('storage-warning')).toContainText('最新進度只保留在此分頁');
});

test('empty adventurer and item supplies show approved copy while monsters remain full', async ({ page }) => {
  await openGame(page, '/?e2eScenario=empty-partial-supplies');
  await expect(page.getByText('目前沒有冒險者可以雇用')).toBeVisible();
  await expect(page.getByText('目前沒有道具、裝備可以販售')).toBeVisible();
  const monsterRow = page.locator('section').filter({ has: page.getByRole('heading', { name: /魔物區/ }) });
  await expect(monsterRow.getByRole('button')).toHaveCount(3);
  await expect(monsterRow).not.toContainText(/沒有|耗盡/);
  await expect(page.getByTestId('end-phase')).toBeEnabled();
});

test('lifecycle choice uses the dock, keeps cards inspectable, and commits once', async ({ page }) => {
  await openGame(page, '/?e2eScenario=lifecycle-choice');
  const card = page.getByTestId('hand').getByRole('button').first();
  await card.click();
  await expect(page.getByTestId('card-details')).toBeVisible();
  await page.getByTestId('end-phase').evaluate((button: HTMLButtonElement) => button.click());

  const dock = page.getByTestId('lifecycle-dock');
  await expect(dock).toContainText('請選擇如何繼續');
  await expect(page.getByTestId('card-details')).not.toBeVisible();
  await expect(dock.getByRole('heading')).toBeFocused();
  await expect(page.getByTestId('end-phase')).toBeDisabled();

  await card.click();
  await expect(page.getByTestId('card-details')).toBeVisible();
  await page.getByRole('button', { name: '關閉卡牌詳情' }).click();
  await expect(card).toBeFocused();

  const continueAction = dock.getByRole('button', { name: '繼續', exact: true });
  await continueAction.focus();
  await continueAction.press('Enter');
  await expect(page.getByText('版本 1')).toBeVisible();
  await expect(page.getByTestId('phase-status')).toContainText('準備行動');
  await expect(dock).toHaveCount(0);
  await expect(page.getByTestId('interaction-hint')).toBeFocused();

  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), localSaveKey);
  expect(saved.snapshot.state.revision).toBe(1);
  expect(saved.snapshot.state.eventLogCursor).toBe(saved.events.length);
  expect(new Set(saved.events.map((event: { eventId: string }) => event.eventId)).size).toBe(saved.events.length);
});

test('provisional card choice survives restore and shows visible card names instead of instance IDs', async ({ page }) => {
  await installPendingFoundationCardChoice(page);
  await openGame(page);

  const dock = page.getByTestId('lifecycle-dock');
  await expect(dock).toContainText('選擇要棄置的手牌');
  const visibleCard = dock.getByRole('button', { name: '候選起始資源 A' }).first();
  await expect(visibleCard).toBeVisible();
  await expect(dock).not.toContainText('base:starter');
  await visibleCard.click();

  await expect(dock).toHaveCount(0);
  await expect(page.getByText('版本 1')).toBeVisible();
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), localSaveKey);
  expect(saved.snapshot.state.effectState.pendingCommand).toBeUndefined();
  expect(saved.snapshot.state.effectState.pendingChoice).toBeUndefined();
  expect(saved.snapshot.state.eventLogCursor).toBe(saved.events.length);

  await page.reload();
  await enterGame(page);
  await expect(page.getByText('版本 1')).toBeVisible();
  await expect(page.getByTestId('lifecycle-dock')).toHaveCount(0);
});

test('filtered provisional card choice exposes only matching visible cards', async ({ page }) => {
  await installPendingFoundationFilteredChoice(page);
  await openGame(page);

  const dock = page.getByTestId('lifecycle-dock');
  await expect(dock).toContainText('選擇要取回的裝備');
  await expect(dock.getByRole('button')).toHaveCount(1);
  const equipment = dock.getByRole('button', { name: '候選物資 02' });
  await expect(equipment).toBeVisible();
  await equipment.click();

  await expect(dock).toHaveCount(0);
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), localSaveKey);
  const cards = saved.snapshot.state.cards as Record<string, { definitionId: string }>;
  const equipmentId = Object.entries(cards).find(([, { definitionId }]) => definitionId === 'base:resource/resource-02')![0];
  const adventurerId = saved.snapshot.state.players[0].discardPile.find((cardId: string) => cards[cardId]?.definitionId.startsWith('base:adventurer/'));
  expect(saved.snapshot.state.players[0].hand).toContain(equipmentId);
  expect(saved.snapshot.state.players[0].discardPile).toContain(adventurerId);
  expect(saved.snapshot.state.revision).toBe(1);
});

test('multi-source provisional choice removes a party member and discards attached equipment', async ({ page }) => {
  await installPendingFoundationMultiSourceChoice(page);
  await openGame(page);

  const dock = page.getByTestId('lifecycle-dock');
  await expect(dock).toContainText('選擇要移除的卡牌');
  const firstPartyOption = dock.getByRole('button').first();
  await expect(firstPartyOption).toBeVisible();
  await firstPartyOption.click();

  await expect(dock).toHaveCount(0);
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), localSaveKey);
  const cards = saved.snapshot.state.cards as Record<string, { definitionId: string }>;
  const equipmentId = Object.entries(cards).find(([, { definitionId }]) => definitionId === 'base:resource/resource-02')![0];
  expect(saved.snapshot.state.removedCards.length).toBeGreaterThan(0);
  expect(saved.snapshot.state.players[0].discardPile).toContain(equipmentId);
  expect(saved.snapshot.state.players[0].party).toHaveLength(4);
  expect(saved.snapshot.state.revision).toBe(1);
});

test('counter consent survives reload, hides the counter value, and accepts through the dock', async ({ page }) => {
  await installPendingConsent(page, 'ai-1');
  await openGame(page, '/?e2eScenario=lifecycle-consent');

  const dock = page.getByTestId('lifecycle-dock');
  await expect(dock).toContainText('星塵 AI 要求公開');
  await expect(dock).toContainText('你');
  await expect(page.getByText('73', { exact: true })).toHaveCount(0);
  await expect(dock.getByRole('button', { name: '同意公開' })).toBeVisible();
  await expect(dock.getByRole('button', { name: '不同意' })).toBeVisible();
  await expect(dock.getByRole('button', { name: '依規則結束等待' })).toBeVisible();
  await expect(dock.getByRole('button', { name: '取消公開請求' })).toHaveCount(0);

  await page.reload();
  await enterGame(page);
  await expect(dock).toContainText('星塵 AI 要求公開');
  await dock.getByRole('button', { name: '同意公開' }).click();
  await expect(dock).toContainText('ALL_REQUIRED_ACTORS_ACCEPTED');
  await expect(page.getByText('版本 1')).toBeVisible();

  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), localSaveKey);
  expect(saved.snapshot.state.revision).toBe(1);
  expect(saved.snapshot.state.eventLogCursor).toBe(saved.events.length);
  expect(saved.events.every((event: { causedByCommandId?: string }) => event.causedByCommandId === 'e2e-consent-root-ai-1')).toBe(true);
});

test('decline confirmation is reversible with Escape and commits only after confirmation', async ({ page }) => {
  await installPendingConsent(page, 'ai-1');
  await openGame(page, '/?e2eScenario=lifecycle-consent');
  const dock = page.getByTestId('lifecycle-dock');

  await dock.getByRole('button', { name: '不同意', exact: true }).click();
  await expect(dock.getByRole('button', { name: '確認不同意' })).toBeFocused();
  await dock.press('Escape');
  await expect(dock.getByRole('button', { name: '確認不同意' })).toHaveCount(0);
  await expect(dock.getByRole('button', { name: '不同意', exact: true })).toBeFocused();
  await dock.getByRole('button', { name: '不同意', exact: true }).click();
  await dock.getByRole('button', { name: '確認不同意' }).click();
  await expect(dock).toContainText('REQUIRED_ACTOR_DECLINED');
  await expect(page.getByText('版本 1')).toBeVisible();
});

test('requester can cancel but cannot answer their own counter consent', async ({ page }) => {
  await installPendingConsent(page, 'human-1');
  await openGame(page, '/?e2eScenario=lifecycle-consent');
  const dock = page.getByTestId('lifecycle-dock');

  await expect(dock.getByRole('button', { name: '同意公開' })).toHaveCount(0);
  await expect(dock.getByRole('button', { name: '不同意' })).toHaveCount(0);
  await dock.getByRole('button', { name: '取消公開請求' }).click();
  await dock.getByRole('button', { name: '確認取消公開請求' }).click();
  await expect(dock).toContainText('REQUESTER_CANCELLED');
  await expect(page.getByText('版本 1')).toBeVisible();
});

test('explicit expiration uses confirmation without a wall-clock timer and remains mobile-safe', async ({ page }) => {
  await installPendingConsent(page, 'ai-1');
  await page.setViewportSize({ width: 390, height: 844 });
  await openGame(page, '/?e2eScenario=lifecycle-consent');
  const dock = page.getByTestId('lifecycle-dock');

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await dock.getByRole('button', { name: '依規則結束等待' }).click();
  await expect(dock).toContainText('不會啟動或等待倒數計時');
  await dock.getByRole('button', { name: '確認依規則結束等待' }).click();
  await expect(dock).toContainText('REQUEST_EXPIRED');
  await expect(dock).toContainText('不使用倒數計時');
  await expect(page.getByText('版本 1')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('a completed human turn lets the AI finish and returns control to the human', async ({ page }) => {
  await openGame(page);
  const endPhase = page.getByTestId('end-phase');
  for (let phase = 0; phase < 5; phase += 1) await endPhase.click();
  await expect(page.getByText('你的回合')).toBeVisible();
  await expect(endPhase).toBeEnabled();
});

test('unavailable actions show a clear phase-specific hint', async ({ page }) => {
  await openGame(page);
  await page.getByTestId('end-phase').click();
  await expect(page.getByTestId('interaction-hint')).toContainText('討伐階段');
  const unavailable = page.getByTestId('hand').getByRole('button').first();
  await expect(unavailable).toBeEnabled();
  await unavailable.click();
  await expect(page.getByTestId('card-details')).toContainText('目前不可執行');
  await expect(page.getByTestId('card-details').locator('footer .primary')).toHaveCount(0);
});

test('card details support keyboard inspection, Escape, and focus restoration', async ({ page }) => {
  await openGame(page);
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
  await openGame(page, '/?e2eScenario=tagged-card-layout');
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
  await expect(page.getByRole('heading', { name: '準備新的遠征' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('guildmaster-mvp-save-v2'))).toBeNull();
  await page.getByRole('button', { name: '開始新遠征' }).click();
  await expect(page.getByTestId('human-card-count')).toContainText('手牌 5');
  await expect(page.getByTestId('end-phase')).toBeEnabled();
  await expect(page.getByTestId('save-status')).toHaveText('本機：已保存');
});

test('legacy local save restores the persisted phase', async ({ page }) => {
  await openGame(page);
  await page.getByTestId('end-phase').click();
  await page.evaluate(() => {
    const current = JSON.parse(localStorage.getItem('guildmaster-mvp-save-v2')!);
    localStorage.setItem('guildmaster-mvp-snapshot-v1', JSON.stringify(current.snapshot));
    localStorage.setItem('guildmaster-mvp-events-v1', JSON.stringify(current.events));
    localStorage.removeItem('guildmaster-mvp-save-v2');
  });
  await page.reload();
  await expect(page.getByTestId('expedition-summary')).toContainText('舊版存檔 · 紀錄不完整');
  await enterGame(page);
  await expect(page.getByTestId('interaction-hint')).toContainText('討伐階段');
  await expect(page.getByTestId('save-status')).toHaveText('本機：已恢復本機進度');
  await expect(page.getByTestId('restore-notice')).toContainText('沒有完整 Replay history');
});

test('replay runner reports malformed JSON without changing the live game', async ({ page }) => {
  await openGame(page);
  await openReplayDiagnostics(page);
  await page.getByLabel('Replay JSON').fill('{not-json');
  await page.getByTestId('run-replay').click();
  await expect(page.getByTestId('replay-report')).toContainText('Replay JSON 無法解析');
  await expect(page.getByTestId('end-phase')).toBeEnabled();
});

test('replay runner does not expose the current unfinished authoritative game', async ({ page }) => {
  await openGame(page);
  await openReplayDiagnostics(page);
  await page.getByRole('button', { name: '載入已完成對局 Replay' }).click();
  await expect(page.getByTestId('replay-report')).toContainText('只能在對局結束後匯出');
  await expect(page.getByLabel('Replay JSON')).toHaveValue('');
  await expect(page.getByTestId('end-phase')).toBeEnabled();
});

test('replay runner reports the first assertion divergence without changing the live game', async ({ page }) => {
  await openGame(page, '/?e2eScenario=all-bosses-endgame');
  await finishAllBossesGame(page);
  await openReplayDiagnostics(page);
  await page.getByRole('button', { name: '載入已完成對局 Replay' }).click();
  const bundle = JSON.parse(await page.getByLabel('Replay JSON').inputValue());
  bundle.expectedFinalSnapshot.state.rngState += 1;
  await page.getByLabel('Replay JSON').fill(JSON.stringify(bundle));
  await page.getByTestId('run-replay').click();
  await expect(page.getByTestId('replay-report')).toContainText('first divergence $.expectedFinalSnapshot.state.rngState');
  await expect(page.getByRole('heading', { name: '榮譽排名' })).toBeVisible();
});

test('deterministic full-game journey defeats, recruits, rests, restores v4 save, and continues legally', async ({ page }) => {
  await openGame(page);
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
  await expect(page.evaluate(() => JSON.parse(localStorage.getItem('guildmaster-mvp-save-v2')!).schemaVersion)).resolves.toBe(4);

  await page.reload();
  await expect(page.getByRole('heading', { name: '繼續晨星遠征' })).toBeVisible();
  await enterGame(page);
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
  await openGame(page, '/?e2eScenario=all-bosses-endgame');
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
  await expect(page.getByTestId('viewer-outcome')).toContainText('你的結果：勝利');

  const rows = page.locator('.scoreboard .score-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('#1 你');
  await expect(rows.nth(0)).toContainText('5 榮譽');
  await expect(rows.nth(0)).toContainText('魔王 1／魔物 0');
  await expect(rows.nth(1)).toContainText('#2');
  await expect(rows.nth(1)).toContainText(/\d+ 榮譽/);
  await expect(rows.nth(1)).toContainText('魔王 0');

  await openReplayDiagnostics(page);
  await page.getByRole('button', { name: '載入已完成對局 Replay' }).click();
  await page.getByTestId('run-replay').click();
  await expect(page.getByTestId('replay-report')).toContainText('Replay 完成');

  await page.getByRole('button', { name: '開啟新遠征' }).click();
  await expect(page.getByTestId('game-app')).toBeVisible();
  await expect(page.getByText('版本 0')).toBeVisible();
  await expect(page.locator('.log')).toContainText('等待你的第一個行動。');
  await expect(endPhase).toBeEnabled();
  await openReplayDiagnostics(page);
  await page.getByRole('button', { name: '載入已完成對局 Replay' }).click();
  await expect(page.getByTestId('replay-report')).toContainText('只能在對局結束後匯出');
});

test('scoreboard keeps the memory-only warning when the final save fails', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Storage.prototype, 'setItem', {
      configurable: true,
      value: () => { throw new DOMException('Storage unavailable', 'QuotaExceededError'); },
    });
  });
  await openGame(page, '/?e2eScenario=all-bosses-endgame');
  await finishAllBossesGame(page);
  await expect(page.getByRole('heading', { name: '榮譽排名' })).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveText('本機：僅保留在此分頁');
  await expect(page.getByTestId('storage-warning')).toContainText('重新整理前請勿關閉');
});

test('deterministic all-bonds journey triggers the registered bond end condition through UI play', async ({ page }) => {
  await openGame(page, '/?e2eScenario=all-bonds-endgame');
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
  await openGame(page);
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
  await openGame(page);
  const equipmentInHand = await buyEquipmentIntoHand(page);
  await equipmentInHand.click();
  await page.getByTestId('card-details').getByRole('button', { name: '選擇配戴對象', exact: true }).click();
  await expect(page.locator('[data-card-state="target"]')).toHaveCount(5);
  await expect(page.getByRole('button', { name: '取消配戴' })).toBeVisible();

  await page.getByRole('button', { name: '重新開始' }).click();
  await page.getByRole('button', { name: '確認重新開始' }).click();
  await expect(page.getByText('版本 0')).toBeVisible();
  await expect(page.getByRole('button', { name: '取消配戴' })).toHaveCount(0);
  await expect(page.locator('[data-card-state="target"]')).toHaveCount(0);
  await expect(page.getByTestId('hand').locator('[data-card-type="equipment"]')).toHaveCount(0);
});

test('an authoritative revision invalidates an open details action', async ({ page }) => {
  await openGame(page);
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
  await openGame(page);
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

async function openReplayDiagnostics(page: import('@playwright/test').Page): Promise<void> {
  const diagnostics = page.getByTestId('replay-diagnostics');
  if (await diagnostics.getAttribute('open') === null) {
    await diagnostics.locator('summary').click();
  }
  await expect(diagnostics).toHaveAttribute('open', '');
}
