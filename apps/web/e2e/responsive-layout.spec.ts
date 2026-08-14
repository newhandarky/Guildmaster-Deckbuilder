import { expect, test, type Page } from '@playwright/test';
import { openGame } from './game-entry.js';

const viewportCases = [
  { name: 'phone portrait', width: 390, height: 844, cardWidth: 112 },
  { name: 'phone landscape', width: 844, height: 390, cardWidth: 112 },
  { name: 'tablet portrait', width: 768, height: 1024, cardWidth: 146 },
  { name: 'tablet landscape', width: 1024, height: 768, cardWidth: 146 },
  { name: 'desktop', width: 1440, height: 900, cardWidth: 146 },
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

    if (viewport.width >= 1180) {
      const playBox = await page.getByTestId('game-play-column').boundingBox();
      const activityBox = await page.getByTestId('activity-rail').boundingBox();
      expect(activityBox?.x).toBeGreaterThan((playBox?.x ?? 0) + (playBox?.width ?? 0));
    } else {
      const playBox = await page.getByTestId('game-play-column').boundingBox();
      const activityBox = await page.getByTestId('activity-rail').boundingBox();
      expect(activityBox?.y).toBeGreaterThanOrEqual((playBox?.y ?? 0) + (playBox?.height ?? 0));
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

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
]) {
  test(`desktop utility column keeps controls beside the table without overlap at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openGame(page);

    const playBox = await page.getByTestId('game-play-column').boundingBox();
    const utility = page.getByTestId('game-utility-column');
    const utilityBox = await utility.boundingBox();
    const interactionBox = await page.getByTestId('interaction-rail').boundingBox();
    const activityBox = await page.getByTestId('activity-rail').boundingBox();
    const encounterBox = await page.getByTestId('encounter-area').boundingBox();
    const tavernBox = await page.getByTestId('tavern-area').boundingBox();
    const monsterRow = page.locator('[data-zone-id="base:monster-row"] .card-row');

    expect(utilityBox?.width).toBeCloseTo(320, 0);
    expect(utilityBox?.x).toBeGreaterThan((playBox?.x ?? 0) + (playBox?.width ?? 0));
    expect(tavernBox?.x).toBeGreaterThan((encounterBox?.x ?? 0) + (encounterBox?.width ?? 0));
    expect(encounterBox?.width).toBeCloseTo(tavernBox?.width ?? 0, 0);
    expect(await monsterRow.evaluate((row) => row.scrollWidth <= row.clientWidth)).toBe(true);
    expect(rectanglesOverlap(interactionBox, activityBox)).toBe(false);

    for (const row of await page.locator('.card-row').all()) {
      expect(rectanglesOverlap(interactionBox, await row.boundingBox())).toBe(false);
    }

    await expect(utility).toHaveCSS('position', 'sticky');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const stickyUtilityBox = await utility.boundingBox();
    expect(stickyUtilityBox?.y).toBeCloseTo(16, 0);
    await expectNoDocumentOverflow(page);
  });
}

test('Replay diagnostics are collapsed by default and keyboard operable', async ({ page }) => {
  await openGame(page);
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

async function expectNoDocumentOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
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
    '[data-zone-id="base:boss-row"]',
    '[data-zone-id="base:monster-row"]',
    '[data-zone-id="base:adventurer-row"]',
    '[data-zone-id="base:item-row"]',
    '[data-testid="guild-area"]',
    '[data-testid="interaction-rail"]',
    '[data-testid="activity-rail"]',
  ];
  const ordered = await page.locator(selectors.join(',')).evaluateAll((elements) =>
    elements.every((element, index) =>
      index === 0
      || Boolean(elements[index - 1]?.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
    ),
  );
  expect(ordered).toBe(true);
}
