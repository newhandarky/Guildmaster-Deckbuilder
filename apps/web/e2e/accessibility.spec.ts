import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openGame, openNewExpeditionSetup } from './game-entry.js';

async function expectNoAccessibilityViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      targets: nodes.map(({ target }) => target.join(' ')),
    })),
  ).toEqual([]);
}

test('main game table meets automated WCAG A/AA checks', async ({ page }) => {
  await openGame(page);
  await expect(page.getByTestId('game-app')).toBeVisible();
  await expect(page.locator('.card[aria-label*="購買力"], .card[aria-label*="費用"], .card[aria-label*="戰力"]').first()).toBeVisible();
  await expectNoAccessibilityViolations(page);
});

test('desktop expedition entry meets automated WCAG A/AA checks and focuses its heading', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '準備新的遠征' })).toBeFocused();
  await expect(page.getByRole('button', { name: '開始新遠征' })).toBeVisible();
  await expectNoAccessibilityViolations(page);
});

test('desktop keyboard path reaches an exact card action and restores focus after dispatch', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openGame(page);
  const endPhase = page.getByTestId('end-phase');

  await tabUntilFocused(page, 'Tab', endPhase);
  await endPhase.press('Enter');
  await expect(page.getByTestId('interaction-hint')).toContainText('討伐階段');

  const monsterRow = page.locator('section').filter({ has: page.getByRole('heading', { name: /魔物區/ }) });
  const legalMonster = monsterRow.locator('[data-legal-action="true"]').first();
  await expect(legalMonster).toHaveAttribute('aria-label', /動作：討伐/);
  await tabUntilFocused(page, 'Shift+Tab', legalMonster);
  await legalMonster.press('Space');

  const action = page.getByTestId('card-details').getByRole('button', { name: '討伐', exact: true });
  await tabUntilFocused(page, 'Tab', action);
  await action.press('Space');
  await expect(page.getByTestId('interaction-hint')).toBeFocused();
  await page.getByRole('button', { name: '事件', exact: true }).click();
  await expect(page.locator('.log')).toContainText('討伐了');
});

test('scoreboard uses list semantics and hands focus to the new-expedition flow', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openGame(page, '/?e2eScenario=all-bosses-endgame');
  const endPhase = page.getByTestId('end-phase');
  await endPhase.click();
  const bossRow = page.locator('section').filter({ has: page.getByRole('heading', { name: /魔王/ }) });
  await bossRow.locator('[data-legal-action="true"]').first().click();
  await page.getByTestId('card-details').getByRole('button', { name: '討伐', exact: true }).click();
  for (let phase = 0; phase < 4; phase += 1) await endPhase.click();

  const ranking = page.getByRole('list', { name: '榮譽排名' });
  await expect(ranking.getByRole('listitem')).toHaveCount(2);
  const newExpedition = page.getByRole('button', { name: '開啟新遠征' });
  await expect(newExpedition).toBeFocused();
  await newExpedition.press('Enter');
  await expect(page.getByText('版本 0')).toBeVisible();
  await expect(page.getByTestId('interaction-hint')).toBeFocused();
});

test('card details meet automated WCAG A/AA checks', async ({ page }) => {
  await openGame(page);
  await page.getByTestId('hand').getByRole('button').first().click();
  await expect(page.getByTestId('card-details')).toBeVisible();
  await expectNoAccessibilityViolations(page);
});

test('pending lifecycle panel meets automated WCAG A/AA checks', async ({ page }) => {
  await openGame(page, '/?e2eScenario=lifecycle-choice');
  await page.getByTestId('end-phase').evaluate((button: HTMLButtonElement) => button.click());
  const lifecycleDock = page.getByTestId('lifecycle-dock');
  await expect(lifecycleDock).toBeVisible();
  await expect(lifecycleDock).toContainText('你仍可查看卡片');
  await expect(page.getByTestId('end-phase')).toBeDisabled();
  await page.getByTestId('hand').getByRole('button').first().click();
  await expect(page.locator('.card-details-dialog')).toBeVisible();
  await page.getByRole('button', { name: '關閉卡牌詳情' }).click();
  await expectNoAccessibilityViolations(page);
});

