import { useState } from 'react';
import type { ReplayRunnerReport } from '../../../adapters/game-session.js';

type Props = {
  report?: ReplayRunnerReport | undefined;
  loadCurrentReplay: () => string | undefined;
  runReplay: (source: string) => void;
  clearReport: () => void;
};

export function ReplayDiagnosticsPanel({ report, loadCurrentReplay, runReplay, clearReport }: Props) {
  const [source, setSource] = useState('');

  return <details className="replay-diagnostics" data-testid="replay-diagnostics">
    <summary>Replay 診斷（開發工具）</summary>
    <section className="replay-runner" data-testid="replay-runner" aria-labelledby="replay-runner-title">
      <h2 id="replay-runner-title">Replay 診斷</h2>
      <p>貼上 versioned Replay JSON；執行不會修改目前對局或本機存檔。為保護隱藏資訊，本機對局結束後才可匯出。</p>
      <textarea
        aria-label="Replay JSON"
        value={source}
        onChange={(event) => setSource(event.target.value)}
        placeholder="貼上 ReplayBundle JSON"
      />
      <div className="controls">
        <button type="button" onClick={() => {
          const exported = loadCurrentReplay();
          if (exported) setSource(exported);
        }}>載入已完成對局 Replay</button>
        <button data-testid="run-replay" type="button" onClick={() => runReplay(source)}>執行 Replay</button>
        {report ? <button type="button" onClick={clearReport}>清除結果</button> : null}
      </div>
      {report ? <output
        data-testid="replay-report"
        className={report.status === 'completed' ? 'replay-success' : 'replay-failure'}
        aria-live="polite"
        aria-atomic="true"
      >
        {report.status === 'completed'
          ? <>
            <strong>{report.message}</strong>
            <span>commands {report.commandCount} · events {report.eventCount} · revision {report.revision}</span>
          </>
          : <>
            <strong>{report.reasonCode ?? 'MALFORMED_REPLAY'}：{report.message}</strong>
            {report.commandIndex !== undefined
              ? <span>command #{report.commandIndex + 1}{report.commandId ? ` (${report.commandId})` : ''}</span>
              : null}
            {report.expectedRevision !== undefined
              ? <span>revision expected {report.expectedRevision} / actual {report.actualRevision}</span>
              : null}
            {report.divergence
              ? <span>first divergence {report.divergence.path}：expected {JSON.stringify(report.divergence.expected)} / actual {JSON.stringify(report.divergence.actual)}</span>
              : null}
          </>}
      </output> : null}
    </section>
  </details>;
}
