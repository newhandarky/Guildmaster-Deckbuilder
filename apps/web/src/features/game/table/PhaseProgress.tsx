import type { Phase } from '@guildmaster/game-protocol';
import { buildPhaseProgress } from './gameplay-feedback.js';

export function PhaseProgress({ phase }: { phase: Phase }) {
  return <ol className="phase-progress" data-testid="phase-progress" aria-label="本回合階段" tabIndex={0}>
    {buildPhaseProgress(phase).map((item) => <li
      className={`phase-step phase-step-${item.state}`}
      data-phase={item.phase}
      data-state={item.state}
      aria-current={item.state === 'current' ? 'step' : undefined}
      key={item.phase}
    >
      <span className="phase-step-marker" aria-hidden="true">{item.state === 'completed' ? '✓' : item.position}</span>
      <span>{item.label}</span>
      {item.state === 'current' ? <small>目前</small> : null}
    </li>)}
  </ol>;
}
