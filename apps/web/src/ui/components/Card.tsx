import type { CardDefinition, CardInstance } from '@guildmaster/game-protocol';
import type { PresentationViewModel } from '@guildmaster/presentation-core';

type Props = { instance?: CardInstance | undefined; definition?: CardDefinition | undefined; presentation?: PresentationViewModel | undefined; onClick?: (() => void) | undefined; selected?: boolean | undefined; label?: string | undefined; testId?: string | undefined };

/** UI adapter: rules definition supplies mechanics; presentation supplies all player-facing card copy. */
export function Card({ instance, definition, presentation, onClick, selected = false, label, testId }: Props) {
  const disabled = !onClick;
  return <button type="button" data-testid={testId} className={`card ${definition?.type ?? 'unknown'} ${selected ? 'selected' : ''}`} disabled={disabled} onClick={onClick}>
    <span className="card-type">{label ?? definition?.type ?? '未知'}</span>
    <strong>{presentation?.displayName ?? instance?.definitionId ?? '隱藏卡'}</strong>
    <small>{presentation?.shortDisplayText}</small>
    <span>⚔ {definition?.combat ?? '—'} / ✦ {definition?.honor ?? 0}</span>
    {definition?.cost !== undefined ? <span>費用 {definition.cost}</span> : null}
    {definition?.purchasePower ? <span>購買力 {definition.purchasePower}</span> : null}
  </button>;
}
