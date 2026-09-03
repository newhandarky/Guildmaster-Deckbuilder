import type { ReplayDiagnosticExport } from './game-session.js';

export type ReplayDownloadResult =
  | { status: 'downloaded'; filename: string; message: string }
  | { status: 'failed'; message: string };

export type ReplayDownloadPorts = {
  now: () => Date;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  triggerDownload: (url: string, filename: string) => void;
};

const browserPorts: ReplayDownloadPorts = {
  now: () => new Date(),
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  triggerDownload: (url, filename) => {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.append(anchor);
    try { anchor.click(); }
    finally { anchor.remove(); }
  },
};

function safeFilenamePart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'game';
}

function filenameTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function downloadReplayJson(
  exported: ReplayDiagnosticExport,
  gameId: string,
  ports: ReplayDownloadPorts = browserPorts,
): ReplayDownloadResult {
  if (!exported.json) {
    return { status: 'failed', message: exported.error ?? 'Replay diagnostic 匯出失敗，沒有可下載的 JSON。' };
  }

  try { JSON.parse(exported.json); }
  catch { return { status: 'failed', message: 'Replay JSON 內容無法解析，因此未下載檔案。' }; }

  const filename = `guildmaster-replay-${safeFilenamePart(gameId)}-${filenameTimestamp(ports.now())}.json`;
  let objectUrl: string | undefined;
  try {
    const blob = new Blob([exported.json], { type: 'application/json;charset=utf-8' });
    objectUrl = ports.createObjectURL(blob);
    ports.triggerDownload(objectUrl, filename);
    return { status: 'downloaded', filename, message: `已下載本局 Replay JSON：${filename}` };
  } catch {
    return { status: 'failed', message: '下載 Replay JSON 失敗；未產生檔案，請稍後再試。' };
  } finally {
    if (objectUrl) ports.revokeObjectURL(objectUrl);
  }
}
