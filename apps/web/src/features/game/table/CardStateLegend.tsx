const states = [
  { state: 'legal', label: '可執行', description: '可在詳情確認動作' },
  { state: 'selected', label: '已選取', description: '目前選取的卡片' },
  { state: 'target', label: '合法目標', description: '可在詳情確認目標' },
  { state: 'unavailable', label: '不可執行', description: '仍可開啟詳情' },
] as const;

export function CardStateLegend() {
  return <section className="card-state-legend" data-testid="card-state-legend" aria-labelledby="card-state-legend-title">
    <h2 id="card-state-legend-title">卡片狀態</h2>
    <ul>
      {states.map((item) => <li className={`card-state-${item.state}`} key={item.state}>
        <span className="card-state-marker" aria-hidden="true" />
        <span><strong>{item.label}</strong><small>{item.description}</small></span>
      </li>)}
    </ul>
  </section>;
}
