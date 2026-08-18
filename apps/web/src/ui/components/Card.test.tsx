import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CardDefinition, CardInstance } from '@guildmaster/game-protocol';
import type { PresentationViewModel } from '@guildmaster/presentation-core';
import { buildCardVisualModel } from '../cards/card-visual-model.js';
import { Card } from './Card.js';

const instance: CardInstance = { id: 'card-1', definitionId: 'demo:adventurer/one' };
const definition: CardDefinition = {
  id: instance.definitionId,
  name: 'mechanics-only',
  type: 'adventurer',
  copies: 1,
  cost: 2,
  combat: 3,
  honor: 4,
  tags: ['profession:ranged'],
  source: 'test',
};
const presentation: PresentationViewModel = {
  definitionId: instance.definitionId,
  displayName: '示範遊俠',
  portraitAssetKey: 'placeholder:one',
  portraitAsset: { key: 'placeholder:one', altText: '示範遊俠 placeholder' },
  shortDisplayText: '從遠方支援隊伍。',
  detailDisplayText: '完整詳情',
  source: 'pack',
};

describe('Card CSS visual contract', () => {
  it('renders the shared appearance, profession, frame, and four accessible SVG corner slots', () => {
    const card = buildCardVisualModel({ instance, definition, presentation, interactionState: 'legal' });
    const markup = renderToStaticMarkup(<Card card={card} onInspect={() => undefined} />);

    expect(markup).toContain('data-card-appearance="adventurer"');
    expect(markup).toContain('data-profession="ranged"');
    expect(markup).toContain('game-card__frame');
    expect(markup.match(/game-card__corner game-card__corner--/g)).toHaveLength(4);
    expect(markup).toContain('aria-label="職業：遠程"');
    expect(markup).toContain('aria-label="印刷戰力 3"');
    expect(markup).not.toMatch(/[⚔🛡◆✦◈]/u);
  });
});
