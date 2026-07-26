import type { CardDefinition, CardInstance } from '@guildmaster/game-protocol';

type Props = { instance?: CardInstance | undefined; definition?: CardDefinition | undefined; onClick?: (() => void) | undefined; selected?: boolean | undefined; label?: string | undefined; testId?: string | undefined };

export function Card({ instance, definition, onClick, selected = false, label, testId }: Props) {
  const disabled = !onClick;
  return <button type="button" data-testid={testId} className={`card ${definition?.type ?? 'unknown'} ${selected ? 'selected' : ''}`} disabled={disabled} onClick={onClick}>
    <span className="card-type">{label ?? definition?.type ?? '未知'}</span>
    <strong>{definition?.name ?? instance?.definitionId ?? '隱藏卡'}</strong>
    <span>⚔ {definition?.combat ?? '—'} / ✦ {definition?.honor ?? 0}</span>
    {definition?.cost !== undefined ? <span>費用 {definition.cost}</span> : null}
    {definition?.purchasePower ? <span>購買力 {definition.purchasePower}</span> : null}
  </button>;
}
