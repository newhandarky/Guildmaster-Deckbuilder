import { webModeEffectSummary, type WebContentMode } from '../../../app/ruleset.js';

type Props = {
  contentMode: WebContentMode;
  helpersEnabled: boolean;
};

export function TestBuildInfo({ contentMode, helpersEnabled }: Props) {
  if (contentMode === 'demo') return null;
  return <details className="test-build-info">
    <summary>測試版本資訊</summary>
    {contentMode === 'provisional-playtest'
      ? <p data-testid="provisional-content-warning">目前有 {webModeEffectSummary.foundation}；其餘個別效果尚未啟用。{helpersEnabled ? `已啟用 ${webModeEffectSummary.helpers} 的效果。` : ''}</p>
      : null}
    {contentMode === 'provisional-original-full'
      ? <p data-testid="full-provisional-content-warning">已驗證內容：{webModeEffectSummary.full}。其餘效果保持停用，卡牌張數不代表正式版本。</p>
      : null}
    {contentMode === 'custom-adventurers-full'
      ? <p data-testid="custom-adventurer-content-warning">已替換五名起始成員與完整冒險者供應；{webModeEffectSummary.custom}。未完成驗證的技能只套用卡面數值；圖片載入失敗時使用替代插畫。</p>
      : null}
  </details>;
}
