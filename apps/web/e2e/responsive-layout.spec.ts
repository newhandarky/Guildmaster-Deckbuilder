import { expect, test, type Page } from '@playwright/test';
import { openGame } from './game-entry.js';

const viewportCases = [
  { name: 'minimum phone width', width: 320, height: 568, cardWidth: 112 },
  { name: 'phone portrait', width: 390, height: 844, cardWidth: 112 },
  { name: 'phone landscape', width: 844, height: 390, cardWidth: 112 },
  { name: 'tablet portrait', width: 768, height: 1024, cardWidth: 146 },
  { name: 'tablet landscape', width: 1024, height: 768, cardWidth: 88 },
  { name: 'desktop', width: 1440, height: 900, cardWidth: 86 },
] as const;

for (const viewport of viewportCases) {
  test(`${viewport.name} keeps the single-page table inside the document`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openGame(page);

    await expect(page.getByTestId('game-table-layout')).toBeVisible();
    await expectNoDocumentOverflow(page);
    await expectFixedTableOrder(page);

    const cardBox = await page.getByTestId('hand').getByRole('button').first().boundingBox();
    expect(cardBox?.width).toBeCloseTo(viewport.cardWidth, 0);
    expect((cardBox?.width ?? 0) / (cardBox?.height ?? 1)).toBeCloseTo(63 / 88, 2);

    await expect(page.getByTestId('game-utility-column')).toHaveCount(0);
    await expect(page.getByTestId('activity-rail')).toBeHidden();
    for (const row of await page.locator('.public-card-grid').all()) {
      expect(await row.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await expect(row).not.toHaveCSS('overflow-x', 'auto');
    }
  });
}

test('card rows own compact overflow without widening the page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openGame(page);

  const handRow = page.getByTestId('hand').locator('.card-row');
  expect(await handRow.evaluate((row) => row.scrollWidth > row.clientWidth)).toBe(true);
  await expectNoDocumentOverflow(page);
});

