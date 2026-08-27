import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BondSetupPanel } from './BondSetupPanel.js';

const bonds = Array.from({ length: 7 }, (_, index) => ({
  id: `base:bond/bond-${String(index + 1).padStart(2, '0')}`,
  name: `候選羈絆 ${String(index + 1).padStart(2, '0')}`,
  honor: index + 2,
  conditionSummary: `可比較的完成條件 ${index + 1}`,
  detailDescription: `完整規則說明 ${index + 1}`,
}));

describe('BondSetupPanel', () => {
  it('shows every offered bond condition before the player commits a selection', () => {
    const markup = renderToStaticMarkup(<BondSetupPanel bonds={bonds} selectedBondIds={[]} onToggle={() => undefined} onConfirm={() => undefined} />);

    expect(markup).toContain('<dialog');
    expect(markup).toContain('已選 <strong>0</strong> / 5');
    expect(markup.match(/可比較的完成條件/g)).toHaveLength(7);
    expect(markup.match(/查看完整規則說明/g)).toHaveLength(7);
    expect(markup).toContain('完整規則說明 7');
    expect(markup).toContain('還需要選擇 5 張');
    expect(markup).toContain('disabled=""');
  });

  it('keeps selected bonds removable and disables only unselected bonds after five selections', () => {
    const selectedBondIds = bonds.slice(0, 5).map(({ id }) => id);
    const markup = renderToStaticMarkup(<BondSetupPanel bonds={bonds} selectedBondIds={selectedBondIds} onToggle={() => undefined} onConfirm={() => undefined} />);

    expect(markup).toContain('已選 <strong>5</strong> / 5');
    expect(markup.match(/checked=""/g)).toHaveLength(5);
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
    expect(markup).toContain('已選好五張，可以開始遠征');
  });
});
