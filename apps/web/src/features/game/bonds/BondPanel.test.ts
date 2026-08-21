import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BondPanel } from './BondPanel.js';

describe('BondPanel', () => {
  it('renders an accessible expandable list with all presentation summaries and authoritative completion state', () => {
    const bonds = [
      { bondId: 'b1', completed: false },
      { bondId: 'b2', completed: false },
      { bondId: 'b3', completed: true },
      { bondId: 'b4', completed: false },
      { bondId: 'b5', completed: false },
    ];
    const definitions = bonds.map(({ bondId }, index) => ({ id: bondId, name: `羈絆 ${index + 1}`, honor: index + 2, conditionSummary: `真實條件摘要 ${index + 1}` }));
    const evaluations = bonds.map(({ bondId }, index) => ({ bondId, satisfied: index === 1 || index === 2, appliedRules: [{ moduleId: 'test:bonds', ruleId: `${bondId}-condition` }] }));
    const markup = renderToStaticMarkup(createElement(BondPanel, { bonds, definitions, evaluations, completableBondIds: ['b2'] }));

    expect(markup).toContain('我的羈絆 1/5');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('hidden=""');
    expect(markup.match(/真實條件摘要/g)).toHaveLength(5);
    expect(markup).toContain('2 榮譽 · 未完成');
    expect(markup).toContain('3 榮譽 · 當下可完成');
    expect(markup).toContain('4 榮譽 · 已完成');
    expect(markup).not.toContain('99');
    expect(markup).not.toContain('requiredBosses');
  });
});