test('card frame stays rectangular with a thin fixed outer border in compact, desktop, and details sizes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openGame(page);
  const compactCard = page.getByTestId('hand').getByRole('button').first();
  await expect(compactCard).toHaveCSS('border-radius', '10px');
  await expect(compactCard).toHaveCSS('border-top-width', '1px');
  expect((await compactCard.boundingBox())?.width).toBeCloseTo(112, 0);

  await page.setViewportSize({ width: 1440, height: 900 });
  const desktopCard = page.getByTestId('hand').getByRole('button').first();
  await expect(desktopCard).toHaveCSS('border-radius', '10px');
  await expect(desktopCard).toHaveCSS('border-top-width', '1px');
  expect((await desktopCard.boundingBox())?.width).toBeCloseTo(86, 0);

  await desktopCard.click();
  const detailsCard = page.locator('.card-details-art');
  await expect(detailsCard).toHaveCSS('border-radius', '10px');
  await expect(detailsCard).toHaveCSS('border-top-width', '1px');
  expect((await detailsCard.boundingBox())?.width).toBeCloseTo(252, 0);
});

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
]) {
  test(`desktop central table stays visible without document overflow at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openGame(page, '/?e2eScenario=optional-helper');

    const playBox = await page.getByTestId('game-play-column').boundingBox();
    const interactionBox = await page.getByTestId('interaction-rail').boundingBox();
    const helperBox = await page.getByTestId('helper-panel').boundingBox();
    const bossBox = await page.locator('[data-zone-id="base:boss-row"]').boundingBox();
    const monsterBox = await page.locator('[data-zone-id="base:monster-row"]').boundingBox();
    const recruitBox = await page.locator('[data-zone-id="base:adventurer-row"]').boundingBox();
    const storeBox = await page.locator('[data-zone-id="base:item-row"]').boundingBox();

    expect(playBox?.width).toBeGreaterThan(1000);
    expect(helperBox?.y).toBeCloseTo(bossBox?.y ?? 0, 0);
    expect(bossBox?.y).toBeCloseTo(monsterBox?.y ?? 0, 0);
    expect(recruitBox?.y).toBeCloseTo(storeBox?.y ?? 0, 0);
    for (const zoneId of ['base:helper-active', 'base:boss-row', 'base:monster-row', 'base:adventurer-row', 'base:item-row']) {
      const row = page.locator(`[data-zone-id="${zoneId}"] .card-row`);
      await expect(row).not.toHaveCSS('overflow-x', 'auto');
      expect(await row.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    }

    for (const row of await page.locator('.card-row:visible').all()) {
      expect(rectanglesOverlap(interactionBox, await row.boundingBox())).toBe(false);
    }
    await expectNoDocumentOverflow(page, true);
  });
}

test('four-player desktop keeps all three opponent summaries around the central table without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await page.getByRole('radio', { name: /基礎版原作衍生 Provisional 測試/ }).check();
  await page.getByRole('button', { name: '開始新遠征' }).click();

  await expect(page.locator('.player-seat-cluster')).toHaveCount(3);
  await expect(page.locator('.seat-0')).toBeVisible();
  await expect(page.locator('.seat-1')).toBeVisible();
  await expect(page.locator('.seat-2')).toBeVisible();
  await expectNoDocumentOverflow(page, true);
});

test('utility drawer overlays the table, preserves its width, and restores trigger focus on Escape', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openGame(page);
  const playColumn = page.getByTestId('game-play-column');
  const before = await playColumn.boundingBox();
  const events = page.getByRole('button', { name: '事件', exact: true });
  await events.click();
  await expect(page.getByTestId('utility-drawer')).toBeVisible();
  await expect(page.getByTestId('activity-rail')).toBeVisible();
  const during = await playColumn.boundingBox();
  expect(during?.width).toBeCloseTo(before?.width ?? 0, 0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('utility-drawer')).toHaveCount(0);
  await expect(events).toBeFocused();
});

test('required lifecycle interaction closes an open utility drawer and stays actionable', async ({ page }) => {
  await openGame(page, '/?e2eScenario=lifecycle-choice');
  await page.getByRole('button', { name: '事件', exact: true }).click();
  await expect(page.getByTestId('utility-drawer')).toBeVisible();
  await page.getByTestId('end-phase').evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByTestId('utility-drawer')).toHaveCount(0);
  await expect(page.getByTestId('lifecycle-dock').getByRole('button', { name: '繼續', exact: true })).toBeVisible();
});

test('Replay diagnostics are collapsed by default and keyboard operable', async ({ page }) => {
  await openGame(page);
  await page.getByRole('button', { name: '更多', exact: true }).click();
  const diagnostics = page.getByTestId('replay-diagnostics');
  const summary = diagnostics.locator('summary');

  await expect(diagnostics).not.toHaveAttribute('open', '');
  await expect(page.getByLabel('Replay JSON')).not.toBeVisible();
  await summary.focus();
  await summary.press('Enter');
  await expect(diagnostics).toHaveAttribute('open', '');
  await expect(page.getByLabel('Replay JSON')).toBeVisible();
  await summary.press('Enter');
  await expect(diagnostics).not.toHaveAttribute('open', '');
});

test('card details use a bottom sheet in portrait and a side sheet in landscape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openGame(page);
  await page.getByTestId('hand').getByRole('button').first().click();

  const portraitBox = await page.getByRole('dialog').boundingBox();
  expect(portraitBox?.width).toBeCloseTo(390, 0);
  expect((portraitBox?.y ?? 0) + (portraitBox?.height ?? 0)).toBeCloseTo(844, 0);
  await page.getByRole('button', { name: '關閉卡牌詳情' }).click();

  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByTestId('hand').getByRole('button').first().click();
  const landscapeBox = await page.getByRole('dialog').boundingBox();
  expect((landscapeBox?.x ?? 0) + (landscapeBox?.width ?? 0)).toBeCloseTo(844, 0);
  expect(landscapeBox?.height).toBeCloseTo(390, 0);
  expect(landscapeBox?.width).toBeLessThan(844);
});

test('encounter and tavern areas stay simultaneously visible without tab semantics or game mutations', async ({ page }) => {
  await openGame(page);
  const snapshotBefore = await page.evaluate(() => localStorage.getItem('guildmaster-mvp-save-v2'));

  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('tabpanel')).toHaveCount(0);
  await expect(page.getByTestId('encounter-area')).toBeVisible();
  await expect(page.getByTestId('tavern-area')).toBeVisible();
  await expect(page.locator('[data-zone-id="base:boss-row"]')).toBeVisible();
  await expect(page.locator('[data-zone-id="base:monster-row"]')).toBeVisible();
  await expect(page.locator('[data-zone-id="base:adventurer-row"]')).toBeVisible();
  await expect(page.locator('[data-zone-id="base:item-row"]')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('guildmaster-mvp-save-v2'))).toBe(snapshotBefore);
});

for (const viewport of [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 844, height: 500 },
]) {
  test(`card details keep header, scrolling body, and footer separate at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openGame(page);
    await page.getByTestId('hand').getByRole('button').first().click();

    const dialog = page.getByRole('dialog');
    const header = dialog.locator('.card-details-header');
    const body = dialog.locator('.card-details-body');
    const footer = dialog.locator('.card-details-footer');
    const [dialogBox, headerBox, bodyBox, footerBox] = await Promise.all([
      dialog.boundingBox(),
      header.boundingBox(),
      body.boundingBox(),
      footer.boundingBox(),
    ]);

    expect(headerBox?.y).toBeGreaterThanOrEqual(dialogBox?.y ?? 0);
    expect((headerBox?.y ?? 0) + (headerBox?.height ?? 0)).toBeLessThanOrEqual((bodyBox?.y ?? 0) + 1);
    expect((bodyBox?.y ?? 0) + (bodyBox?.height ?? 0)).toBeLessThanOrEqual((footerBox?.y ?? 0) + 1);
    expect((footerBox?.y ?? 0) + (footerBox?.height ?? 0)).toBeLessThanOrEqual((dialogBox?.y ?? 0) + (dialogBox?.height ?? 0) + 1);
    await expect(body).toHaveCSS('overflow-y', 'auto');

    if (viewport.width < 768 && viewport.height >= 500) {
      expect(dialogBox?.width).toBeCloseTo(viewport.width, 0);
      expect((dialogBox?.y ?? 0) + (dialogBox?.height ?? 0)).toBeCloseTo(viewport.height, 0);
    } else {
      expect((dialogBox?.x ?? 0) + (dialogBox?.width ?? 0)).toBeCloseTo(viewport.width, 0);
    }

    for (const button of await footer.getByRole('button').all()) {
      const buttonBox = await button.boundingBox();
      expect(buttonBox?.width).toBeGreaterThanOrEqual(44);
      expect(buttonBox?.height).toBeGreaterThanOrEqual(44);
      expect((buttonBox?.x ?? 0) + (buttonBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 1);
    }
    await expectNoDocumentOverflow(page);
  });
}

