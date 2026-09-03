import { useState } from 'react';
import type { ReplayRunnerReport } from '../../../adapters/game-session.js';
import type { ReplayDownloadResult } from '../../../adapters/replay-download.js';

type Props = {
  report?: ReplayRunnerReport | undefined;
  loadCurrentReplay: () => string | undefined;
  downloadCurrentReplay: () => ReplayDownloadResult;
  runReplay: (source: string) => void;
  clearReport: () => void;
  sessionConfigLabel?: string;
};

export function ReplayDownloadNotice({ report }: { report: ReplayDownloadResult }) {
  return <output
    data-testid="replay-download-report"
    className={report.status === 'downloaded' ? 'replay-success' : 'replay-failure'}
    role={report.status === 'failed' ? 'alert' : 'status'}
    aria-live={report.status === 'failed' ? 'assertive' : 'polite'}
    aria-atomic="true"
  >{report.message}</output>;
}

export function ReplayDiagnosticsPanel({ report, loadCurrentReplay, downloadCurrentReplay, runReplay, clearReport, sessionConfigLabel }: Props) {
  const [source, setSource] = useState('');
  const [downloadReport, setDownloadReport] = useState<ReplayDownloadResult>();

  return <details className="replay-diagnostics" data-testid="replay-diagnostics">
    <summary>Replay 診斷（開發工具）</summary>
    <section className="replay-runner" data-testid="replay-runner" aria-labelledby="replay-runner-title">
      <h2 id="replay-runner-title">Replay 診斷</h2>
      <p>貼上 versioned Replay JSON；執行不會修改目前對局或本機存檔。為保護隱藏資訊，本機對局結束後才可匯出。</p>
      {sessionConfigLabel ? <p><strong>本局設定：</strong>{sessionConfigLabel}</p> : null}
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
        <button data-testid="download-replay" type="button" onClick={() => setDownloadReport(downloadCurrentReplay())}>下載本局 Replay JSON</button>
        <button data-testid="run-replay" type="button" onClick={() => runReplay(source)}>執行 Replay</button>
        {report ? <button type="button" onClick={clearReport}>清除結果</button> : null}
      </div>
      {downloadReport ? <ReplayDownloadNotice report={downloadReport} /> : null}
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