test('bond setup is a focus-contained modal blocking choice', async ({ page }) => {
  await page.goto('/');
  await openNewExpeditionSetup(page);
  await page.getByRole('radio', { name: /基礎完整牌組/ }).check();
  await page.getByRole('button', { name: '開始新遠征' }).click();

  const setup = page.getByRole('dialog', { name: '從七張私人羈絆保留五張' });
  await expect(setup).toBeVisible();
  await expect.poll(() => setup.evaluate((dialog: HTMLDialogElement) => dialog.matches(':modal'))).toBe(true);
  await expect(setup.getByRole('heading', { name: '從七張私人羈絆保留五張' })).toBeFocused();
  const backgroundEndPhase = page.getByTestId('end-phase');
  await backgroundEndPhase.evaluate((button: HTMLButtonElement) => button.focus());
  await expect(backgroundEndPhase).not.toBeFocused();
  for (let index = 0; index < 16; index += 1) {
    await page.keyboard.press(index % 2 === 0 ? 'Tab' : 'Shift+Tab');
    await expect.poll(() => setup.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
  }
  await expectNoAccessibilityViolations(page);
});

test('expanded Replay diagnostics meet automated WCAG A/AA checks', async ({ page }) => {
  await openGame(page);
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByTestId('replay-diagnostics').getByText('Replay 診斷（開發工具）').click();
  await expect(page.getByTestId('replay-runner')).toBeVisible();
  await expectNoAccessibilityViolations(page);
});

test('skip link reaches the primary table and primary controls expose visible focus', async ({ page }) => {
  await openGame(page);
  const skipLink = page.getByRole('link', { name: '跳到主要牌桌' });
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('game-play-column')).toBeFocused();

  const endPhase = page.getByTestId('end-phase');
  await endPhase.focus();
  await expect(endPhase).toHaveCSS('outline-style', 'solid');
  await expect(endPhase).toHaveCSS('outline-width', '3px');
});

test('non-modal utility drawer closes from Escape outside the drawer and restores its trigger', async ({ page }) => {
  await openGame(page);
  const eventsTrigger = page.getByRole('button', { name: '事件', exact: true });
  await eventsTrigger.click();
  await expect(page.getByRole('button', { name: '關閉事件' })).toBeFocused();

  await page.getByTestId('end-phase').focus();
  await page.keyboard.press('Escape');

  await expect(page.getByTestId('utility-drawer')).toHaveCount(0);
  await expect(eventsTrigger).toBeFocused();
});

test('restart requires confirmation, Escape restores focus, and the game remains unchanged', async ({ page }) => {
  await openGame(page);
  await page.getByRole('button', { name: '更多', exact: true }).click();
  const restart = page.getByRole('button', { name: '重新開始' });
  await restart.click();
  const confirm = page.getByRole('button', { name: '確認重新開始' });
  await expect(confirm).toBeFocused();
  await expect(page.getByText('重新開始會放棄目前尚未完成的對局。')).toBeVisible();
  await expectNoAccessibilityViolations(page);
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  await expect(restart).toBeFocused();
  await expect(page.getByText('版本 0')).toBeVisible();
});

test('mobile controls meet the 44px target baseline and remain inside the document', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openGame(page);
  const controls = [
    page.getByTestId('end-phase'),
    page.getByRole('button', { name: /我的羈絆/ }),
    page.getByRole('button', { name: '事件', exact: true }),
    page.getByRole('button', { name: 'CPU', exact: true }),
    page.getByRole('button', { name: '更多', exact: true }),
  ];
  for (const control of controls) {
    const box = await control.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole('button', { name: '更多', exact: true }).click();
  const restartBox = await page.getByRole('button', { name: '重新開始' }).boundingBox();
  expect(restartBox?.height).toBeGreaterThanOrEqual(44);
  expect(restartBox?.width).toBeGreaterThanOrEqual(44);
  await page.keyboard.press('Escape');
  await page.getByTestId('hand').getByRole('button').first().click();
  const close = page.getByRole('button', { name: '關閉卡牌詳情' });
  const closeBox = await close.boundingBox();
  expect(closeBox?.height).toBeGreaterThanOrEqual(44);
  expect(closeBox?.width).toBeGreaterThanOrEqual(44);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await page.evaluate(() => localStorage.clear());
  await page.goto('/?e2eScenario=lifecycle-choice');
  await enterGameFromEntry(page);
  await page.getByTestId('end-phase').evaluate((button: HTMLButtonElement) => button.click());
  for (const action of await page.getByTestId('lifecycle-dock').getByRole('button').all()) {
    const box = await action.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }

  await page.goto('/');
  await openNewExpeditionSetup(page);
  for (const option of await page.locator('.content-mode-option').all()) {
    const box = await option.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }
});

test('320px reflow with enlarged text keeps actions and details usable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await openGame(page);
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await expect(page.getByTestId('end-phase')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.getByTestId('hand').getByRole('button').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: '關閉卡牌詳情' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('reduced motion removes card displacement and forced colors preserve state boundaries', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
  await openGame(page);
  const card = page.getByTestId('hand').getByRole('button').first();
  await card.hover();
  await expect(card).toHaveCSS('transform', 'none');
  await expect(card).toHaveCSS('border-style', 'solid');
});

async function tabUntilFocused(page: Page, key: 'Tab' | 'Shift+Tab', target: Locator): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await page.keyboard.press(key);
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error(`Keyboard navigation did not reach target with ${key}.`);
}

async function enterGameFromEntry(page: Page): Promise<void> {
  const entry = page.getByTestId('expedition-entry');
  const continueButton = entry.getByRole('button', { name: '繼續最近進度' });
  if (await continueButton.count()) await continueButton.click();
  else {
    await openNewExpeditionSetup(page);
    await entry.getByRole('button', { name: '開始新遠征', exact: true }).click();
  }
  await expect(page.getByTestId('game-app')).toBeVisible();
}
