import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BossCountPicker, CpuDifficultyPicker } from './ExpeditionEntryScreen.js';

describe('ExpeditionEntryScreen setup controls', () => {
  it('renders three native CPU difficulty radios for every mode', () => {
    const markup = renderToStaticMarkup(<CpuDifficultyPicker value="standard" onChange={() => undefined} />);
    expect(markup).toContain('CPU 強度');
    expect(markup.match(/name="cpu-difficulty"/g)).toHaveLength(3);
  });

  it('renders the formal-to-all boss select with explicit warning copy', () => {
    const markup = renderToStaticMarkup(<BossCountPicker value={11} maximum={11} onChange={() => undefined} />);
    expect(markup).toContain('id="boss-deck-size"');
    expect(markup).toContain('6 隻（正式規則）');
    expect(markup).toContain('11 隻（全部魔王）');
  });
});
