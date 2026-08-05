import type { Phase } from '@guildmaster/game-protocol';
import { phaseDisplayName } from './phase-copy.js';
import { PhaseProgress } from './PhaseProgress.js';

type Props = {
  round: number;
  phase: Phase;
  revision: number;
  isViewerActive: boolean;
};

export function GameHeader({ round, phase, revision, isViewerActive }: Props) {
  return <header className="hero game-header">
    <div>
      <p className="eyebrow">原創文字示範牌組 · 單機人機對戰</p>
      <h1>晨星公會</h1>
      <p>第 {round} 輪 · {phaseDisplayName(phase)}階段</p>
      <PhaseProgress phase={phase} />
    </div>
    <div className="status">
      <strong>{isViewerActive ? '你的回合' : 'AI 正在行動'}</strong>
      <span>版本 {revision}</span>
    </div>
  </header>;
}
