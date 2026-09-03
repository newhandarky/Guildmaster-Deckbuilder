import { ReplayBundleSchema, type ReplayBundle } from '@guildmaster/game-protocol';
import { describe, expect, it, vi } from 'vitest';
import { downloadReplayJson, type ReplayDownloadPorts } from './replay-download.js';

const replayBundle: ReplayBundle = {
  schemaVersion: 2,
  protocolVersion: 1,
  registry: { engineVersion: 'test-engine', rulesetVersion: 'test-ruleset', contentPacks: [], rulesModules: [] },
  initialConfig: {
    gameId: 'completed-game',
    seed: 42,
    players: [
      { id: 'p1', name: 'P1', kind: 'human' },
      { id: 'p2', name: 'P2', kind: 'ai' },
    ],
    startingPlayerId: 'p1',
  },
  commands: [],
  automation: {
    profileId: 'test-profile',
    profileVersion: '1',
    runner: { autonomousSteps: 0, turnActions: [], visibleStates: [] },
    decisions: [],
  },
};

function ports() {
  let downloadedBlob: Blob | undefined;
  const createObjectURL = vi.fn((blob: Blob) => { downloadedBlob = blob; return 'blob:replay'; });
  const revokeObjectURL = vi.fn();
  const triggerDownload = vi.fn();
  const value: ReplayDownloadPorts = {
    now: () => new Date('2026-09-02T06:30:45.000Z'),
    createObjectURL,
    revokeObjectURL,
    triggerDownload,
  };
  return { value, createObjectURL, revokeObjectURL, triggerDownload, downloadedBlob: () => downloadedBlob };
}

describe('Replay JSON download', () => {
  it('downloads a completed current ReplayBundle as parseable JSON and cleans up its object URL', async () => {
    const browser = ports();
    const result = downloadReplayJson({ json: JSON.stringify(replayBundle, null, 2) }, 'completed/game 01', browser.value);

    expect(result).toEqual({
      status: 'downloaded',
      filename: 'guildmaster-replay-completed-game-01-20260902T063045Z.json',
      message: '已下載本局 Replay JSON：guildmaster-replay-completed-game-01-20260902T063045Z.json',
    });
    expect(browser.triggerDownload).toHaveBeenCalledWith('blob:replay', 'guildmaster-replay-completed-game-01-20260902T063045Z.json');
    expect(browser.revokeObjectURL).toHaveBeenCalledOnce();
    expect(browser.revokeObjectURL).toHaveBeenCalledWith('blob:replay');
    const downloadedJson = await browser.downloadedBlob()!.text();
    const parsed = JSON.parse(downloadedJson) as ReplayBundle;
    expect(parsed).toEqual(replayBundle);
    expect(ReplayBundleSchema.safeParse(parsed).success).toBe(true);
    expect(browser.downloadedBlob()!.type).toBe('application/json;charset=utf-8');
  });

  it.each([
    ['未完成對局', '為保護未公開牌序、手牌與隨機種子，完整 Replay 只能在對局結束後匯出。'],
    ['不完整 Replay', '此舊存檔只保存 Snapshot，沒有完整 Command Replay history。'],
  ])('%s不下載並保留匯出錯誤', (_label, message) => {
    const browser = ports();
    expect(downloadReplayJson({ error: message }, 'game', browser.value)).toEqual({ status: 'failed', message });
    expect(browser.createObjectURL).not.toHaveBeenCalled();
    expect(browser.triggerDownload).not.toHaveBeenCalled();
    expect(browser.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('does not download malformed exported JSON', () => {
    const browser = ports();
    expect(downloadReplayJson({ json: '{broken' }, 'game', browser.value)).toEqual({
      status: 'failed',
      message: 'Replay JSON 內容無法解析，因此未下載檔案。',
    });
    expect(browser.createObjectURL).not.toHaveBeenCalled();
    expect(browser.triggerDownload).not.toHaveBeenCalled();
  });

  it('revokes the object URL even when the native download trigger fails', () => {
    const browser = ports();
    browser.triggerDownload.mockImplementation(() => { throw new Error('blocked'); });
    expect(downloadReplayJson({ json: JSON.stringify(replayBundle) }, 'game', browser.value)).toEqual({
      status: 'failed',
      message: '下載 Replay JSON 失敗；未產生檔案，請稍後再試。',
    });
    expect(browser.revokeObjectURL).toHaveBeenCalledWith('blob:replay');
  });
});
