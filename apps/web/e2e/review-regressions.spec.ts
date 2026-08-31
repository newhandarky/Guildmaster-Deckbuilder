import { expect, test, type Page } from '@playwright/test';
import type { DomainEvent } from '@guildmaster/game-protocol';
import { openGame } from './game-entry.js';

function dieEvent(eventId: string): DomainEvent {
  return {
    eventId, revision: 1, type: 'DIE_ROLLED', message: 'rolled',
    payload: {
      schemaVersion: 1, kind: 'dice-roll',
      evaluation: {
        schemaVersion: 1, face: 6,
        input: { schemaVersion: 1, moduleId: 'base:provisional-original-full-rules', diceId: 'monster-02-reward-d6', randomValue: .99, registry: { rulesetVersion: 'test', modules: [] } },
      },
    },
  };
}

async function publishDiceFeedback(page: Page, event: DomainEvent | undefined, restored = false) {
  // Exercise the production App/feedback boundary without manufacturing a game command.
  await page.evaluate(async ({ event, restored }) => {
    const path = '/src/store/game-store.ts';
    const { useGameStore } = await import(path);
    useGameStore.setState({
      events: event ? [event] : [],
      ...(restored ? { view: { ...useGameStore.getState().view, gameId: 'restored-dice-feedback-fixture' } } : {}),
    });
  }, { event, restored });
}

test('dice feedback ignores restored history and announces only a new settled result', async ({ page }) => {
  await openGame(page);
  await publishDiceFeedback(page, dieEvent('restored-die'), true);
  await expect(page.getByTestId('dice-result-toast')).toHaveCount(0);
  const announcement = page.getByTestId('dice-result-announcement');
  await expect(announcement).toBeEmpty();

  await publishDiceFeedback(page, dieEvent('new-die'));
  const toast = page.getByTestId('dice-result-toast');
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute('aria-hidden', 'true');
  await expect(announcement).toHaveAttribute('aria-live', 'polite');
  await expect(announcement).toBeEmpty();
  // A new object for the same event, or history falling out of the retained log,
  // must not cancel the timer or lose the current result.
  await publishDiceFeedback(page, dieEvent('new-die'));
  await publishDiceFeedback(page, undefined);
  await expect(toast).toHaveAttribute('data-settled', 'true');
  await expect(announcement).toHaveText('擲骰結果：骰面 6，購買力 +3。');
  await expect(toast).toHaveCount(0, { timeout: 6000 });
  await publishDiceFeedback(page, dieEvent('new-die'));
  await expect(toast).toHaveCount(0);
});

test('reduced motion dice feedback shows the committed face immediately', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openGame(page);
  await publishDiceFeedback(page, dieEvent('reduced-die'));
  await expect(page.getByTestId('dice-result-toast')).toHaveAttribute('data-settled', 'true');
  await expect(page.getByTestId('dice-result-announcement')).toHaveText('擲骰結果：骰面 6，購買力 +3。');
});

test('Escape closes discard card details before the containing zones drawer', async ({ page }) => {
  await openGame(page);
  const endPhase = page.getByTestId('end-phase');
  await endPhase.click();
  await endPhase.click();
  await endPhase.click();
  await page.getByTestId('tavern-area').locator('[data-legal-action="true"]').first().click();
  await page.getByTestId('card-details').getByRole('button', { name: /^(購買|招募)$/ }).click();
  await page.getByRole('button', { name: '牌區', exact: true }).click();
  const drawer = page.locator('#utility-drawer-zones');
  const card = drawer.locator('.zone-inspector-cards [data-card-instance-id]').first();
  await card.click();
  await expect(page.locator('.card-details-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.card-details-dialog')).not.toBeVisible();
  await expect(drawer).toBeVisible();
  await expect(card).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(drawer).not.toBeVisible();
  await expect(page.getByRole('button', { name: '牌區', exact: true })).toBeFocused();
});

test('an interrupted card close cannot close a subsequently opened card', async ({ page }) => {
  await openGame(page);
  const cards = page.getByTestId('hand').locator('[data-card-instance-id]');
  await cards.first().click();
  const oldClose = await page.getByRole('button', { name: '關閉卡牌詳情' }).evaluateHandle((button: HTMLButtonElement) => {
    button.click();
    const animation = document.querySelector('.card-details')!.getAnimations()
      .find((candidate) => candidate.effect?.getTiming().duration === 180)!;
    animation.pause();
    return animation;
  });
  await page.keyboard.press('Escape');
  await expect(page.locator('.card-details-dialog')).not.toBeVisible();
  await cards.nth(1).click();
  await expect(page.locator('.card-details-dialog')).toBeVisible();
  // Settle the superseded effect deterministically after opening another card.
  await oldClose.evaluate((animation) => animation.finish());
  await page.waitForTimeout(50);
  await expect(page.locator('.card-details-dialog')).toBeVisible();
  await oldClose.dispose();
  await page.keyboard.press('Escape');
  await expect(cards.nth(1)).toBeFocused();
});
