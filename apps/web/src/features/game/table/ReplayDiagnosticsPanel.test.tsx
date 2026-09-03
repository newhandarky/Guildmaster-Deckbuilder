import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReplayDiagnosticsPanel, ReplayDownloadNotice } from './ReplayDiagnosticsPanel.js';

describe('ReplayDiagnosticsPanel', () => {
  it('keeps the existing Replay actions and exposes a keyboard-operable download button', () => {
    const markup = renderToStaticMarkup(<ReplayDiagnosticsPanel
      loadCurrentReplay={() => undefined}
      downloadCurrentReplay={() => ({ status: 'failed', message: '尚不可下載。' })}
      runReplay={() => undefined}
      clearReport={() => undefined}
    />);

    expect(markup).toContain('載入已完成對局 Replay');
    expect(markup).toContain('下載本局 Replay JSON');
    expect(markup).toContain('執行 Replay');
    expect(markup).toContain('data-testid="download-replay"');
    expect(markup).toContain('type="button"');
  });

  it('renders a clear Traditional Chinese failure as an assertive alert', () => {
    const markup = renderToStaticMarkup(<ReplayDownloadNotice report={{
      status: 'failed',
      message: '此舊存檔只保存 Snapshot，沒有完整 Command Replay history。',
    }} />);

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('aria-live="assertive"');
    expect(markup).toContain('此舊存檔只保存 Snapshot，沒有完整 Command Replay history。');
  });
});
