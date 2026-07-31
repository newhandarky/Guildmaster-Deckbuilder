import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

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
  await page.goto('/');
  await expect(page.getByTestId('game-app')).toBeVisible();
  await expect(page.locator('.card[aria-label*="購買力"], .card[aria-label*="費用"], .card[aria-label*="戰力"]').first()).toBeVisible();
  await expectNoAccessibilityViolations(page);
});

test('card details meet automated WCAG A/AA checks', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('hand').getByRole('button').first().click();
  await expect(page.getByTestId('card-details')).toBeVisible();
  await expectNoAccessibilityViolations(page);
});

test('pending lifecycle panel meets automated WCAG A/AA checks', async ({ page }) => {
  await page.goto('/?e2eScenario=lifecycle-choice');
  await page.getByTestId('end-phase').evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByTestId('lifecycle-dock')).toBeVisible();
  await expectNoAccessibilityViolations(page);
});

test('expanded Replay diagnostics meet automated WCAG A/AA checks', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('replay-diagnostics').getByText('Replay 診斷（開發工具）').click();
  await expect(page.getByTestId('replay-runner')).toBeVisible();
  await expectNoAccessibilityViolations(page);
});

test('skip link reaches the primary table and primary controls expose visible focus', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: '跳到主要牌桌' });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('game-play-column')).toBeFocused();

  const endPhase = page.getByTestId('end-phase');
  await endPhase.focus();
  await expect(endPhase).toHaveCSS('outline-style', 'solid');
  await expect(endPhase).toHaveCSS('outline-width', '3px');
});

test('restart requires confirmation, Escape restores focus, and the game remains unchanged', async ({ page }) => {
  await page.goto('/');
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
  await page.goto('/');
  const controls = [
    page.getByTestId('end-phase'),
    page.getByRole('button', { name: '重新開始' }),
  ];
  for (const control of controls) {
    const box = await control.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }
  await page.getByTestId('hand').getByRole('button').first().click();
  const close = page.getByRole('button', { name: '關閉卡牌詳情' });
  const closeBox = await close.boundingBox();
  expect(closeBox?.height).toBeGreaterThanOrEqual(44);
  expect(closeBox?.width).toBeGreaterThanOrEqual(44);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('320px reflow with enlarged text keeps actions and details usable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/');
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
  await page.goto('/');
  const card = page.getByTestId('hand').getByRole('button').first();
  await card.hover();
  await expect(card).toHaveCSS('transform', 'none');
  await expect(card).toHaveCSS('border-style', 'solid');
});
