import { useEffect, useState, type ReactNode } from 'react';
import type { Phase } from '@guildmaster/game-protocol';
import type { SessionPersistenceStatus } from '../../../adapters/game-session.js';
import { PhaseProgress } from './PhaseProgress.js';
import { sessionPersistenceText } from './persistence-copy.js';
import { phaseDisplayName } from './phase-copy.js';

type Props = {
  gameId: string;
  round: number;
  phase: Phase;
  activeActorLabel: string;
  purchaseBonus: number;
  availablePurchasePower: number;
  combatBonus: number;
  persistence: SessionPersistenceStatus;
  children: ReactNode;
};

export function MobileBattleStatus({ gameId, round, phase, activeActorLabel, purchaseBonus, availablePurchasePower, combatBonus, persistence, children }: Props) {
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => { setExpanded(false); }, [gameId]);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => setMobile(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  if (!mobile) return <>{children}</>;

  return <section className="mobile-battle-status" data-expanded={expanded} data-testid="mobile-battle-status">
    <div className="mobile-battle-status__summary">
      <div className="mobile-battle-status__primary">
        <span>第 {round} 輪 · {phaseDisplayName(phase)}階段</span>
        <strong>{activeActorLabel}</strong>
      </div>
      <div className="mobile-battle-status__vitals" aria-label="本回合數值">
        <span>可用購買力 {availablePurchasePower}</span>
        {purchaseBonus > 0 ? <span>效果 +{purchaseBonus}</span> : null}
        <span>戰力 +{combatBonus}</span>
      </div>
      <span className={`mobile-save-status save-status-${persistence.state}`}>本機：{sessionPersistenceText(persistence)}</span>
      <button
        type="button"
        className="mobile-battle-status__toggle"
        aria-expanded={expanded}
        aria-controls="mobile-battle-status-details"
        onClick={() => setExpanded((current) => !current)}
      >{expanded ? '收合戰況' : '展開戰況'}</button>
    </div>
    <div id="mobile-battle-status-details" className="mobile-battle-status__details">
      <PhaseProgress key={phase} phase={phase} />
      {children}
    </div>
  </section>;
}
