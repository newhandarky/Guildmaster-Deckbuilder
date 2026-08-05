import type { ActionPreviewItem, AttackPreviewOutcome } from '@guildmaster/game-protocol';

function outcomeCopy(outcome: AttackPreviewOutcome): string {
  if (outcome.kind === 'damage-target') {
    const terminal = outcome.lethal ? `，並${outcome.lethalOutcome === 'defeated' ? '擊敗目標' : '將目標移出遊戲'}` : '';
    return `規則結果：造成 ${outcome.actualDamage} 點傷害，HP ${outcome.healthBefore} → ${outcome.healthAfter}${terminal}。`;
  }
  return outcome.kind === 'defeat-target' ? '規則結果：擊敗目標。' : '規則結果：將目標移出遊戲。';
}

export function ActionPreviewPanel({ preview }: { preview: ActionPreviewItem }) {
  if (preview.status === 'requires-lifecycle') {
    const attack = preview.kind === 'attack';
    return <section className="action-preview" data-testid="action-preview" aria-labelledby="action-preview-title">
      <h3 id="action-preview-title">{attack ? '討伐預覽' : '購買預覽'}</h3>
      <p>此動作會先進入規則互動或隨機結算；完成後，系統才會固定最終{attack ? '戰力與結果' : '費用與剩餘購買力'}。</p>
    </section>;
  }
  if (preview.kind === 'attack') {
    return <section className="action-preview" data-testid="action-preview" aria-labelledby="action-preview-title">
      <h3 id="action-preview-title">討伐預覽</h3>
      <dl>
        <div><dt>需求戰力</dt><dd>{preview.requiredCombat}</dd></div>
        <div><dt>本次投入</dt><dd>{preview.committedCombat}</dd></div>
        <div><dt>戰力餘裕</dt><dd>{preview.surplusCombat}</dd></div>
      </dl>
      <p>將使用隊伍前 {preview.partySlotCount} 個位置，共 {preview.participantCardIds.length} 張參與卡。</p>
      <p>{outcomeCopy(preview.outcome)}</p>
    </section>;
  }
  return <section className="action-preview" data-testid="action-preview" aria-labelledby="action-preview-title">
    <h3 id="action-preview-title">購買預覽</h3>
    <dl>
      <div><dt>目前購買力</dt><dd>{preview.availablePurchasePower}</dd></div>
      <div><dt>卡牌費用</dt><dd>{preview.cost}</dd></div>
      <div><dt>購買後剩餘</dt><dd>{preview.remainingPurchasePower}</dd></div>
    </dl>
    <p>送出時仍會由對局版本與 authoritative rules 重新驗證。</p>
  </section>;
}