test('low-height lifecycle interaction remains reachable without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await openGame(page, '/?e2eScenario=lifecycle-choice');
  await page.getByTestId('end-phase').evaluate((button: HTMLButtonElement) => button.click());

  const rail = page.getByTestId('interaction-rail');
  const dock = page.getByTestId('lifecycle-dock');
  await expect(dock.getByRole('button', { name: '繼續', exact: true })).toBeVisible();
  await rail.scrollIntoViewIfNeeded();
  const railBox = await rail.boundingBox();
  expect(railBox?.height).toBeLessThanOrEqual(390);
  expect((railBox?.y ?? 0) + (railBox?.height ?? 0)).toBeLessThanOrEqual(390);
  await expectNoDocumentOverflow(page);
});

async function expectNoDocumentOverflow(page: Page, includeVertical = false): Promise<void> {
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clientHeight: document.documentElement.clientHeight,
    scrollHeight: document.documentElement.scrollHeight,
    offenders: Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
      .slice(0, 8)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        id: element.id,
        className: element.className,
        right: Math.round(element.getBoundingClientRect().right),
        width: Math.round(element.getBoundingClientRect().width),
      })),
  }));
  expect(overflow.scrollWidth, JSON.stringify(overflow.offenders)).toBeLessThanOrEqual(overflow.clientWidth);
  if (includeVertical) expect(overflow.scrollHeight).toBeLessThanOrEqual(overflow.clientHeight + 1);
}

function rectanglesOverlap(
  left: { x: number; y: number; width: number; height: number } | null,
  right: { x: number; y: number; width: number; height: number } | null,
): boolean {
  if (!left || !right) return true;
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

async function expectFixedTableOrder(page: Page): Promise<void> {
  const selectors = [
    '[data-testid="public-table"]',
    '[data-testid="guild-area"]',
    '[data-testid="interaction-rail"]',
    '[data-testid="utility-tools"]',
  ];
  const ordered = await page.locator(selectors.join(',')).evaluateAll((elements) =>
    elements.every((element, index) =>
      index === 0
      || Boolean(elements[index - 1]?.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
    ),
  );
  expect(ordered).toBe(true);
}
